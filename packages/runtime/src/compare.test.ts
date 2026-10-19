// Compare cells (RFC 0007): neighbour widening and the per-row word diff,
// inside a page and at both edges, compare.field, empty comparators, cursor mode.

import type { DataRecord, Query, TableColumn } from "@yadad/core";
import { describe, expect, test } from "vitest";

import type { CompareCell } from "./compare.js";
import { compareCells, neighbourQuery } from "./compare.js";

function record(id: string, values: Record<string, string | null>): DataRecord {
  return { id, entityId: "note", entityRevision: 1, version: `v${id}`, values };
}

const textColumn: TableColumn = { field: "body", compare: { to: "previousRow" } };
const nextColumn: TableColumn = { field: "body", compare: { to: "nextRow" } };
const fieldColumn: TableColumn = { field: "body", compare: { field: "title" } };
const plainColumn: TableColumn = { field: "body" };

const rows = [
  record("r0", { body: "one two", title: "x" }),
  record("r1", { body: "one two three", title: "x y" }),
  record("r2", { body: "one two four" }),
];

const offsetQuery: Query = { page: { offset: 10, limit: 3 } };
const cursorQuery: Query = { page: { cursor: "abc", limit: 3 } };

function kinds(cell: CompareCell): string[] | undefined {
  return cell?.map((segment) => segment.kind);
}

/** Rebuild the after (same + added) or the before (same + removed) from a cell. */
function rebuild(cell: CompareCell, side: "after" | "before"): string {
  const drop = side === "after" ? "removed" : "added";
  return (
    cell
      ?.filter((segment) => segment.kind !== drop)
      .map((segment) => segment.text)
      .join("") ?? ""
  );
}

describe("neighbourQuery", () => {
  test("previousRow lowers the offset by one, never below zero", () => {
    expect(neighbourQuery(offsetQuery, textColumn)).toEqual({ page: { offset: 9, limit: 3 } });
    expect(neighbourQuery({ page: { offset: 0, limit: 3 } }, textColumn)).toEqual({ page: { offset: 0, limit: 3 } });
  });

  test("nextRow raises the limit by one", () => {
    expect(neighbourQuery(offsetQuery, nextColumn)).toEqual({ page: { offset: 10, limit: 4 } });
  });

  test("compare.field and a plain column get the query back unchanged", () => {
    expect(neighbourQuery(offsetQuery, fieldColumn)).toBe(offsetQuery);
    expect(neighbourQuery(offsetQuery, plainColumn)).toBe(offsetQuery);
  });

  test("cursor pages and pageless queries are returned unchanged", () => {
    expect(neighbourQuery(cursorQuery, textColumn)).toBe(cursorQuery);
    expect(neighbourQuery(cursorQuery, nextColumn)).toBe(cursorQuery);
    const noPage: Query = { filter: { op: "empty", field: "body" } };
    expect(neighbourQuery(noPage, textColumn)).toBe(noPage);
  });
});

describe("compareCells", () => {
  test("previousRow inside a page diffs against the row above; the page's first row has none", () => {
    const cells = compareCells(rows, textColumn);
    expect(cells[0]).toBeUndefined();
    expect(kinds(cells[1])).toEqual(["same", "added"]);
    expect(rebuild(cells[1], "after")).toBe("one two three");
    expect(rebuild(cells[1], "before")).toBe("one two");
    expect(rebuild(cells[2], "after")).toBe("one two four");
    expect(rebuild(cells[2], "before")).toBe("one two three");
  });

  test("previousRow at the page edge uses the extra edge row", () => {
    const edge = { items: [record("rEdge", { body: "one" })] };
    const cells = compareCells(rows, textColumn, edge);
    expect(kinds(cells[0])).toEqual(["same", "added"]);
    expect(rebuild(cells[0], "after")).toBe("one two");
    expect(rebuild(cells[0], "before")).toBe("one");
  });

  test("nextRow inside a page diffs against the row below; the page's last row has none without an edge", () => {
    const cells = compareCells(rows, nextColumn);
    expect(kinds(cells[0])).toEqual(["same", "removed"]);
    expect(rebuild(cells[0], "after")).toBe("one two");
    expect(rebuild(cells[1], "after")).toBe("one two three");
    expect(rebuild(cells[1], "before")).toBe("one two four");
    expect(cells[2]).toBeUndefined();
  });

  test("nextRow at the page edge uses the extra edge row", () => {
    const edge = { items: [record("rEdge", { body: "one two three four" })] };
    const cells = compareCells(rows, nextColumn, edge);
    expect(cells[2]).toBeDefined();
    expect(rebuild(cells[2], "after")).toBe("one two four");
    expect(rebuild(cells[2], "before")).toBe("one two three four");
  });

  test("compare.field diffs the column value (after) against the other field (before) of the same record", () => {
    const cells = compareCells(rows, fieldColumn);
    expect(cells.every((cell) => cell !== undefined)).toBe(true);
    expect(rebuild(cells[1], "after")).toBe("one two three");
    expect(rebuild(cells[1], "before")).toBe("x y");
  });

  test("an empty comparator counts as the empty string: everything is added", () => {
    const only = [record("r0", { body: "hello there" })];
    // Edge row whose comparator value is null.
    const cells = compareCells(only, textColumn, { items: [record("rEdge", { body: null })] });
    expect(cells[0]).toEqual([{ kind: "added", text: "hello there" }]);
    // compare.field pointing at an absent field.
    const fieldCells = compareCells(only, { field: "body", compare: { field: "missing" } });
    expect(fieldCells[0]).toEqual([{ kind: "added", text: "hello there" }]);
  });

  test("a row whose own value is empty against a neighbour is all removed", () => {
    const pair = [record("r0", { body: "gone text" }), record("r1", { body: null })];
    expect(compareCells(pair, textColumn)[1]).toEqual([{ kind: "removed", text: "gone text" }]);
  });

  test("cursor mode: the first row shows plain text unless the caller passes the previous page's last row as edge", () => {
    expect(compareCells(rows, textColumn)[0]).toBeUndefined();
    const edge = { items: [record("prevPageLast", { body: "one" })] };
    expect(rebuild(compareCells(rows, textColumn, edge)[0], "after")).toBe("one two");
  });

  test("a column with no compare has no cells", () => {
    expect(compareCells(rows, plainColumn)).toEqual([undefined, undefined, undefined]);
  });
});
