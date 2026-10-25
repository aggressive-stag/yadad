import type { Condition, FieldValue, RecordValues, RowBinding } from "@yadad/core";

const isEmpty = (v: FieldValue | undefined): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * The filter a row action's target view shows for one clicked row: the
 * target's own `filter` AND one `eq(to, row[field])` per binding (an empty row
 * value becomes `empty(to)`). Pure: neither the row, the bindings nor the
 * target's filter is modified, and the target document is never touched.
 * Returns undefined when there is nothing to filter by (no bindings and no
 * own filter).
 */
export function bindFilter(row: RecordValues, bindings: readonly RowBinding[], targetFilter?: Condition): Condition | undefined {
  const bound: Condition[] = bindings.map((b): Condition => {
    const value = row[b.field];
    if (isEmpty(value) || value === undefined || value === null) return { op: "empty", field: b.to };
    // RFC 0008 item 15 (card 47k): a tags row value is a list, so it binds with `in` — the target matches when it holds ANY of the row's tags.
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { op: "eq", field: b.to, value };
    return { op: "in", field: b.to, values: value };
  });
  const all = targetFilter ? [targetFilter, ...bound] : bound;
  if (all.length === 0) return undefined;
  const [only] = all;
  return all.length === 1 && only ? only : { op: "and", conditions: all };
}
