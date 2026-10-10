import { validateDocument } from "@yadad/core";
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
  moveFormItem,
  moveSection,
  removeColumn,
  removeFormItem,
  removeSection,
  setColumnEditable,
  setPageSize,
  setQuickFilter,
  setSectionTitle,
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
