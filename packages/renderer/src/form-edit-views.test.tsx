// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BoardView, CalendarView, DataAdapter, EntityDocument, FormView, ViewDocument } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry, waitForRows } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BoardRenderer } from "./board-renderer.js";
import { CalendarRenderer } from "./calendar-renderer.js";
import type { DocumentSet } from "./document-set.js";

afterEach(cleanup);

// Card 107: editForm on a calendar and a board.
const NOW = new Date(2026, 9, 15, 10, 0, 0);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 10,
  id: "task",
  revision: 2,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "due", type: "date", label: "Due" },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["todo", "done"] } },
    { id: "secret", type: "text", label: "Secret" },
  ],
};
const form: FormView = { kind: "form", specVersion: 10, id: "task_edit", entity: "task", revision: 1, dataSource: "default", sections: [{ id: "main", items: [{ field: "title" }, { field: "status" }] }] };
const calendar: CalendarView = { kind: "calendar", specVersion: 10, id: "cal", title: "Tasks", entity: "task", revision: 1, dataSource: "default", dateField: "due", titleField: "title", editForm: "task_edit" };
const board: BoardView = { kind: "board", specVersion: 10, id: "brd", title: "Board", entity: "task", revision: 1, dataSource: "default", groupBy: [{ field: "status" }], titleField: "title", editForm: "task_edit" };
const documents = (view: ViewDocument): DocumentSet => ({ entities: new Map([[entity.id, entity]]), views: new Map<string, ViewDocument>([[form.id, form], [view.id, view]]) });

async function seed() {
  const db = createMemoryAdapter();
  const a = await db.create("task", { title: "Pay rent", due: "2026-10-15", status: "todo", secret: "keep" }, { entityRevision: 2 });
  const b = await db.create("task", { title: "Call Ada", due: "2026-10-16", status: "done" }, { entityRevision: 2 });
  return { db, a, b };
}
const spied = (db: DataAdapter) => {
  const update = vi.fn(db.update);
  return { adapter: { ...db, update } as DataAdapter, update };
};

const mountCalendar = async (adapter: DataAdapter, view: CalendarView = calendar, docs: DocumentSet = documents(view)) => {
  const ui = render(<CalendarRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", adapter]])} documents={docs} now={NOW} />);
  await waitForRows(document.body);
  return ui;
};
const mountBoard = async (adapter: DataAdapter, view: BoardView = board, docs: DocumentSet = documents(view)) => {
  const ui = render(<BoardRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", adapter]])} documents={docs} now={NOW} />);
  await waitForRows(document.body);
  return ui;
};

const cases = [
  { name: "calendar", mount: mountCalendar, view: calendar, root: "[data-yadad-calendar-view]" },
  { name: "board", mount: mountBoard, view: board, root: "[data-yadad-board-view]" },
] as const;

describe.each(cases)("$name editForm (card 107)", ({ mount, view, root }) => {
  test("Edit opens the record in the form in place of the view; a save returns, with focus on the Edit control", async () => {
    const { db, a } = await seed();
    const { adapter, update } = spied(db);
    await mount(adapter);
    const edit = screen.getByRole("button", { name: "Edit Pay rent" });
    edit.focus();
    fireEvent.click(edit);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Edit Pay rent" }));
    expect(document.querySelector(root)?.hasAttribute("hidden")).toBe(true);
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Pay rent");
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Pay the rent" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Pay the rent");
    // The same save path as a table: changed fields only, the loaded version as baseVersion; secret is left alone.
    expect(update).toHaveBeenCalledWith("task", a.id, { title: "Pay the rent" }, { entityRevision: 2, baseVersion: a.version });
    expect((await db.findOne("task", a.id))?.values).toMatchObject({ title: "Pay the rent", secret: "keep" });
    expect(document.querySelector("[data-yadad-edit-form]")).toBeNull();
    expect(document.querySelector(root)?.hasAttribute("hidden")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Pay the rent" })));
  });

  test("Back returns without saving, focus back on the Edit control", async () => {
    const { db } = await seed();
    const { adapter, update } = spied(db);
    await mount(adapter);
    const edit = screen.getByRole("button", { name: "Edit Call Ada" });
    edit.focus();
    fireEvent.click(edit);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(update).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Call Ada" })));
  });

  test("a stale save shows the conflict message and nothing is overwritten", async () => {
    const { db, a } = await seed();
    await mount(db);
    fireEvent.click(screen.getByRole("button", { name: "Edit Pay rent" }));
    await db.update("task", a.id, { status: "done" }, { entityRevision: 2, baseVersion: a.version }); // someone else
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("changed elsewhere");
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Mine"); // typed input kept
    expect((await db.findOne("task", a.id))?.values["title"]).toBe("Pay rent");
  });

  test("editVisibleWhen limits which records get Edit; can.update false removes it", async () => {
    const db = createMemoryAdapter({ recordPermissions: (r) => (r.values["title"] === "Call Ada" ? { update: false } : undefined) });
    await db.create("task", { title: "Pay rent", due: "2026-10-15", status: "todo" }, { entityRevision: 2 });
    await db.create("task", { title: "Call Ada", due: "2026-10-16", status: "todo" }, { entityRevision: 2 });
    await db.create("task", { title: "Done one", due: "2026-10-17", status: "done" }, { entityRevision: 2 });
    const gated = { ...view, editVisibleWhen: { op: "not", condition: { op: "in", field: "status", values: ["done"] } } } as typeof view;
    await mount(db, gated as never);
    expect(screen.getByRole("button", { name: "Edit Pay rent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Call Ada" })).toBeNull(); // server says no
    expect(screen.queryByRole("button", { name: "Edit Done one" })).toBeNull(); // condition says no
  });

  test("no editForm, no Edit control; a wrong target is reported", async () => {
    const { db } = await seed();
    const { editForm: _drop, ...plain } = view;
    await mount(db, plain as never, documents(plain as never) as never);
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    cleanup();
    const Renderer = view.kind === "calendar" ? CalendarRenderer : BoardRenderer;
    render(<Renderer entity={entity} view={{ ...view, editForm: "nope" } as never} registry={mockRegistry} dataSources={new Map([["default", db]])} documents={documents(view)} now={NOW} />);
    expect(screen.getByRole("alert").textContent).toContain('editForm "nope" is not a form view');
  });
});
