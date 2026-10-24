import { describe, expect, test } from "vitest";
import type { BoardView, DataRecord, EntityDocument, ReferenceField } from "@yadad/core";
import { SPEC_VERSION } from "@yadad/core";
import { createMemoryAdapter } from "./memory-adapter.js";
import {
  BOARD_MAX_CARDS,
  BOARD_MAX_COLUMNS,
  BOARD_PAGE_SIZE,
  boardColumnCounts,
  boardColumns,
  boardGroupChoices,
  boardGroupField,
  boardQuery,
  groupByColumn,
  loadBoardCards,
  loadBoardTargets,
  moveCard,
} from "./board.js";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "task",
  revision: 4,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["Todo", "In progress", "Done"] } },
    { id: "flag", type: "boolean", label: "Flag" },
    { id: "required_flag", type: "boolean", label: "Required flag", required: true },
    { id: "assignee", type: "reference", label: "Assignee", entity: "person" },
    { id: "required_assignee", type: "reference", label: "Required assignee", entity: "person", required: true },
    { id: "required_status", type: "select", label: "Required status", required: true, options: { source: "static", values: ["A", "B"] } },
  ],
} as EntityDocument;

const person: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "person",
  revision: 1,
  fields: [{ id: "name", type: "text", label: "Name" }],
} as EntityDocument;

const view: BoardView = {
  kind: "board",
  specVersion: SPEC_VERSION,
  id: "board",
  entity: "task",
  revision: 1,
  dataSource: "main",
  groupBy: [{ field: "status" }, { field: "assignee" }, { field: "flag" }],
};

const statusField = entity.fields.find((f) => f.id === "status")!;
const flagField = entity.fields.find((f) => f.id === "flag")!;
const requiredFlagField = entity.fields.find((f) => f.id === "required_flag")!;
const assigneeField = entity.fields.find((f) => f.id === "assignee")! as ReferenceField;
const requiredAssigneeField = entity.fields.find((f) => f.id === "required_assignee")!;
const requiredStatusField = entity.fields.find((f) => f.id === "required_status")!;

const record = (id: string, values: DataRecord["values"], extra: Partial<DataRecord> = {}): DataRecord => ({
  id,
  entityId: "task",
  entityRevision: 4,
  version: "1",
  values,
  ...extra,
});

describe("boardGroupField", () => {
  test("returns the requested field when it is one of the view's groupings", () => {
    expect(boardGroupField(view, entity, "assignee").id).toBe("assignee");
  });
  test("falls back to the first grouping for an unknown or omitted request", () => {
    expect(boardGroupField(view, entity).id).toBe("status");
    expect(boardGroupField(view, entity, "title").id).toBe("status");
    expect(boardGroupField(view, entity, "nope").id).toBe("status");
  });
});

describe("boardGroupChoices", () => {
  test("one entry per groupBy field, with labels, in order", () => {
    expect(boardGroupChoices(view, entity)).toEqual([
      { field: "status", label: "Status" },
      { field: "assignee", label: "Assignee" },
      { field: "flag", label: "Flag" },
    ]);
  });
});

describe("boardColumns: select", () => {
  test("one column per option, in option order, plus an empty column first when not required", () => {
    expect(boardColumns(statusField)).toEqual([
      { id: "empty", kind: "empty", label: "No Status", value: null },
      { id: "v:Todo", kind: "value", label: "Todo", value: "Todo" },
      { id: "v:In progress", kind: "value", label: "In progress", value: "In progress" },
      { id: "v:Done", kind: "value", label: "Done", value: "Done" },
    ]);
  });
  test("a required select field gets no empty column", () => {
    expect(boardColumns(requiredStatusField)).toEqual([
      { id: "v:A", kind: "value", label: "A", value: "A" },
      { id: "v:B", kind: "value", label: "B", value: "B" },
    ]);
  });
});

describe("boardColumns: boolean", () => {
  test("exactly Yes and No, never an empty column", () => {
    expect(boardColumns(flagField)).toEqual([
      { id: "v:true", kind: "value", label: "Yes", value: true },
      { id: "v:false", kind: "value", label: "No", value: false },
    ]);
    expect(boardColumns(requiredFlagField)).toEqual(boardColumns(flagField));
  });
});

describe("boardColumns: reference", () => {
  const targets = [
    { id: "p1", label: "Ann" },
    { id: "p2", label: "Bo" },
  ];
  test("without loaded targets, no columns (not loaded yet)", () => {
    expect(boardColumns(assigneeField)).toEqual([]);
  });
  test("one column per loaded target record, in given order, plus empty first when not required", () => {
    expect(boardColumns(assigneeField, targets)).toEqual([
      { id: "empty", kind: "empty", label: "No Assignee", value: null },
      { id: "v:p1", kind: "value", label: "Ann", value: "p1" },
      { id: "v:p2", kind: "value", label: "Bo", value: "p2" },
    ]);
  });
  test("a required reference field gets no empty column", () => {
    expect(boardColumns(requiredAssigneeField, targets)).toEqual([
      { id: "v:p1", kind: "value", label: "Ann", value: "p1" },
      { id: "v:p2", kind: "value", label: "Bo", value: "p2" },
    ]);
  });
});

