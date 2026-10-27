import { sectionItems, validateDocument, validateDocuments } from "@yadad/core";
import type { BoardView, CalendarView, ColumnCompare, DashboardView, EntityDocument, FormView, TableView } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { describe, expect, test } from "vitest";
import { blankDashboard, blankEntity, blankForm, blankTable } from "./blank.js";
import { addTab, addWidget, freeSpot, removeTab, removeWidget, renameTab, uniqueItemId } from "./layout.js";
import { edit, finish, startSession } from "./session.js";
import type { EditSession } from "./session.js";
import {
  addColumn,
  addFormItem,
  addSection,
  fieldsNotInTable,
  fieldsNotOnForm,
  moveColumn,
  moveColumnTo,
  moveFieldTo,
  moveFormItem,
  moveOfferedRecordAction,
  moveSection,
  moveSectionTo,
  offerRecordAction,
  removeColumn,
  removeFormItem,
  removeSection,
  setColumnEditable,
  setClearWhenHidden,
  setColumnCompare,
  setCountWidgetFilter,
  setFormItemCondition,
  setPageSize,
  setQuickFilter,
  setRecordActions,
  setSectionTitle,
  setTableFilter,
  setTableSort,
  setTableTitle,
  unofferRecordAction,
} from "./views.js";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "done", type: "boolean", label: "Done" },
    { id: "due", type: "date", label: "Due" },
  ],
};

const form: FormView = {
  kind: "form",
  specVersion: 0,
  id: "task_form",
  entity: "task",
  revision: 1,
  dataSource: "default",
  sections: [
    { id: "main", title: "Task", items: [{ field: "title" }, { field: "done" }] },
    { id: "more", items: [] },
  ],
};

const table: TableView = { kind: "table", specVersion: 0, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "due" }] };

/** Applies a helper's result through a session, failing the test if the helper or validation refused it. */
function apply<T extends FormView | TableView | DashboardView>(s: EditSession<T>, result: PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false }): EditSession<T> {
  if (!Array.isArray(result) && !result.ok) throw new Error("helper refused the edit");
  const next = edit(s, Array.isArray(result) ? result : result.patch);
  expect(next.rejected).toEqual([]);
  return next;
}

const fieldsOf = (v: FormView) => v.sections.map((s) => `${s.id}:${sectionItems(s).map((i) => i.field).join(",")}`); // // RFC 0008/9: card 47b

