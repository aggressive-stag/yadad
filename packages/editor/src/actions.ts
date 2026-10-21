import { ACTIONS_MAX, jsonPointer } from "@yadad/core";
import type { ActionConfirm, DocumentError, EntityDocument, RecordAction, ViewDocument } from "@yadad/core";
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
