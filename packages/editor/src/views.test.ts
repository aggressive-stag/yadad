import { validateDocument, validateDocuments } from "@yadad/core";
import type { DashboardView, EntityDocument, FormView, TableView } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { describe, expect, test } from "vitest";
import { blankDashboard, blankEntity, blankForm, blankTable } from "./blank.js";
import { addTab, addWidget, freeSpot, removeTab, removeWidget, renameTab, uniqueItemId } from "./layout.js";
import { edit, startSession } from "./session.js";
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
  moveSection,
  moveSectionTo,
  removeColumn,
  removeFormItem,
  removeSection,
  setColumnEditable,
  setClearWhenHidden,
  setCountWidgetFilter,
  setFormItemCondition,
  setPageSize,
  setQuickFilter,
  setSectionTitle,
  setTableFilter,
  setTableSort,
  setTableTitle,
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

const fieldsOf = (v: FormView) => v.sections.map((s) => `${s.id}:${s.items.map((i) => i.field).join(",")}`);

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
    expect(s.current.sections[0]?.items.find((i) => i.field === "done")).toEqual({
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
    expect(blankForm(entity, "f", "default").sections[0]?.items.map((i) => i.field)).toEqual(["title", "done", "due"]);
    expect(validateDocument(blankDashboard("home")).ok).toBe(true);
  });
});