describe("form view edits", () => {
  test("lists the entity fields the form does not place yet", () => {
    expect(fieldsNotOnForm(entity, form)).toEqual(["due"]);
  });

  test("adds, moves across sections and removes fields", () => {
    let s = startSession(form);
    s = apply(s, addFormItem(s.current, "more", "due"));
    expect(fieldsOf(s.current)).toEqual(["main:title,done", "more:due"]);
    s = apply(s, moveFormItem(s.current, "done", 1));
    expect(fieldsOf(s.current)).toEqual(["main:title", "more:done,due"]);
    s = apply(s, moveFormItem(s.current, "done", -1));
    expect(fieldsOf(s.current)).toEqual(["main:title,done", "more:due"]);
    s = apply(s, moveFormItem(s.current, "title", 1));
    expect(fieldsOf(s.current)).toEqual(["main:done,title", "more:due"]);
    s = apply(s, removeFormItem(s.current, "title"));
    expect(fieldsOf(s.current)).toEqual(["main:done", "more:due"]);
    expect(moveFormItem(s.current, "done", -1).ok).toBe(false);
    expect(moveFormItem(s.current, "due", 1).ok).toBe(false);
  });

  test("adds, retitles, reorders and removes sections", () => {
    let s = startSession(form);
    s = apply(s, addSection(s.current, "notes", "Notes"));
    s = apply(s, setSectionTitle(s.current, "more", "More"));
    expect(s.current.sections[1]?.title).toBe("More");
    s = apply(s, setSectionTitle(s.current, "more", "  "));
    expect(s.current.sections[1]?.title).toBeUndefined();
    s = apply(s, moveSection(s.current, "notes", -1));
    expect(s.current.sections.map((x) => x.id)).toEqual(["main", "notes", "more"]);
    s = apply(s, removeSection(s.current, "main"));
    expect(s.current.sections.map((x) => x.id)).toEqual(["notes", "more"]);
  });

  test("a section id already in use is refused by validation", () => {
    expect(edit(startSession(form), addSection(form, "main")).rejected[0]?.code).toBe("duplicate-id");
  });

  test("moves a field to any position in any section, one patch per move", () => {
    // The form is main:[title, done], more:[]; the entity fields are title, done, due.
    expect(moveFieldTo(form, "done", "main", 0).ok).toBe(true); // within its section
    expect(fieldsOf(apply(startSession(form), moveFieldTo(form, "done", "main", 0)).current)).toEqual([
      "main:done,title",
      "more:",
    ]);
    expect(fieldsOf(apply(startSession(form), moveFieldTo(form, "title", "main", 1)).current)).toEqual([
      "main:done,title",
      "more:",
    ]);
    // Across sections, into the empty one.
    expect(fieldsOf(apply(startSession(form), moveFieldTo(form, "title", "more", 0)).current)).toEqual([
      "main:done",
      "more:title",
    ]);
    // Across sections, between existing rows: due joins more after title.
    let s = apply(startSession(form), moveFieldTo(form, "title", "more", 0));
    s = apply(s, addFormItem(s.current, "more", "due"));
    expect(fieldsOf(s.current)).toEqual(["main:done", "more:title,due"]);
    s = apply(s, moveFieldTo(s.current, "due", "main", 0));
    expect(fieldsOf(s.current)).toEqual(["main:due,done", "more:title"]);
    // No-op: a field where it already is produces no patch, so no undo step.
    const noop = moveFieldTo(form, "title", "main", 0);
    expect(noop.ok).toBe(true);
    if (noop.ok) expect(noop.patch).toHaveLength(0);
    // Refusals: a position past the end, a missing field, a missing section.
    expect(moveFieldTo(form, "title", "main", 5).ok).toBe(false);
    expect(moveFieldTo(form, "nope", "main", 0).ok).toBe(false);
    expect(moveFieldTo(form, "title", "nope", 0).ok).toBe(false);
  });

  test("moves a section to any position, one patch per move", () => {
    let s = startSession(form);
    s = apply(s, moveSectionTo(s.current, "more", 0));
    expect(s.current.sections.map((x) => x.id)).toEqual(["more", "main"]);
    s = apply(s, moveSectionTo(s.current, "more", 1));
    expect(s.current.sections.map((x) => x.id)).toEqual(["main", "more"]);
    // No-op: a section where it already is produces no patch.
    const noop = moveSectionTo(form, "main", 0);
    expect(noop.ok).toBe(true);
    if (noop.ok) expect(noop.patch).toHaveLength(0);
    // Refusals: a position past the end, a missing section.
    expect(moveSectionTo(form, "main", 2).ok).toBe(false);
    expect(moveSectionTo(form, "nope", 0).ok).toBe(false);
  });
});

