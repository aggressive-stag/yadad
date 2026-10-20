import { ForbiddenError, RecordConflictError, RecordNotFoundError, RecordValidationError } from "@yadad/core";
import type { AdapterOptions } from "./memory-adapter.js";
import type { ActionRequest, Condition, DataRecord, Query, RecordPermissions, RecordValues } from "@yadad/core";
import type { ActionHandler, ActionOutcome } from "./actions.js";

/** The record as the adapter returns it: with `can` when `recordPermissions` states any. */
export function withPermissions(options: AdapterOptions | undefined, record: DataRecord): DataRecord {
  const can = options?.recordPermissions?.(record);
  return can === undefined ? record : { ...record, can };
}

/** Throws a ForbiddenError when the record's permissions refuse `action`. */
export function assertPermitted(options: AdapterOptions | undefined, record: DataRecord, action: "update" | "delete"): void {
  if (options?.recordPermissions?.(record)?.[action] === false) {
    throw new ForbiddenError(`You are not allowed to ${action} the "${record.entityId}" record "${record.id}".`);
  }
}

/** True when a condition reads the viewer anywhere. */
function readsViewer(condition: Condition): boolean {
  switch (condition.op) {
    case "viewerIn":
      return true;
    case "and":
    case "or":
      return condition.conditions.some(readsViewer);
    case "not":
      return readsViewer(condition.condition);
    default:
      return false;
  }
}

/** Rejects a query whose filter has a `viewerIn` leaf: filters go to servers, which scope records themselves. */
export function assertQueryHasNoViewer(query: Query): void {
  if (query.filter !== undefined && readsViewer(query.filter)) {
    throw new RecordValidationError("A filter cannot depend on the viewer.", [
      {
        path: "/filter",
        code: "invalid-value",
        message: "A filter cannot depend on the viewer.",
        hint: "Filters are sent to the server. Scope records on the server, or hide this view with a viewer condition.",
      },
    ]);
  }
}


const PERMISSION_KEYS: readonly string[] = ["update", "delete", "actions"];

/**
 * `can.actions` (RFC 0007): an object from action id to boolean, where only
 * `false` restricts. Anything else — not an object, a non-boolean value — is
 * malformed and the whole `can` is dropped, as with the other keys: a hint,
 * never an error.
 */
function validActions(value: unknown): Readonly<Record<string, boolean>> | false {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.some(([, v]) => typeof v !== "boolean")) return false;
  return Object.fromEntries(entries) as Record<string, boolean>;
}

/**
 * The `can` of a record from a server, if it is valid: an object of booleans
 * with only the known keys, plus `actions` as an object of booleans. A
 * malformed `can` is dropped (undefined), never an error: it is a hint.
 */
export function validCan(value: unknown): RecordPermissions | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([key, v]) => !PERMISSION_KEYS.includes(key) || (key !== "actions" && typeof v !== "boolean"))) return undefined;
  const can = value as Record<string, unknown>;
  const actions = can["actions"] === undefined ? undefined : validActions(can["actions"]);
  if (actions === false) return undefined; // malformed actions drops the whole can
  return {
    ...(typeof can["update"] === "boolean" ? { update: can["update"] } : {}),
    ...(typeof can["delete"] === "boolean" ? { delete: can["delete"] } : {}),
    ...(actions !== undefined ? { actions } : {}),
  };
}

/** The handler an adapter's options state for `<entity>.<action>`, or undefined. */
export function actionHandler(options: AdapterOptions | undefined, entity: string, action: string): ActionHandler | undefined {
  return options?.actions?.[`${entity}.${action}`];
}

/**
 * The checks `act` runs before the handler, in the order the protocol says
 * (RFC 0007): unknown action then unknown record (`RecordNotFoundError`),
 * `baseVersion` (`RecordConflictError` with the current record), then the
 * host's `can.actions[action] === false` or `can.update`-style rules
 * (`ForbiddenError`). Returns the handler to run; the caller stores its
 * outcome. A handler may itself throw `RecordConflictError`.
 */
export function assertActionRunnable(
  options: AdapterOptions | undefined,
  entity: string,
  id: string,
  action: string,
  existing: DataRecord | undefined,
  request: ActionRequest,
): { readonly handler: ActionHandler; readonly record: DataRecord } {
  const handler = actionHandler(options, entity, action);
  if (handler === undefined) {
    throw new RecordNotFoundError(`Entity "${entity}" has no action "${action}" (no handler was given to the adapter).`);
  }
  if (existing === undefined) {
    throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
  }
  if (existing.version !== request.meta.baseVersion) {
    throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, withPermissions(options, existing));
  }
  if (options?.recordPermissions?.(existing)?.actions?.[action] === false) {
    throw new ForbiddenError(`You are not allowed to run action "${action}" on the "${entity}" record "${id}".`);
  }
  assertPermitted(options, existing, "update"); // an action writes the record; update rules apply
  return { handler, record: existing };
}

/** What the handler asked for: a values patch, or removal. */
export type ActEffect = { readonly kind: "patch"; readonly values: RecordValues } | { readonly kind: "remove" };

/** Normalize an ActionOutcome to what the adapter stores. An outcome with neither member changes nothing (a no-op patch). */
export function actEffect(outcome: ActionOutcome): ActEffect {
  if ("remove" in outcome) {
    return { kind: "remove" };
  }
  return { kind: "patch", values: outcome.values ?? {} };
}
