// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RecordValidationError } from "@yadad/core";
import type { DataAdapter, DataRecord, EntityDocument, FormView, TableView, ViewDocument } from "@yadad/core";
import { createDraftStore, createMemoryAdapter } from "@yadad/runtime";
import type { DraftStorage } from "@yadad/runtime";
import { mockRegistry, waitForRows } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DocumentSet } from "./document-set.js";
import { FormRenderer } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

// "secret" and "score" are on the entity but not in the form: an edit must leave them alone.
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 10,
  id: "task",
  revision: 2,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "blocked", "done"] } },
    { id: "reason", type: "text", label: "Reason" },
    { id: "secret", type: "text", label: "Secret" },
    { id: "score", type: "number", label: "Score", max: 100 },
  ],
};

const form: FormView = {
  kind: "form",
  specVersion: 10,
  id: "task_edit",
  entity: "task",
  revision: 1,
  dataSource: "default",
  sections: [
    {
      id: "main",
      items: [
        { field: "title" },
        { field: "status" },
        { field: "reason", visibleWhen: { op: "eq", field: "status", value: "blocked" }, requiredWhen: { op: "eq", field: "status", value: "blocked" }, clearWhenHidden: true },
      ],
    },
  ],
};

const table: TableView = {
  kind: "table",
  specVersion: 10,
  id: "tasks",
  title: "Tasks",
  entity: "task",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "title" }, { field: "status" }],
  sort: [{ field: "title", dir: "asc" }],
  editForm: "task_edit",
};

const documents: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map<string, ViewDocument>([[form.id, form], [table.id, table]]) };

async function seed(db: DataAdapter = createMemoryAdapter()): Promise<{ db: DataAdapter; a: DataRecord; b: DataRecord }> {
  const a = await db.create("task", { title: "Alpha", status: "blocked", reason: "waiting", secret: "keep me", score: 7 }, { entityRevision: 2 });
  const b = await db.create("task", { title: "Beta", status: "open", secret: "other" }, { entityRevision: 2 });
  return { db, a, b };
}

/** An adapter whose update calls are recorded. */
function spied(db: DataAdapter): { adapter: DataAdapter; update: ReturnType<typeof vi.fn> } {
  const update = vi.fn(db.update);
  return { adapter: { ...db, update }, update };
}

const mountForm = (adapter: DataAdapter, record: DataRecord, extra: Partial<Parameters<typeof FormRenderer>[0]> = {}) =>
  render(<FormRenderer entity={entity} view={form} registry={mockRegistry} dataSources={new Map([["default", adapter]])} record={record} {...extra} />);