describe("table view edits", () => {
  test("adds, moves, edits and removes columns, keeping at least one", () => {
    expect(fieldsNotInTable(entity, table)).toEqual(["done"]);
    let s = startSession(table);
    s = apply(s, addColumn(s.current, "done"));
    s = apply(s, moveColumn(s.current, "done", -1));
    expect(s.current.columns.map((c) => c.field)).toEqual(["title", "done", "due"]);
    s = apply(s, setColumnEditable(s.current, "done", true));
    expect(s.current.columns[1]).toEqual({ field: "done", editable: true });
    s = apply(s, setColumnEditable(s.current, "done", false));
    expect(s.current.columns[1]).toEqual({ field: "done" });
    s = apply(s, removeColumn(s.current, "title"));
    s = apply(s, removeColumn(s.current, "done"));
    expect(removeColumn(s.current, "due").ok).toBe(false);
  });

  test("moves a column to any position, one patch per move", () => {
    let s = startSession(table);
    s = apply(s, moveColumnTo(s.current, "due", 0));
    expect(s.current.columns.map((c) => c.field)).toEqual(["due", "title"]);
    s = apply(s, moveColumnTo(s.current, "due", 1));
    expect(s.current.columns.map((c) => c.field)).toEqual(["title", "due"]);
    // No-op: a column where it already is produces no patch.
    const noop = moveColumnTo(table, "title", 0);
    expect(noop.ok).toBe(true);
    if (noop.ok) expect(noop.patch).toHaveLength(0);
    // Refusals: a position past the end, a missing column.
    expect(moveColumnTo(table, "title", 2).ok).toBe(false);
    expect(moveColumnTo(table, "nope", 0).ok).toBe(false);
  });

  test("sets and clears title, sort, page size and quick filters", () => {
    let s = startSession(table);
    s = apply(s, setTableTitle(s.current, "Tasks"));
    s = apply(s, setTableSort(s.current, { field: "due", dir: "asc" }));
    s = apply(s, setPageSize(s.current, 10));
    s = apply(s, setQuickFilter(s.current, "done", true));
    expect(s.current).toMatchObject({ title: "Tasks", sort: [{ field: "due", dir: "asc" }], pageSize: 10, quickFilters: [{ field: "done" }] });
    s = apply(s, setTableTitle(s.current, ""));
    s = apply(s, setTableSort(s.current, undefined));
    s = apply(s, setPageSize(s.current, undefined));
    s = apply(s, setQuickFilter(s.current, "done", false));
    expect(s.current).toEqual(table);
  });

  test("sets and clears a rows-always-match; a bad field ref is the set validator's find", () => {
    let s = startSession(table);
    s = apply(s, setTableFilter(s.current, { op: "eq", field: "done", value: true }));
    expect(s.current).toMatchObject({ filter: { op: "eq", field: "done", value: true } });
    s = apply(s, setTableFilter(s.current, undefined));
    expect(s.current).toEqual(table);
    // A condition that only references fields the entity has is a valid set.
    const good = apply(startSession(table), setTableFilter(table, { op: "eq", field: "done", value: true }));
    expect(validateDocuments([entity, good.current]).ok).toBe(true);
    // A condition naming a field that is not on the entity: the single-document
    // validator sees only shape and accepts it; the cross-document set validator
    // is what refuses the reference.
    const r = setTableFilter(table, { op: "eq", field: "nope", value: true });
    if (!r.ok) throw new Error("the helper should have built the patch");
    const broken = edit(startSession(table), r.patch);
    expect(broken.rejected).toEqual([]);
    expect(validateDocuments([entity, broken.current]).ok).toBe(false);
  });
});

describe("form item condition edits", () => {
  test("sets and clears visibleWhen / requiredWhen / clearWhenHidden", () => {
    let s = startSession(form);
    s = apply(s, setFormItemCondition(s.current, "done", "visibleWhen", { op: "eq", field: "title", value: "" }));
    s = apply(s, setFormItemCondition(s.current, "done", "requiredWhen", { op: "empty", field: "due" }));
    s = apply(s, setClearWhenHidden(s.current, "done", true));
    expect(sectionItems(s.current.sections[0]!).find((i) => i.field === "done")).toEqual({ // // RFC 0008/9: card 47b
      field: "done",
      visibleWhen: { op: "eq", field: "title", value: "" },
      requiredWhen: { op: "empty", field: "due" },
      clearWhenHidden: true,
    });
    s = apply(s, setFormItemCondition(s.current, "done", "visibleWhen", undefined));
    s = apply(s, setFormItemCondition(s.current, "done", "requiredWhen", undefined));
    s = apply(s, setClearWhenHidden(s.current, "done", false));
    expect(s.current).toEqual(form);
  });

  test("refuses an item that is not on the form; a bad field ref is the set validator's find", () => {
    // The helper guards the item's existence on the form.
    expect(setFormItemCondition(form, "nope", "visibleWhen", { op: "empty", field: "due" }).ok).toBe(false);
    expect(setClearWhenHidden(form, "nope", true).ok).toBe(false);
    // A condition naming a field not on the entity passes the single-document
    // validation (shape only); the cross-document set validator refuses it.
    const r = setFormItemCondition(form, "done", "visibleWhen", { op: "eq", field: "nope", value: 1 });
    if (!r.ok) throw new Error("the helper should have built the patch");
    const broken = edit(startSession(form), r.patch);
    expect(broken.rejected).toEqual([]);
    expect(validateDocuments([entity, broken.current]).ok).toBe(false);
  });
});

