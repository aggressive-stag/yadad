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

  test("renames a section by typing: the button commits, and Enter commits the same", () => {
    const saved = setup();
    const input = () => screen.getByLabelText("Section title") as HTMLInputElement;
    const rename = () => screen.getByRole("button", { name: "Rename section" }) as HTMLButtonElement;
    const save = () => screen.getByRole("button", { name: "Save form" }) as HTMLButtonElement;
    // The typed title drives the button and the session, not just the pixels.
    expect(rename().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "Details" } });
    expect(input().value).toBe("Details");
    expect(rename().disabled).toBe(false);
    press("Rename section");
    expect(save().disabled).toBe(false);
    expect(within(screen.getByRole("table", { name: "Fields in Details" })).getByText("Title")).toBeTruthy();
    press("Save form");
    expect(saved[0]?.sections[0]?.title).toBe("Details");
  });

  test("Enter in a section's title input commits the rename like the button", () => {
    const saved = setup();
    const save = () => screen.getByRole("button", { name: "Save form" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Section title"), { target: { value: "Basics" } });
    fireEvent.keyDown(screen.getByLabelText("Section title"), { key: "Enter" });
    fireEvent.keyPress(screen.getByLabelText("Section title"), { key: "Enter" });
    expect(save().disabled).toBe(false);
    press("Save form");
    expect(saved[0]?.sections[0]?.title).toBe("Basics");
  });

  test("adds a section and moves a field into it", () => {
    setup();
    fireEvent.change(screen.getByLabelText("New section title"), { target: { value: "Scheduling" } });
    press("Add section");
    expect(screen.getByRole("table", { name: "Fields in Scheduling" })).toBeTruthy();
    press("Move Done down");
    expect(within(screen.getByRole("table", { name: "Fields in Scheduling" })).getByText("Done")).toBeTruthy();
  });

  test("arrow keys move a focused field grip, announced in the status line", () => {
    setup();
    const grip = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
    const status = () => document.querySelector("[data-yadad-editor-status]")?.textContent ?? "";
    const rows = () => within(screen.getByRole("table", { name: "Fields in Task" })).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    const done = grip("Drag the field Done");
    done.focus();
    fireEvent.keyDown(done, { key: "ArrowUp" });
    expect(status()).toBe("Done moved up to Task, position 1.");
    expect(rows()[0]).toContain("Done");
    fireEvent.keyDown(done, { key: "ArrowRight" });
    expect(status()).toBe("Done moved down to Task, position 2.");
    expect(rows()[1]).toContain("Done");
    // Plain arrow keys without focus on the grip do nothing; a non-step key neither.
    fireEvent.keyDown(done, { key: "a" });
    expect(status()).toBe("Done moved down to Task, position 2.");
    // Esc during a drag cancels it: no move, no announcement.
    fireEvent.pointerDown(grip("Drag the field Title"), { pointerId: 1 });
    fireEvent.keyDown(grip("Drag the field Title"), { key: "Escape" });
    expect(status()).toBe("Done moved down to Task, position 2.");
  });

  test("arrow keys move a focused section grip, announced in the status line", () => {
    setup();
    const grip = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
    const status = () => document.querySelector("[data-yadad-editor-status]")?.textContent ?? "";
    const sections = () => [...document.querySelectorAll("[data-yadad-section-span]")].map((el) => el.getAttribute("data-yadad-section-span"));
    // The fixture has one section; add a second so the first has somewhere to go.
    fireEvent.change(screen.getByLabelText("New section title"), { target: { value: "Scheduling" } });
    press("Add section");
    const sched = grip("Drag the section Scheduling");
    sched.focus();
    fireEvent.keyDown(sched, { key: "ArrowUp" });
    expect(status()).toBe("Section Scheduling moved to position 1.");
    expect(sections()).toEqual(["scheduling", "main"]);
    fireEvent.keyDown(sched, { key: "ArrowDown" });
    expect(status()).toBe("Section Scheduling moved to position 2.");
    expect(sections()).toEqual(["main", "scheduling"]);
  });

  test("a pointer drag of a field shows the drop indicator, then applies one undoable move", () => {
    const saved = setup();
    const status = () => document.querySelector("[data-yadad-editor-status]")?.textContent ?? "";
    const rows = () => within(screen.getByRole("table", { name: "Fields in Task" })).getAllByRole("row").slice(1);
    const grip = screen.getByRole("button", { name: "Drag the field Title" });
    // While the drag is in progress the indicator shows where the field will
    // land. jsdom has no layout, so the pointer's y (40) is below every
    // zero-height row's midpoint: the drop resolves to the end of the
    // section, after the table.
    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 40 });
    expect(document.querySelector("[data-yadad-drop-indicator]")).toBeTruthy();
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 40 });
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 40 });
    expect(status()).toBe("Title moved to Task, position 2.");
    expect(rows()[0]?.textContent).toContain("Done");
    expect(rows()[1]?.textContent).toContain("Title");
    expect(document.querySelector("[data-yadad-drop-indicator]")).toBeNull();
    // The save is the moved document, with a new revision.
    press("Save form");
    expect(saved[0]?.revision).toBe(4);
    expect(saved[0]?.sections[0]?.items.map((i) => i.field)).toEqual(["done", "title"]);
    // One undo reverts the whole move, and the form is clean again: the
    // save goes back to being disabled.
    press("Undo");
    expect(rows()[0]?.textContent).toContain("Title");
    expect((screen.getByRole("button", { name: "Save form" }) as HTMLButtonElement).disabled).toBe(true);
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

  test("number and date columns can be quick filters (a from/to range)", () => {
    const saved: TableView[] = [];
    const sets: EntityDocument = {
      ...entity,
      id: "set",
      fields: [
        { id: "day", type: "date", label: "Day" },
        { id: "rpe", type: "number", label: "RPE" },
      ],
    };
    const view: TableView = { ...table, entity: "set", columns: [{ field: "day" }, { field: "rpe" }] };
    render(<TableViewEditor view={view} entity={sets} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    expect(screen.queryByText(/Not available/)).toBeNull();
    press("Filter by RPE");
    press("Filter by Day");
    expect(button("Remove RPE filter")).toBeTruthy();
    press("Save table");
    expect(saved[0]?.quickFilters).toEqual([{ field: "rpe" }, { field: "day" }]);
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

  test("the columns table scrolls inside a focusable region, so it never widens the page", () => {
    render(<TableViewEditor view={table} entity={entity} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
    const region = screen.getByRole("region", { name: /Columns of tasks/ });
    expect(region.tabIndex).toBe(0);
    expect(region.style.overflowX).toBe("auto");
    expect(within(region).getByRole("table")).toBeTruthy();
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

test("an editor shows a warning while its document is empty", () => {
  const form: FormView = { kind: "form", specVersion: 0, id: "f", entity: "task", revision: 1, dataSource: "default", sections: [{ id: "main", items: [{ field: "title" }] }] };
  render(<FormViewEditor view={form} entity={entity} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
  expect(document.querySelector("[data-yadad-editor-warnings]")).toBeNull();
  press("Remove Title");
  expect(document.querySelector("[data-yadad-editor-warnings]")?.textContent).toContain("This form shows no fields.");
});

describe("TableViewEditor row action", () => {
  const table: TableView = { kind: "table", specVersion: 2, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "done" }] };
  const history: TableView = { ...table, id: "task_history", title: "Task history", columns: [{ field: "title" }] };
  const context = { tables: [table, history], entities: [entity] };
  const setup = (withContext: boolean) => {
    const saved: TableView[] = [];
    render(<TableViewEditor view={table} entity={entity} registry={mockRegistry} {...(withContext ? { context } : {})} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  };

  test("is not offered without a context", () => {
    setup(false);
    expect(screen.queryByText("Row action")).toBeNull();
  });

  test("picks a target and a field pair, sets it, saves, and can clear it", () => {
    const saved = setup(true);
    expect(screen.getByText("Clicking a row does nothing.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Match this field"), { target: { value: "Due" } });
    press("Set row action");
    expect(screen.getByText("Clicking a row opens Task history (task_history), matching Due to Due.")).toBeTruthy();
    press("Save table");
    expect(saved[0]?.rowAction).toEqual({ open: "task_history", bind: [{ field: "due", to: "due" }], mode: "replace" });
    press("Remove row action");
    expect(screen.getByText("Clicking a row does nothing.")).toBeTruthy();
    press("Save table");
    expect(saved[1]?.rowAction).toBeUndefined();
  });

  test("the target field choices are limited to fields of the same type", () => {
    setup(true);
    fireEvent.change(screen.getByLabelText("Match this field"), { target: { value: "Done" } });
    const options = within(screen.getByLabelText("With this field of the target")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Done");
    expect(options).not.toContain("Title");
  });
});

describe("TableViewEditor offer actions", () => {
  const taskEntity: EntityDocument = { ...entity, actions: [{ id: "apply", label: "Apply" }, { id: "reject", label: "Reject" }] };
  const tasksTable: TableView = { kind: "table", specVersion: 0, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }] };

  test("offers row actions, refuses a stale entity, and saves recordActions", () => {
    const saved: TableView[] = [];
    render(<TableViewEditor view={tasksTable} entity={taskEntity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "Reject (reject)" } });
    press("Offer this action");
    press("Offer this action");
    const rows = () => within(screen.getByRole("table", { name: /offered on each row/ })).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows()).toEqual([expect.stringContaining("Reject"), expect.stringContaining("Apply")]);
    press("Offer nothing");
    press("Offer this action");
    press("Save table");
    expect(saved[0]?.recordActions).toEqual(["reject"]);
  });
});

describe("TableViewEditor compare and datetime (RFC 0007)", () => {
  const revision: EntityDocument = {
    ...entity,
    id: "revision",
    fields: [
      { id: "body", type: "text", label: "Body" },
      { id: "note", type: "text", label: "Note" },
      { id: "stamp", type: "datetime", label: "Stamp" },
    ],
  };
  const revisions: TableView = { kind: "table", specVersion: 0, id: "revisions", entity: "revision", revision: 1, dataSource: "default", columns: [{ field: "body" }, { field: "stamp" }] };
  const compareSelect = () => screen.getByLabelText("Compare Body") as HTMLSelectElement;

  test("offers previous row, next row and another text field, and saves the compare", () => {
    const saved: TableView[] = [];
    render(<TableViewEditor view={revisions} entity={revision} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    expect(compareSelect().value).toBe("Plain text");
    fireEvent.change(compareSelect(), { target: { value: "Changed from the previous row" } });
    press("Save table");
    expect(saved[0]?.columns[0]?.compare).toEqual({ to: "previousRow" });
  });

  test("a compare against another text field lands as { field }", () => {
    const saved: TableView[] = [];
    render(<TableViewEditor view={revisions} entity={revision} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    fireEvent.change(compareSelect(), { target: { value: "Changed from Note" } });
    press("Save table");
    expect(saved[0]?.columns[0]?.compare).toEqual({ field: "note" });
  });

  test("an editable text column is refused a compare, naming why", () => {
    const editable: TableView = { ...revisions, columns: [{ field: "body", editable: true }, { field: "stamp" }] };
    render(<TableViewEditor view={editable} entity={revision} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.change(compareSelect(), { target: { value: "Changed from the previous row" } });
    expect(screen.getByTestId("error-summary").textContent).toContain("editable in place");
    expect(compareSelect().value).toBe("Plain text");
  });

  function setupRevisions() {
    render(<TableViewEditor view={revisions} entity={revision} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
  }

  test("a datetime column can be a quick filter", () => {
    setupRevisions();
    press("Filter by Stamp");
    expect(button("Remove Stamp filter")).toBeTruthy();
  });
});
