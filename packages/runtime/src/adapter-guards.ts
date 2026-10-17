import { ForbiddenError, RecordValidationError } from "@yadad/core";
import type { AdapterOptions } from "./memory-adapter.js";
import type { Condition, DataRecord, Query, RecordPermissions } from "@yadad/core";

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


const PERMISSION_KEYS: readonly string[] = ["update", "delete"];

/**
 * The `can` of a record from a server, if it is valid: an object of booleans
 * with only the known keys. A malformed `can` is dropped (undefined), never an
 * error: it is a hint.
 */
export function validCan(value: unknown): RecordPermissions | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([key, v]) => !PERMISSION_KEYS.includes(key) || typeof v !== "boolean")) return undefined;
  const can = value as Record<string, boolean>;
  return { ...(can["update"] !== undefined ? { update: can["update"] } : {}), ...(can["delete"] !== undefined ? { delete: can["delete"] } : {}) };
}