describe("count widget filter edits", () => {
  const withCount = (): DashboardView => {
    const d = blankDashboard("home", "Home");
    const s = startSession(d);
    const next = edit(s, addWidget(s.current, "main", "tasks", { widget: "count", label: "Open", view: "tasks" }, 4, 2));
    expect(next.rejected).toEqual([]);
    return next.current;
  };

  test("sets and clears the count filter without touching the counted table", () => {
    let s = startSession(withCount());
    const before = s.current;
    s = apply(s, setCountWidgetFilter(s.current, "main", "tasks", { op: "eq", field: "done", value: false }));
    expect(s.current.tabs[0]?.items.find((i) => i.id === "tasks")).toMatchObject({ filter: { op: "eq", field: "done", value: false } });
    expect(s.current).not.toEqual(before);
    s = apply(s, setCountWidgetFilter(s.current, "main", "tasks", undefined));
    expect(s.current.tabs[0]?.items.find((i) => i.id === "tasks")).not.toHaveProperty("filter");
  });

  test("refuses a missing tab, item, or a non-count widget", () => {
    const d = withCount();
    expect(setCountWidgetFilter(d, "nope", "tasks", undefined).ok).toBe(false);
    expect(setCountWidgetFilter(d, "main", "nope", undefined).ok).toBe(false);
  });
});

describe("dashboard widgets and tabs", () => {
  const dashboard = blankDashboard("home", "Home");

  test("free spots fill rows left to right, then below", () => {
    expect(freeSpot([], 12, 6, 2)).toEqual({ x: 0, y: 0 });
    expect(freeSpot([{ x: 0, y: 0, w: 6, h: 2 }], 12, 6, 2)).toEqual({ x: 6, y: 0 });
    expect(freeSpot([{ x: 0, y: 0, w: 8, h: 2 }], 12, 6, 2)).toEqual({ x: 0, y: 2 });
  });

  test("adds widgets without overlap, removes them, and manages tabs", () => {
    let s = startSession(dashboard);
    s = apply(s, addWidget(s.current, "main", "tasks", { widget: "view", view: "tasks" }, 8, 4));
    s = apply(s, addWidget(s.current, "main", uniqueItemId(s.current, "main", "tasks"), { widget: "count", label: "Open", view: "tasks" }, 4, 2));
    expect(s.current.tabs[0]?.items.map((i) => [i.id, i.x, i.y])).toEqual([
      ["tasks", 0, 0],
      ["tasks_2", 8, 0],
    ]);
    s = apply(s, removeWidget(s.current, "main", "tasks"));
    s = apply(s, addTab(s.current, "later", "Later"));
    s = apply(s, renameTab(s.current, "later", "Someday"));
    expect(s.current.tabs.map((t) => t.title)).toEqual(["Main", "Someday"]);
    s = apply(s, removeTab(s.current, "main"));
    expect(edit(s, removeTab(s.current, "later")).rejected[0]?.message).toContain("at least one tab");
  });
});

describe("blank documents", () => {
  test("are valid starting points", () => {
    const empty = blankEntity("note");
    expect(validateDocument(empty).ok).toBe(true);
    expect(validateDocument(blankForm(empty, "note_form", "default")).ok).toBe(true);
    expect(blankTable(empty, "notes", "default")).toBeNull();
    expect(validateDocument(blankTable(entity, "all_tasks", "default")).ok).toBe(true);
    expect(sectionItems(blankForm(entity, "f", "default").sections[0]!).map((i) => i.field)).toEqual(["title", "done", "due"]); // RFC 0008/9: card 47b
    expect(validateDocument(blankDashboard("home")).ok).toBe(true);
  });
});

describe("quick filter support", () => {
  test("every field type can be a quick filter, number, date and datetime as a range", async () => {
    const { canQuickFilter, QUICK_FILTER_KINDS } = await import("./views.js");
    for (const type of ["text", "number", "boolean", "select", "date", "datetime"] as const) expect(canQuickFilter(type)).toBe(true);
    expect(canQuickFilter(undefined)).toBe(false);
    expect(canQuickFilter("reference")).toBe(true);
    expect(canQuickFilter("time")).toBe(false);
    expect(QUICK_FILTER_KINDS.number).toBe("range");
    expect(QUICK_FILTER_KINDS.date).toBe("range");
    expect(QUICK_FILTER_KINDS.datetime).toBe("range");
  });
});

