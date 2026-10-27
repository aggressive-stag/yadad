import { isIsoDatetime } from "@yadad/core";
import type { EntityDocument, FieldValue, QuickFilter, RecordValues } from "@yadad/core";
import { instantToLocal } from "./datetime.js";

/** Where a range end is kept among the quick-filter values. A colon can never be in a field id, so it cannot collide with one. */
export const quickRangeKey = (end: "from" | "to", fieldId: string): string => `${end}:${fieldId}`;

/**
 * The quick-filter state a table opens with (RFC 0010 item 4): each filter's `default`, in the form the
 * filter's control keeps its value. Text, time, select, reference (a record id) and date-less values stay strings; a boolean is
 * "Yes" or "No"; tags are a string array; a number, date or datetime range is two values under
 * `quickRangeKey("from" | "to", field)`, a datetime bound shown as the local time "YYYY-MM-DDTHH:MM" in
 * `timeZone` (the stored instant is what the document holds). Filters without a default, and defaults that
 * do not fit their field, add nothing, so the state is {} for a view that declares none. It is initial state
 * only: clearing a chip empties the value, and nothing stores the default.
 */
export function initialQuickFilters(view: { readonly quickFilters?: readonly QuickFilter[] }, entity: EntityDocument, timeZone: string): RecordValues {
  const state: Record<string, FieldValue> = {};
  for (const { field: id, default: value } of view.quickFilters ?? []) {
    const field = entity.fields.find((f) => f.id === id);
    if (!field || value === undefined) continue;
    switch (field.type) {
      case "boolean":
        if (typeof value === "boolean") state[id] = value ? "Yes" : "No";
        break;
      case "tags":
        if (Array.isArray(value)) state[id] = value.filter((t): t is string => typeof t === "string" && t !== "");
        break;
      case "number":
      case "date":
      case "datetime": {
        if (typeof value !== "object" || Array.isArray(value)) break;
        const range = value as { readonly from?: unknown; readonly to?: unknown };
        for (const end of ["from", "to"] as const) {
          const bound = range[end];
          if (field.type === "number" && typeof bound === "number") state[quickRangeKey(end, id)] = bound;
          else if (field.type === "date" && typeof bound === "string") state[quickRangeKey(end, id)] = bound;
          else if (field.type === "datetime" && typeof bound === "string" && isIsoDatetime(bound)) state[quickRangeKey(end, id)] = instantToLocal(bound, timeZone);
        }
        break;
      }
      case "reference":
        if (typeof value === "string" && value !== "") state[id] = value; // a record id; the picker shows its label
        break;
      default:
        if (typeof value === "string") state[id] = value;
    }
  }
  return state;
}
