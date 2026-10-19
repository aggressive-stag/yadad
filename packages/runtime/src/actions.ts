// Which actions a record offers, and checking an action's input (RFC 0007,
// "Availability: one condition, hide not disable" and the input rule).

import type {
  ActionInputField,
  DataRecord,
  DocumentError,
  EntityDocument,
  RecordAction,
  RecordValues,
  ResolvedViewer,
} from "@yadad/core";
import { SPEC_VERSION } from "@yadad/core";

import { evaluateCondition } from "./condition.js";
import { validateRecord } from "./record.js";

/** What an action's handler returns: a patch of values to store, or remove the record (RFC 0007). */
export type ActionOutcome = { readonly values?: RecordValues } | { readonly remove: true };

/** Host-supplied implementation of an action, used by the memory and key-value adapters (card 34f). */
export type ActionHandler = (record: DataRecord, input: RecordValues) => ActionOutcome;

/** Anything that offers actions on a record: table, board and calendar views all carry `recordActions` (RFC 0007). */
export interface ActionsView {
  readonly recordActions?: readonly string[];
}

/**
 * The view's `recordActions` in the view's order, kept only when the action
 * exists on the entity, its `visibleWhen` (record and viewerIn leaves) is true
 * for the record's values and the viewer, and `record.can?.actions?.[id]` is
 * not `false` — a missing `can`, `actions` or key is "not stated: offered".
 * Unavailable actions are dropped, never returned as disabled (RFC 0006).
 */
export function availableActions(
  entity: EntityDocument,
  view: ActionsView,
  record: DataRecord,
  viewer?: ResolvedViewer,
): RecordAction[] {
  const offered = view.recordActions ?? [];
  const byId = new Map(entity.actions?.map((action) => [action.id, action]));
  const actions: RecordAction[] = [];
  for (const id of offered) {
    const action = byId.get(id);
    if (action === undefined) {
      continue; // not the entity's action; document validation rejects this, be defensive
    }
    if (action.visibleWhen !== undefined && !evaluateCondition(action.visibleWhen, record.values, undefined, viewer)) {
      continue;
    }
    if (record.can?.actions?.[id] === false) {
      continue;
    }
    actions.push(action);
  }
  return actions;
}

/** Does pressing this action open a dialog? True when it has `confirm` or `input`. */
export function actionNeedsDialog(action: RecordAction): boolean {
  return action.confirm !== undefined || action.input !== undefined;
}

/**
 * Check an action's input with the same rules as record values: `validateRecord`
 * over the action's input fields, with issue paths under `/input/` (so a bad
 * `reason` reports `/input/reason`). An action without `input` accepts no
 * values; anything sent for it is reported as unknown.
 */
export function validateActionInput(action: RecordAction, input: RecordValues): readonly DocumentError[] {
  const fields: readonly ActionInputField[] = action.input ?? [];
  const carrier: EntityDocument = {
    kind: "entity",
    specVersion: SPEC_VERSION,
    id: `action:${action.id}`,
    revision: 1,
    fields: [...fields],
  };
  return validateRecord(carrier, input).map((issue) => ({ ...issue, path: `/input${issue.path}` }));
}
