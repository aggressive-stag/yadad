import { ACTIONS_MAX, ACTION_INPUT_FIELD_TYPES, ACTION_INPUT_MAX, jsonPointer } from "@yadad/core";
import type { ActionConfirm, ActionInputField, Condition, DocumentError, EntityDocument, RecordAction, ViewDocument } from "@yadad/core";
import type { Json, PatchOperation } from "@yadad/runtime";

// Patches for an entity's `actions` (RFC 0007). The entity is the place an
// action lives; a view only offers them. Each patch starts with a `test` on
// the action's id so it refuses to apply to a stale document, as the field
// patches do. Adding is always safe for saved records: an action is a
// command the server runs, not stored data.

type Result = { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

const ok = (patch: PatchOperation[]): Result => ({ ok: true, patch });
const fail = (path: (string | number)[], message: string, hint: string): Result => ({
  ok: false,
  error: { path: jsonPointer(path), code: "invalid-value", message, hint },
});

const guard = (entity: EntityDocument): PatchOperation => ({ op: "test", path: "/id", value: entity.id });
const indexOf = (entity: EntityDocument, actionId: string): number => (entity.actions ?? []).findIndex((a) => a.id === actionId);

/** Patch appending an action. Refused past ACTIONS_MAX, on a duplicate id, or without the required label. */
export function addAction(entity: EntityDocument, action: RecordAction): Result {
  const actions = entity.actions ?? [];
  if (actions.some((a) => a.id === action.id)) return fail(["actions"], `An action "${action.id}" already exists on "${entity.id}".`, "Ids are unique among the entity's actions.");
  if (actions.length >= ACTIONS_MAX) return fail(["actions"], `An entity declares at most ${ACTIONS_MAX} actions.`, "Remove one before adding another.");
  if (action.label.trim() === "") return fail(["actions", actions.length, "label"], "An action needs a label: it is the button text.", 'Give the action a non-empty "label".');
  // RFC 6902's `add /actions/-` needs the array to exist; the first action creates the key itself.
  const patch: PatchOperation[] = entity.actions === undefined
    ? [{ op: "add", path: "/actions", value: [action as unknown as Json] }]
    : [{ op: "add", path: "/actions/-", value: action as unknown as Json }];
  return ok([guard(entity), ...patch]);
}

/**
 * Patch replacing an action's label and confirm. Ids are fixed after
 * creation (views offer actions by id), and the input fields and visibleWhen
 * are edited by card 37b, so they are preserved as they are.
 */
export function updateAction(entity: EntityDocument, actionId: string, next: { label: string; confirm?: ActionConfirm }): Result {
  const i = indexOf(entity, actionId);
  const current = (entity.actions ?? [])[i];
  if (current === undefined) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Add it instead of updating it.");
  if (next.label.trim() === "") return fail(["actions", i, "label"], "An action needs a label: it is the button text.", "Keep a non-empty label.");
  const updated: RecordAction = {
    id: current.id,
    label: next.label,
    ...(next.confirm === undefined || next.confirm.message.trim() === "" ? {} : { confirm: next.confirm }),
    ...(current.input === undefined ? {} : { input: current.input }),
    ...(current.visibleWhen === undefined ? {} : { visibleWhen: current.visibleWhen }),
  };
  return ok([guard(entity), { op: "test", path: `/actions/${i}/id`, value: actionId }, { op: "replace", path: `/actions/${i}`, value: updated as unknown as Json }]);
}

/** Patch moving an action by `by` slots; an action already at an end is refused. */
export function moveAction(entity: EntityDocument, actionId: string, by: number): Result {
  const actions = entity.actions ?? [];
  const i = actions.findIndex((a) => a.id === actionId);
  if (i < 0) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Add it first.");
  const to = i + by;
  if (to < 0 || to >= actions.length) return fail(["actions", i], `"${actionId}" is already ${by < 0 ? "first" : "last"}.`, "Move it the other way.");
  return ok([guard(entity), { op: "test", path: `/actions/${i}/id`, value: actionId }, { op: "move", from: `/actions/${i}`, path: `/actions/${to}` }]);
}

/** Where views still offer the action. A view lists it in `recordActions`. */
export function actionReferences(views: Iterable<ViewDocument>, entityId: string, actionId: string): string[] {
  const found: string[] = [];
  for (const view of views) {
    // Only table, board and calendar offer actions; a form never does (RFC 0007), and a dashboard has no entity.
    if (view.kind === "dashboard" || view.kind === "form" || view.entity !== entityId) continue;
    view.recordActions?.forEach((id, i) => id === actionId && found.push(`${view.id}${jsonPointer(["recordActions", i])}`));
  }
  return found;
}

/** Patch removing an action, refused while any view still offers it — as with a field in use. */
export function removeAction(entity: EntityDocument, actionId: string, views: Iterable<ViewDocument>): Result {
  const i = indexOf(entity, actionId);
  if (i < 0) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Nothing to remove.");
  const refs = actionReferences(views, entity.id, actionId);
  if (refs.length > 0) {
    return {
      ok: false,
      error: { path: jsonPointer(["actions", i]), code: "invalid-value", message: `"${actionId}" is still offered by: ${refs.join(", ")}.`, hint: "Remove it from those views first." },
    };
  }
  const wasLast = (entity.actions ?? []).length === 1;
  const patch: PatchOperation[] = [guard(entity), { op: "test", path: `/actions/${i}/id`, value: actionId }, { op: "remove", path: `/actions/${i}` }];
  if (wasLast) patch.push({ op: "remove", path: "/actions" }); // an empty array is invalid: the last removal takes the key with it
  return { ok: true, patch };
}

// ---- Input fields and visibility (card 37b) ----
// `input` is the dialog the action asks for before it runs: 1..5 fields of a
// type the action can ask for (never `reference` — a picker needs a target
// query, which actions do not have yet). `visibleWhen` is the same condition
// shape a form item uses, record leaves and viewerIn leaves.

const actionAt = (entity: EntityDocument, actionId: string): { i: number; action: RecordAction } | undefined => {
  const i = indexOf(entity, actionId);
  const action = (entity.actions ?? [])[i];
  return action === undefined ? undefined : { i, action };
};

const setOptional = (present: boolean, path: string, value: Json | undefined): PatchOperation[] =>
  value === undefined ? (present ? [{ op: "remove", path }] : []) : [{ op: present ? "replace" : "add", path, value }];

const refusedType = (field: ActionInputField): string | undefined =>
  (field as { readonly type?: string }).type === "reference" ? "An action cannot ask for a reference field: a picker needs a target query, which actions do not have yet." : undefined;

/**
 * Patch replacing an action's whole input list. An empty list removes the
 * key (the action then runs on a plain confirm); a reference type or more
 * than ACTION_INPUT_MAX fields is refused.
 */
export function setActionInput(entity: EntityDocument, actionId: string, input: readonly ActionInputField[]): Result {
  const at = actionAt(entity, actionId);
  if (at === undefined) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Add it first.");
  if (input.length > ACTION_INPUT_MAX) return fail(["actions", at.i, "input"], `An action asks for at most ${ACTION_INPUT_MAX} input fields, but ${input.length} are listed.`, `Remove ${input.length - ACTION_INPUT_MAX}.`);
  for (const field of input) {
    const why = refusedType(field);
    if (why !== undefined) return fail(["actions", at.i, "input"], why, `Use one of: ${ACTION_INPUT_FIELD_TYPES.join(", ")}.`);
  }
  const guardOps: PatchOperation[] = [guard(entity), { op: "test", path: `/actions/${at.i}/id`, value: actionId }];
  const ops = setOptional(at.action.input !== undefined, `/actions/${at.i}/input`, input.length === 0 ? undefined : (input as unknown as Json));
  return ok(ops.length === 0 ? [] : [...guardOps, ...ops]);
}

/** Patch appending one input field, refused at the cap, on a duplicate id, or without a label. */
export function addActionInput(entity: EntityDocument, actionId: string, field: ActionInputField): Result {
  const at = actionAt(entity, actionId);
  if (at === undefined) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Add it first.");
  const input = at.action.input ?? [];
  if (input.length >= ACTION_INPUT_MAX) return fail(["actions", at.i, "input"], `An action asks for at most ${ACTION_INPUT_MAX} input fields.`, "Remove one before adding another.");
  if (input.some((f) => f.id === field.id)) return fail(["actions", at.i, "input"], `This action already asks for "${field.id}".`, "Ids are unique within the action's input.");
  if (field.label.trim() === "") return fail(["actions", at.i, "input"], "An input field needs a label: it is the dialog's field label.", 'Give it a non-empty "label".');
  const why = refusedType(field);
  if (why !== undefined) return fail(["actions", at.i, "input"], why, `Use one of: ${ACTION_INPUT_FIELD_TYPES.join(", ")}.`);
  // RFC 6902's `add …/input/-` needs the array to exist; the first input creates the key itself.
  const add: PatchOperation = input.length === 0
    ? { op: "add", path: `/actions/${at.i}/input`, value: [field as unknown as Json] }
    : { op: "add", path: `/actions/${at.i}/input/-`, value: field as unknown as Json };
  return ok([guard(entity), { op: "test", path: `/actions/${at.i}/id`, value: actionId }, add]);
}

/** Patch replacing one input field, matched by id; ids stay fixed once the dialog exists. */
export function updateActionInput(entity: EntityDocument, actionId: string, fieldId: string, next: ActionInputField): Result {
  const at = actionAt(entity, actionId);
  if (at === undefined) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Add it first.");
  const i = (at.action.input ?? []).findIndex((f) => f.id === fieldId);
  if (i < 0) return fail(["actions", at.i, "input"], `This action does not ask for "${fieldId}".`, "Add it first.");
  if (next.label.trim() === "") return fail(["actions", at.i, "input", i, "label"], "An input field needs a label: it is the dialog's field label.", "Keep a non-empty label.");
  const why = refusedType(next);
  if (why !== undefined) return fail(["actions", at.i, "input", i], why, `Use one of: ${ACTION_INPUT_FIELD_TYPES.join(", ")}.`);
  return ok([guard(entity), { op: "test", path: `/actions/${at.i}/id`, value: actionId }, { op: "test", path: `/actions/${at.i}/input/${i}/id`, value: fieldId }, { op: "replace", path: `/actions/${at.i}/input/${i}`, value: next as unknown as Json }]);
}

/** Patch removing one input field; the last removal takes the `input` key with it. */
export function removeActionInput(entity: EntityDocument, actionId: string, fieldId: string): Result {
  const at = actionAt(entity, actionId);
  if (at === undefined) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Add it first.");
  const input = at.action.input ?? [];
  const i = input.findIndex((f) => f.id === fieldId);
  if (i < 0) return fail(["actions", at.i, "input"], `This action does not ask for "${fieldId}".`, "Nothing to remove.");
  return setActionInput(entity, actionId, input.filter((f) => f.id !== fieldId));
}

/** Sets or clears the action's `visibleWhen`, the same condition a form item's uses. */
export function setActionVisibleWhen(entity: EntityDocument, actionId: string, condition: Condition | undefined): Result {
  const at = actionAt(entity, actionId);
  if (at === undefined) return fail(["actions"], `No action "${actionId}" on "${entity.id}".`, "Add it first.");
  const guardOps: PatchOperation[] = [guard(entity), { op: "test", path: `/actions/${at.i}/id`, value: actionId }];
  const ops = setOptional(at.action.visibleWhen !== undefined, `/actions/${at.i}/visibleWhen`, condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [...guardOps, ...ops]);
}
