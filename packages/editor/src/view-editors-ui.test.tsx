// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DashboardView, EntityDocument, FormView, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";
import { FormViewEditor } from "./form-view-editor.js";
import { TableViewEditor } from "./table-view-editor.js";

afterEach(cleanup);

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

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("FormViewEditor", () => {
  const form: FormView = {
    kind: "form",
    specVersion: 0,
    id: "task_form",
    entity: "task",
    revision: 3,
    dataSource: "default",
    sections: [{ id: "main", title: "Task", items: [{ field: "title" }, { field: "done", visibleWhen: { op: "notEmpty", field: "title" } }] }],
  };

  function setup() {
    const saved: FormView[] = [];
    render(<FormViewEditor view={form} entity={entity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("places a field the form is missing, then saves with a new revision", () => {
    const saved = setup();
    expect(screen.getByText("Not on this form yet: Due.")).toBeTruthy();
    press("Add field to form");
    expect(screen.getByText("Every field of task is on this form.")).toBeTruthy();
    press("Save form");
    expect(saved[0]?.revision).toBe(4);
    expect(saved[0]?.sections[0]?.items.map((i) => i.field)).toEqual(["title", "done", "due"]);
  });

  test("shows a field's rules in words, reorders and removes fields, with undo", () => {
    setup();
    expect(screen.getByText("Shown when Title is filled in")).toBeTruthy();
    press("Move Done up");
    const rows = () => within(screen.getByRole("table", { name: "Fields in Task" })).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows()[0]).toContain("Done");
    press("Remove Done");
    expect(rows()).toHaveLength(1);
    press("Undo");
    expect(rows()).toHaveLength(2);
  });

  test("adds a section and moves a field into it", () => {
    setup();
    fireEvent.change(screen.getByLabelText("New section title"), { target: { value: "Scheduling" } });
    press("Add section");
    expect(screen.getByRole("table", { name: "Fields in Scheduling" })).toBeTruthy();
    press("Move Done down");
    expect(within(screen.getByRole("table", { name: "Fields in Scheduling" })).getByText("Done")).toBeTruthy();
  });
});

describe("TableViewEditor", () => {
  const table: TableView = { kind: "table", specVersion: 0, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "done" }] };

  function setup() {
    const saved: TableView[] = [];
    render(<TableViewEditor view={table} entity={entity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("adds and reorders columns, toggles editing and quick filters, and saves", () => {
    const saved = setup();
    press("Add column");
    press("Move Due left");
    press("Make Due editable");
    press("Filter by Done");
    expect(button("Remove Done filter")).toBeTruthy();
    press("Save table");
    expect(saved[0]).toMatchObject({ revision: 2, columns: [{ field: "title" }, { field: "due", editable: true }, { field: "done" }], quickFilters: [{ field: "done" }] });
  });

  test("applies title, page size and sort as one undoable edit", () => {
    const saved = setup();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My tasks" } });
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "Due" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "Descending" } });
    press("Apply settings");
    press("Save table");
    expect(saved[0]).toMatchObject({ title: "My tasks", pageSize: 10, sort: [{ field: "due", dir: "desc" }] });
  });

  test("the last column cannot be removed", () => {
    render(<TableViewEditor view={{ ...table, columns: [{ field: "title" }] }} entity={entity} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
    expect(button("Remove Title").disabled).toBe(true);
  });
});

describe("DashboardLayoutEditor widgets and tabs", () => {
  const dashboard: DashboardView = { kind: "dashboard", specVersion: 0, id: "home", revision: 1, tabs: [{ id: "main", title: "Main", items: [] }] };
  const table: TableView = { kind: "table", specVersion: 0, id: "tasks", title: "Tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }] };

  function setup() {
    const saved: DashboardView[] = [];
    render(<DashboardLayoutEditor dashboard={dashboard} registry={mockRegistry} onSave={(d) => saved.push(d)} onCancel={() => {}} views={[table]} describeView={(id) => `Table: ${id}`} />);
    return saved;
  }

  test("adds widgets from the palette side by side, removes one, and saves", () => {
    const saved = setup();
    press("Add to Main");
    fireEvent.change(screen.getByLabelText("Widget to add"), { target: { value: "Count of Table: tasks" } });
    press("Add to Main");
    expect(screen.getByRole("group", { name: /^Count: Tasks, column 7, row 1/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("group", { name: /^Count: Tasks/ }), { key: "Delete" });
    expect(screen.queryByRole("group", { name: /^Count: Tasks/ })).toBeNull();
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items).toEqual([{ id: "tasks", x: 0, y: 0, w: 6, h: 5, widget: "view", view: "tasks" }]);
  });

  test("adds, renames and removes tabs, but never the last one", () => {
    const saved = setup();
    expect(button("Remove tab").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("New tab title"), { target: { value: "Later" } });
    press("Add tab");
    fireEvent.change(screen.getByLabelText("Tab title"), { target: { value: "Someday" } });
    press("Rename tab");
    press("Save layout");
    expect(saved[0]?.tabs.map((t) => [t.id, t.title])).toEqual([
      ["main", "Main"],
      ["later", "Someday"],
    ]);
  });
});