describe("compare columns (RFC 0007)", () => {
  const history: EntityDocument = {
    ...entity,
    id: "history",
    fields: [
      { id: "body", type: "text", label: "Body" },
      { id: "note", type: "text", label: "Note" },
      { id: "when", type: "datetime", label: "When" },
      { id: "flag", type: "boolean", label: "Flag" },
    ],
  };
  const historyTable: TableView = { kind: "table", specVersion: 0, id: "history", entity: "history", revision: 1, dataSource: "default", columns: [{ field: "body" }, { field: "note" }, { field: "when" }] };

  test("sets previousRow, nextRow and another text field, and clears them", () => {
    let s = startSession(historyTable);
    s = apply(s, setColumnCompare(s.current, "body", { to: "previousRow" }, history));
    expect(s.current.columns[0]?.compare).toEqual({ to: "previousRow" });
    s = apply(s, setColumnCompare(s.current, "body", { to: "nextRow" }, history));
    expect(s.current.columns[0]?.compare).toEqual({ to: "nextRow" });
    s = apply(s, setColumnCompare(s.current, "body", { field: "note" }, history));
    expect(s.current.columns[0]?.compare).toEqual({ field: "note" });
    s = apply(s, setColumnCompare(s.current, "body", undefined, history));
    expect(s.current.columns[0]?.compare).toBeUndefined();
    // Clearing what is not set is a no-op, not a patch.
    expect(setColumnCompare(s.current, "body", undefined, history)).toEqual({ ok: true, patch: [] });
  });

  test("refuses a non-text column, an unknown or non-text comparator, itself, and both members at once", () => {
    expect(setColumnCompare(historyTable, "when", { to: "previousRow" }, history)).toMatchObject({ ok: false, error: { path: "/columns/2/compare", message: expect.stringContaining("datetime") } });
    expect(setColumnCompare(historyTable, "body", { field: "nope" }, history)).toMatchObject({ ok: false, error: { path: "/columns/0/compare/field", message: expect.stringContaining('"nope" is not a field') } });
    expect(setColumnCompare(historyTable, "body", { field: "flag" }, history)).toMatchObject({ ok: false, error: { path: "/columns/0/compare/field", message: expect.stringContaining("boolean, not text") } });
    expect(setColumnCompare(historyTable, "body", { field: "body" }, history)).toMatchObject({ ok: false, error: { path: "/columns/0/compare/field", message: expect.stringContaining("itself") } });
    // The union type forbids these shapes; the guards are the runtime backstop for documents from elsewhere.
    expect(setColumnCompare(historyTable, "body", { to: "previousRow", field: "note" } as ColumnCompare, history)).toMatchObject({ ok: false, error: { path: "/columns/0/compare" } });
    expect(setColumnCompare(historyTable, "body", {} as ColumnCompare, history)).toMatchObject({ ok: false, error: { path: "/columns/0/compare" } });
    expect(setColumnCompare(historyTable, "gone", { to: "previousRow" }, history)).toMatchObject({ ok: false, error: { path: "/columns" } });
  });

  test("refuses a compare on an editable column, naming why", () => {
    const editable: TableView = { ...historyTable, columns: [{ field: "body", editable: true }] };
    const refused = setColumnCompare(editable, "body", { to: "previousRow" }, history);
    expect(refused).toMatchObject({ ok: false, error: { path: "/columns/0/compare", hint: expect.stringContaining("no meaningful diff") } });
  });

  test("a patch built against a stale view is refused by its test /id guard", () => {
    const result = setColumnCompare(historyTable, "body", { to: "previousRow" }, history);
    if (!result.ok) throw new Error("helper should have accepted it");
    const stale = { ...historyTable, columns: [{ field: "note" }, { field: "body" }] };
    const next = edit(startSession(stale), [{ op: "test", path: "/id", value: "wrong" }, ...result.patch]);
    expect(next.rejected.length).toBeGreaterThan(0);
  });
});