describe("groupByColumn", () => {
  const columns = boardColumns(statusField);
  test("groups by value, preserving input (sort) order within a column", () => {
    const records = [
      record("a", { status: "Todo" }),
      record("b", { status: "Done" }),
      record("c", { status: "Todo" }),
      record("d", { status: "In progress" }),
    ];
    const grouped = groupByColumn(statusField, columns, records);
    expect(grouped.get("v:Todo")?.map((r) => r.id)).toEqual(["a", "c"]);
    expect(grouped.get("v:Done")?.map((r) => r.id)).toEqual(["b"]);
    expect(grouped.get("v:In progress")?.map((r) => r.id)).toEqual(["d"]);
    expect(grouped.has("other")).toBe(false);
  });
  test("a missing, null or empty value goes to the empty column", () => {
    const records = [record("a", {}), record("b", { status: null }), record("c", { status: "" })];
    const grouped = groupByColumn(statusField, columns, records);
    expect(grouped.get("empty")?.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  test("an unknown value (option removed, or legacy data) goes to other, only when needed", () => {
    const records = [record("a", { status: "Todo" }), record("b", { status: "Archived" })];
    const grouped = groupByColumn(statusField, columns, records);
    expect(grouped.get("other")?.map((r) => r.id)).toEqual(["b"]);
  });
  test("a required field's legacy empty value goes to other (no empty column to catch it)", () => {
    const requiredColumns = boardColumns(requiredStatusField);
    const grouped = groupByColumn(requiredStatusField, requiredColumns, [record("a", { required_status: "" })]);
    expect(grouped.get("other")?.map((r) => r.id)).toEqual(["a"]);
  });
  test("boolean: missing or null counts as No, never other", () => {
    const booleanColumns = boardColumns(flagField);
    const grouped = groupByColumn(flagField, booleanColumns, [record("a", {}), record("b", { flag: null }), record("c", { flag: true }), record("d", { flag: false })]);
    expect(grouped.get("v:false")?.map((r) => r.id)).toEqual(["a", "b", "d"]);
    expect(grouped.get("v:true")?.map((r) => r.id)).toEqual(["c"]);
    expect(grouped.has("other")).toBe(false);
  });
  test("a reference beyond the loaded column cap goes to other", () => {
    const targets = [{ id: "p1", label: "Ann" }];
    const refColumns = boardColumns(assigneeField, targets);
    const grouped = groupByColumn(assigneeField, refColumns, [record("a", { assignee: "p1" }), record("b", { assignee: "p9" })]);
    expect(grouped.get("v:p1")?.map((r) => r.id)).toEqual(["a"]);
    expect(grouped.get("other")?.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("boardColumnCounts", () => {
  test("every column's count, then other last only when present", () => {
    const columns = boardColumns(statusField);
    const grouped = groupByColumn(statusField, columns, [record("a", { status: "Todo" }), record("b", { status: "Weird" })]);
    expect(boardColumnCounts(columns, grouped)).toEqual([
      { id: "empty", count: 0 },
      { id: "v:Todo", count: 1 },
      { id: "v:In progress", count: 0 },
      { id: "v:Done", count: 0 },
      { id: "other", count: 1 },
    ]);
  });
  test("no other entry when nothing fits there", () => {
    const columns = boardColumns(statusField);
    const grouped = groupByColumn(statusField, columns, [record("a", { status: "Todo" })]);
    expect(boardColumnCounts(columns, grouped).some((c) => c.id === "other")).toBe(false);
  });
});

describe("boardQuery", () => {
  test("sorts by the view's sort, or the default title field, 500 per page from 0", () => {
    expect(boardQuery(view, { entity }).sort).toEqual([{ field: "title", dir: "asc" }]);
    expect(boardQuery({ ...view, sort: [{ field: "status", dir: "desc" }] }, { entity }).sort).toEqual([{ field: "status", dir: "desc" }]);
    expect(boardQuery(view).page).toEqual({ offset: 0, limit: BOARD_PAGE_SIZE });
    expect(BOARD_PAGE_SIZE).toBe(500);
    expect(BOARD_MAX_CARDS).toBe(1000);
    expect(BOARD_MAX_COLUMNS).toBe(50);
  });
  test("no filter key at all when the view has none", () => {
    expect(boardQuery(view)).not.toHaveProperty("filter");
  });
  test("the view's filter is carried through, with relative dates resolved", () => {
    const filtered: BoardView = { ...view, filter: { op: "eq", field: "status", value: "Todo" } };
    expect(boardQuery(filtered).filter).toEqual({ op: "eq", field: "status", value: "Todo" });
  });
});

describe("loadBoardCards", () => {
  const seed = async (count: number, options?: { paging?: "cursor" }) => {
    const db = createMemoryAdapter({ fields: { task: ["title", "status"] }, ...options });
    const meta = { entityRevision: 4 };
    for (let i = 0; i < count; i++) await db.create("task", { title: `t${String(i).padStart(5, "0")}`, status: "Todo" }, meta);
    return db;
  };

  test("loads every card when under one page", async () => {
    const db = await seed(10);
    const load = await loadBoardCards(db, view, { entity });
    expect(load.records).toHaveLength(10);
    expect(load.total).toBe(10);
    expect(load.truncated).toBe(false);
  });

  test("pages through more than one page, de-duplicated, no truncation under the cap", async () => {
    const db = await seed(700);
    const load = await loadBoardCards(db, view, { entity });
    expect(load.records).toHaveLength(700);
    expect(new Set(load.records.map((r) => r.id)).size).toBe(700);
    expect(load.truncated).toBe(false);
  });

  test("past the 1000-card cap: reads 1000 and reports truncated", async () => {
    const db = await seed(1500);
    const load = await loadBoardCards(db, view, { entity });
    expect(load.records).toHaveLength(1000);
    expect(load.total).toBe(1500);
    expect(load.truncated).toBe(true);
  });

  test("an empty board", async () => {
    const db = await seed(0);
    expect(await loadBoardCards(db, view, { entity })).toEqual({ records: [], total: 0, truncated: false });
  });

  test("a counting-free server is walked by next up to the cap", async () => {
    const db = await seed(1200, { paging: "cursor" });
    let requests = 0;
    const spy = { ...db, find: (e: string, q: Parameters<typeof db.find>[1]) => (requests++, db.find(e, q)) };
    const load = await loadBoardCards(spy, view, { entity });
    expect(load.records).toHaveLength(BOARD_MAX_CARDS);
    expect(new Set(load.records.map((r) => r.id)).size).toBe(BOARD_MAX_CARDS);
    expect(load.total).toBe(BOARD_MAX_CARDS);
    expect(load.truncated).toBe(true);
    expect(requests).toBe(Math.ceil(BOARD_MAX_CARDS / BOARD_PAGE_SIZE));
  });

  test("a counting-free server under the cap reads every card with no truncation", async () => {
    const db = await seed(60, { paging: "cursor" });
    const load = await loadBoardCards(db, view, { entity });
    expect(load.records).toHaveLength(60);
    expect(new Set(load.records.map((r) => r.id)).size).toBe(60);
    expect(load.total).toBe(60);
    expect(load.truncated).toBe(false);
  });
});

describe("loadBoardTargets", () => {
  test("wraps loadReferenceOptions with the board's column cap", async () => {
    const db = createMemoryAdapter({ fields: { person: ["name"] } });
    const meta = { entityRevision: 1 };
    for (let i = 0; i < 60; i++) await db.create("person", { name: `p${String(i).padStart(3, "0")}` }, meta);
    const loaded = await loadBoardTargets(db, person, assigneeField);
    expect(loaded.options).toHaveLength(50);
    expect(loaded.more).toBe(true);
    expect(loaded.total).toBe(60);
    expect(loaded.options[0]?.label).toBe("p000");
  });
});

describe("moveCard", () => {
  const editableView: BoardView = { ...view, editable: true };
  const statusColumns = boardColumns(statusField);
  const findColumn = (id: string) => statusColumns.find((c) => c.id === id)!;
  const task = (status: string | null): DataRecord => record("r1", { title: "Pay rent", status }, { version: "v7", entityRevision: 3 });

  test("plans a field-only update with the entity revision and base version", () => {
    expect(moveCard(editableView, entity, statusField, task("Todo"), findColumn("v:Done"))).toEqual({
      kind: "update",
      entity: "task",
      id: "r1",
      patch: { status: "Done" },
      meta: { entityRevision: 4, baseVersion: "v7" },
    });
  });

  test("moving to the current column, or on a view that is not editable, sends nothing", () => {
    expect(moveCard(editableView, entity, statusField, task("Done"), findColumn("v:Done"))).toEqual({ kind: "none", reason: "same-column" });
    expect(moveCard(view, entity, statusField, task("Todo"), findColumn("v:Done"))).toEqual({ kind: "none", reason: "not-editable" });
  });

  test("moving to empty clears the field (null)", () => {
    expect(moveCard(editableView, entity, statusField, task("Todo"), findColumn("empty"))).toEqual({
      kind: "update",
      entity: "task",
      id: "r1",
      patch: { status: null },
      meta: { entityRevision: 4, baseVersion: "v7" },
    });
  });

  test("a card already with no value is a no-op moving to empty", () => {
    expect(moveCard(editableView, entity, statusField, task(null), findColumn("empty"))).toEqual({ kind: "none", reason: "same-column" });
  });

  test("moving to other is refused, whatever the card's current value", () => {
    const other = { id: "other", kind: "other" as const, label: "Other", value: null };
    expect(moveCard(editableView, entity, statusField, task("Todo"), other)).toMatchObject({ kind: "blocked", reason: "other" });
  });
});