describe("FormRenderer with a record", () => {
  test("shows the record's values and saves only the changed fields, with the loaded version as baseVersion", async () => {
    const { db, a } = await seed();
    const { adapter, update } = spied(db);
    const onSaved = vi.fn();
    mountForm(adapter, a, { onSaved });
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Alpha");
    expect((screen.getByTestId("input-reason") as HTMLInputElement).value).toBe("waiting");
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Alpha 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // Only the title: the status, the reason and the two fields the form never shows are not in the request.
    expect(update).toHaveBeenCalledWith("task", a.id, { title: "Alpha 2" }, { entityRevision: 2, baseVersion: a.version });
    const stored = await db.findOne("task", a.id);
    expect(stored?.values).toEqual({ title: "Alpha 2", status: "blocked", reason: "waiting", secret: "keep me", score: 7 });
  });

  test("a field the form does not show is not wiped, and saving without a change sends nothing", async () => {
    const { db, a } = await seed();
    const { adapter, update } = spied(db);
    const onSaved = vi.fn();
    mountForm(adapter, a, { onSaved });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
    expect((await db.findOne("task", a.id))?.values["secret"]).toBe("keep me");
  });

  test("emptying a field sends null, and a field the rules hide with clearWhenHidden is cleared", async () => {
    const { db, a } = await seed();
    const { adapter, update } = spied(db);
    const onSaved = vi.fn();
    mountForm(adapter, a, { onSaved });
    fireEvent.change(screen.getByTestId("input-status"), { target: { value: "done" } });
    expect(screen.queryByTestId("input-reason")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2]).toEqual({ status: "done", reason: null });
    expect((await db.findOne("task", a.id))?.values).toMatchObject({ status: "done", secret: "keep me", score: 7 });
  });

  test("a conditionally required field blocks the save until it is filled", async () => {
    const { db, b } = await seed();
    const { adapter, update } = spied(db);
    mountForm(adapter, b);
    fireEvent.change(screen.getByTestId("input-status"), { target: { value: "blocked" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const error = await screen.findByTestId("field-error");
    expect(error.getAttribute("data-code")).toBe("required");
    expect(update).not.toHaveBeenCalled();
  });

  test("a stale save shows the conflict message in the form, keeps the input, and a reload of the record can then save", async () => {
    const { db, a } = await seed();
    // Someone else saves the record after this form loaded it.
    const elsewhere = await db.update("task", a.id, { status: "done" }, { entityRevision: 2, baseVersion: a.version });
    const onSaved = vi.fn();
    const { rerender } = mountForm(db, a, { onSaved });
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-code='conflict']")?.textContent).toContain("This record was changed elsewhere");
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Mine"); // nothing the viewer typed is lost
    expect((await db.findOne("task", a.id))?.values["title"]).toBe("Alpha"); // and nothing was overwritten
    // The host hands over the latest record: the form starts from it.
    rerender(<FormRenderer entity={entity} view={form} registry={mockRegistry} dataSources={new Map([["default", db]])} record={elsewhere} onSaved={onSaved} />);
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Alpha");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect((await db.findOne("task", a.id))?.values).toMatchObject({ title: "Mine", status: "done" });
  });

  test("a second save uses the version the first one returned", async () => {
    const { db, b } = await seed();
    const { adapter, update } = spied(db);
    const onSaved = vi.fn();
    mountForm(adapter, b, { onSaved });
    for (const [n, title] of ["One", "Two"].entries()) {
      fireEvent.change(screen.getByTestId("input-title"), { target: { value: title } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(n + 1));
    }
    expect(screen.queryByRole("alert")).toBeNull();
    expect(update.mock.calls[1]?.[3]).toEqual({ entityRevision: 2, baseVersion: (onSaved.mock.calls[0]?.[0] as DataRecord).version });
  });

  test("an old record that is invalid on a field the form does not show cannot be saved, and the error is shown", async () => {
    // score is above its max of 100: written before the rule existed, or by another client.
    const db = createMemoryAdapter();
    const old = await db.create("task", { title: "Old", score: 500 }, { entityRevision: 1 });
    const { adapter, update } = spied(db);
    mountForm(adapter, old);
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Old, renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    const item = alert.querySelector("[data-path='/score']");
    expect(item?.textContent).toContain('"Score" is not on this form. Its stored value breaks a rule: must be at most 100.');
    expect(item?.textContent).toContain("Fix it where Score can be edited.");
    expect(update).not.toHaveBeenCalled(); // blocked on the client: nothing invalid is sent
  });

  test("a server error on a field the form does not show says it is not on this form", async () => {
    const db = createMemoryAdapter();
    const a = await db.create("task", { title: "Alpha" }, { entityRevision: 2 });
    const failing: DataAdapter = { ...db, update: async () => { throw new RecordValidationError("Invalid.", [{ path: "/score", code: "invalid-value", message: '"Score" must be at most 100.', hint: 'Change "Score" to be at most 100.' }]); } };
    mountForm(failing, a);
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Alpha 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-path='/score']")?.textContent).toContain('"Score" is not on this form. Its stored value breaks a rule: must be at most 100.');
  });

  test("a batch composer cannot edit and says so", () => {
    const batch: FormView = { ...form, repeat: "batch" };
    render(<FormRenderer entity={entity} view={batch} registry={mockRegistry} dataSources={new Map([["default", createMemoryAdapter()]])} record={{ id: "r", entityId: "task", entityRevision: 2, version: "v", values: { title: "x" } }} />);
    expect(screen.getByRole("alert").textContent).toContain("batch composer");
  });

  test("drafts are kept per record and restored with a notice when the record changed meanwhile", async () => {
    const { db, a } = await seed();
    const data = new Map<string, string>();
    const storage: DraftStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
    const store = createDraftStore(storage);
    const first = mountForm(db, a, { drafts: { store, debounceMs: 0 } });
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Draft title" } });
    await waitFor(() => expect(store.load("task_edit", a.id)?.values).toEqual({ title: "Draft title" }));
    expect(store.load("task_edit")).toBeNull(); // not under the create form's key
    first.unmount();
    const changed = await db.update("task", a.id, { score: 8 }, { entityRevision: 2, baseVersion: a.version });
    mountForm(db, changed, { drafts: { store, debounceMs: 0 } });
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Draft title");
    expect(screen.getByRole("status").textContent).toContain("The record changed elsewhere since then");
  });
});

describe("TableRenderer with editForm", () => {
  const mount = (db: DataAdapter, props: Partial<Parameters<typeof TableRenderer>[0]> = {}) =>
    render(<TableRenderer entity={entity} view={table} registry={mockRegistry} dataSources={new Map([["default", db]])} documents={documents} {...props} />);

  test("each row gets an Edit button that opens its record in the form in place of the table; a save returns to the updated table", async () => {
    const { db, a } = await seed();
    const { adapter, update } = spied(db);
    const onChanged = vi.fn();
    const { container } = mount(adapter, { onChanged });
    await waitForRows(container);
    expect(screen.getByRole("columnheader", { name: "Edit" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const heading = screen.getByRole("heading", { name: "Edit Alpha" });
    expect(document.activeElement).toBe(heading); // focus moves to the form
    expect(container.querySelector("[data-yadad-table-view]")?.hasAttribute("hidden")).toBe(true);
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Alpha");
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "Alpha, edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("task", a.id, { title: "Alpha, edited" }, { entityRevision: 2, baseVersion: a.version });
    await screen.findByText("Alpha, edited");
    expect(container.querySelector("[data-yadad-edit-form]")).toBeNull();
    expect(container.querySelector("[data-yadad-table-view]")?.hasAttribute("hidden")).toBe(false);
    // Focus is back on the row's button.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Alpha, edited" })));
  });

  test("Back closes the form without saving and keeps the table's state", async () => {
    const { db } = await seed();
    const { adapter, update } = spied(db);
    const { container } = mount(adapter);
    await waitForRows(container);
    fireEvent.click(screen.getByRole("button", { name: "Edit Beta" }));
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "never saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector("[data-yadad-edit-form]")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Beta" })));
    expect(within(container).getByText("Beta")).toBeTruthy();
  });

  test("a stale save shows the conflict in the form; Back and Edit again opens what the server has now", async () => {
    const { db, a } = await seed();
    const { container } = mount(db);
    await waitForRows(container);
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    await db.update("task", a.id, { title: "Alpha (other tab)" }, { entityRevision: 2, baseVersion: a.version });
    fireEvent.change(screen.getByTestId("input-status"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-code='conflict']")?.textContent).toContain("This record was changed elsewhere");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Alpha (other tab)" }));
    expect((screen.getByTestId("input-title") as HTMLInputElement).value).toBe("Alpha (other tab)");
    fireEvent.change(screen.getByTestId("input-status"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("done");
    expect((await db.findOne("task", a.id))?.values).toMatchObject({ title: "Alpha (other tab)", status: "done", secret: "keep me" });
  });

  test("a record the server says cannot be updated gets no Edit button", async () => {
    const db = createMemoryAdapter({ recordPermissions: (r) => (r.values["title"] === "Beta" ? { update: false } : undefined) });
    await seed(db);
    const { container } = mount(db);
    await waitForRows(container);
    expect(screen.queryByRole("button", { name: "Edit Beta" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Alpha" })).toBeTruthy();
  });

  test("card 106: editVisibleWhen shows the Edit button only on rows it holds for, and the other buttons stay in place", async () => {
    const { db } = await seed();
    const gated: TableView = { ...table, id: "tasks_gated", editVisibleWhen: { op: "eq", field: "status", value: "blocked" }, rowAction: { open: "tasks", bind: [{ field: "status", to: "status" }] } };
    const docs: DocumentSet = { entities: documents.entities, views: new Map<string, ViewDocument>([...documents.views, [gated.id, gated]]) };
    const { container } = mount(db, { view: gated, documents: docs });
    await waitForRows(container);
    expect(screen.getByRole("button", { name: "Edit Alpha" })).toBeTruthy(); // blocked
    expect(screen.queryByRole("button", { name: "Edit Beta" })).toBeNull(); // open
    // The row action is still there on both rows, in the same cell, and nothing empty is left focusable.
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    const buttonsOf = (row: Element): string[] => [...row.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttonsOf(rows[0]!)).toEqual(["Edit Alpha", expect.stringMatching(/^Open Tasks/)]);
    expect(buttonsOf(rows[1]!)).toEqual([expect.stringMatching(/^Open Tasks/)]);
    expect(rows[1]!.querySelectorAll("[data-yadad-row-edit]")).toHaveLength(0);
    expect(rows[1]!.querySelectorAll("td").length).toBe(rows[0]!.querySelectorAll("td").length);
  });

  test("card 106: editVisibleWhen cannot widen what the server allows", async () => {
    const db = createMemoryAdapter({ recordPermissions: (r) => (r.values["title"] === "Alpha" ? { update: false } : undefined) });
    await seed(db);
    const gated: TableView = { ...table, id: "tasks_gated", editVisibleWhen: { op: "notEmpty", field: "title" } };
    const docs: DocumentSet = { entities: documents.entities, views: new Map<string, ViewDocument>([...documents.views, [gated.id, gated]]) };
    const { container } = mount(db, { view: gated, documents: docs });
    await waitForRows(container);
    expect(screen.queryByRole("button", { name: "Edit Alpha" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Beta" })).toBeTruthy();
  });

  test("beside a rowAction the column is headed Edit and open, and both buttons show", async () => {
    const { db } = await seed();
    const drilled: TableView = { ...table, id: "tasks_drill", rowAction: { open: "tasks", bind: [{ field: "status", to: "status" }] } };
    const docs: DocumentSet = { entities: documents.entities, views: new Map<string, ViewDocument>([...documents.views, [drilled.id, drilled]]) };
    const { container } = mount(db, { view: drilled, documents: docs });
    await waitForRows(container);
    expect(screen.getByRole("columnheader", { name: "Edit and open" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Alpha" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Open Tasks/ }).length).toBe(2);
  });

  test("a wrong target is reported instead of dropping the button", async () => {
    const { db } = await seed();
    const { container } = mount(db, { view: { ...table, editForm: "tasks" } });
    await waitFor(() => expect(container.querySelector("[data-path='/editForm']")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain('editForm "tasks" is not a form view');
    cleanup();
    const other: FormView = { ...form, id: "other_form", entity: "person" };
    const docs: DocumentSet = { entities: documents.entities, views: new Map<string, ViewDocument>([[other.id, other]]) };
    mount(db, { view: { ...table, editForm: "other_form" }, documents: docs });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain('is for entity "person", not "task"'));
  });
});