describe("record actions offered by views (RFC 0007)", () => {
  const offered: EntityDocument = {
    ...entity,
    actions: [
      { id: "apply", label: "Apply" },
      { id: "reject", label: "Reject", confirm: { message: "Reject it?" } },
      { id: "close", label: "Close" },
    ],
  };
  const board: BoardView = { kind: "board", specVersion: 0, id: "tasks_board", entity: "task", revision: 1, dataSource: "default", groupBy: [{ field: "done" }] };
  const calendar: CalendarView = { kind: "calendar", specVersion: 0, id: "tasks_cal", entity: "task", revision: 1, dataSource: "default", dateField: "due" };

  const applyOffer = <T extends TableView | BoardView | CalendarView>(s: EditSession<T>, result: PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: { message: string } }): EditSession<T> => {
    if (!Array.isArray(result) && !result.ok) throw new Error(`helper refused: ${result.error.message}`);
    const next = edit(s, Array.isArray(result) ? result : result.patch);
    expect(next.rejected).toEqual([]);
    return next;
  };

  test("offering actions on a table writes the key in order and finishes dirty", () => {
    const s = applyOffer(startSession(table), setRecordActions(table, offered, ["apply", "reject"]));
    expect(finish(s).recordActions).toEqual(["apply", "reject"]);
  });

  test("offering nothing removes the key; offering the same list changes nothing", () => {
    const withOffer = { ...table, recordActions: ["apply", "close"] };
    const s = applyOffer(startSession(withOffer), setRecordActions(withOffer, offered, []));
    expect(finish(s).recordActions).toBeUndefined();
    expect(setRecordActions(withOffer, offered, ["apply", "close"])).toEqual({ ok: true, patch: [] });
  });

  test("offer, unoffer and move keep the order", () => {
    let s = applyOffer(startSession(table), offerRecordAction(table, offered, "close"));
    s = applyOffer(s, offerRecordAction(s.current, offered, "apply"));
    expect(s.current.recordActions).toEqual(["close", "apply"]);
    s = applyOffer(s, moveOfferedRecordAction(s.current, offered, "apply", -1));
    expect(s.current.recordActions).toEqual(["apply", "close"]);
    s = applyOffer(s, unofferRecordAction(s.current, offered, "close"));
    expect(s.current.recordActions).toEqual(["apply"]);
  });

  test("an id the entity does not declare is refused with the list of real ones", () => {
    const result = setRecordActions(table, offered, ["ghost"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('"ghost" is not an action of entity "task"');
    const empty = setRecordActions(table, { ...entity }, ["apply"]);
    expect(!empty.ok && empty.error.hint).toContain("declares no actions");
  });

  test("a seventh offer is refused by the helper and by the validator", () => {
    const seven = ["apply", "reject", "close", "a", "b", "c", "d"];
    const withSeven: EntityDocument = { ...offered, actions: seven.map((id) => ({ id, label: id })) };
    const result = setRecordActions({ ...table, recordActions: ["apply"] }, withSeven, seven);
    expect(result.ok).toBe(false);
    const checked = validateDocument({ ...table, recordActions: seven });
    expect(!checked.ok && checked.errors.some((e) => e.path === "/recordActions")).toBe(true);
  });

  test("offering the same action twice is refused", () => {
    const result = offerRecordAction({ ...table, recordActions: ["apply"] }, offered, "apply");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("already offers");
  });

  test("board and calendar offer actions the same way", () => {
    const b = applyOffer(startSession(board), setRecordActions(board, offered, ["reject", "apply"]));
    expect(finish(b).recordActions).toEqual(["reject", "apply"]);
    const s = applyOffer(startSession(calendar), offerRecordAction(calendar, offered, "close"));
    expect(finish(s).recordActions).toEqual(["close"]);
  });

  test("the patch is guarded: it refuses to apply to a view whose id moved", () => {
    const patch = setRecordActions(table, offered, ["apply"]);
    if (Array.isArray(patch) || !patch.ok) throw new Error("expected a patch");
    const renamed: TableView = { ...table, id: "other" };
    const s = edit(startSession(renamed), patch.patch);
    expect(s.applied.length).toBe(0);
    expect(s.rejected.length).toBe(1);
  });
});
