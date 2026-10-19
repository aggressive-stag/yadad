// Compare cells for table columns (RFC 0007, "Neighbour at a page edge" and
// "Meaning"). The cell shows the column's value as the after and the
// comparator's value as the before; the comparator is the same field in a
// neighbouring row (`to`) or another text field of the same record (`field`).

import type { ColumnCompare, DataRecord, DiffSegment, Query, TableColumn } from "@yadad/core";

import { diffWords } from "./diff.js";

/** One row's compare cell: the word diff, or undefined when there is no neighbour. */
export type CompareCell = readonly DiffSegment[] | undefined;

/**
 * The extra row loaded beyond the page edge for a `to` compare, as its own
 * one-row page (the widened query's edge row). For `previousRow` it is the row
 * before the page's first row; for `nextRow`, the row after its last.
 */
export interface CompareEdge {
  readonly items: readonly DataRecord[];
}

/**
 * Widen an offset page by one row so the first/last row of the page still has
 * its neighbour: `offset - 1` (never below 0) for `previousRow`, `limit + 1`
 * for `nextRow`, keeping the same filter and sort. The query is returned
 * unchanged for a `compare.field` column (the comparator is in the record) and
 * for a column with no `compare`. Cursor pages cannot be widened backwards, so
 * a cursor query with `previousRow` is also returned unchanged — pass the
 * previous page's last row as `edge` to `compareCells` instead.
 */
export function neighbourQuery(query: Query, column: TableColumn): Query {
  const compare = neighbourCompare(column);
  const page = query.page;
  if (compare === undefined || page === undefined || !("offset" in page)) {
    return query;
  }
  if (compare.to === "previousRow") {
    return { ...query, page: { offset: Math.max(0, page.offset - 1), limit: page.limit } };
  }
  return { ...query, page: { offset: page.offset, limit: page.limit + 1 } };
}

/**
 * The word diff of each row's column value (the after) against its comparator
 * (the before), or `undefined` for a row with no neighbour — the oldest
 * version shows plain text. `edge` is the extra row from `neighbourQuery`: for
 * `previousRow` the row before the page's first row, for `nextRow` the row
 * after its last; its first item is used. A comparator that is empty (absent,
 * null or not a string) counts as the empty string, so everything is added.
 */
export function compareCells(rows: readonly DataRecord[], column: TableColumn, edge?: CompareEdge): CompareCell[] {
  const compare: ColumnCompare | undefined = column.compare;
  if (compare === undefined) {
    return rows.map(() => undefined);
  }
  if (compare.to === undefined) {
    const field = compare.field;
    return rows.map((row) => diffWords(fieldText(row, field), fieldText(row, column.field)));
  }
  const edgeRow = edge?.items[0];
  const last = rows.length - 1;
  return rows.map((row, index) => {
    const neighbour =
      compare.to === "previousRow"
        ? index === 0
          ? edgeRow
          : rows[index - 1]
        : index === last
          ? edgeRow
          : rows[index + 1];
    if (neighbour === undefined) {
      return undefined;
    }
    return diffWords(fieldText(neighbour, column.field), fieldText(row, column.field));
  });
}

/** The neighbour side of a compare, or undefined when there is nothing to widen for. */
function neighbourCompare(column: TableColumn): { to: "previousRow" | "nextRow" } | undefined {
  const compare: ColumnCompare | undefined = column.compare;
  return compare !== undefined && "to" in compare && compare.to !== undefined ? { to: compare.to } : undefined;
}

/** A comparator value that is empty (absent, null or not a string) counts as "". */
function fieldText(row: DataRecord, field: string): string {
  const value = row.values[field];
  return typeof value === "string" ? value : "";
}
