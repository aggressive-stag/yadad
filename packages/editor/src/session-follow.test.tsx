// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BoardView, CalendarView, DashboardView, Document, EntityDocument, FormView, TableView, ViewerDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { BoardViewEditor } from "./board-view-editor.js";
import { CalendarViewEditor } from "./calendar-view-editor.js";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";
import { EntityFieldsEditor } from "./entity-fields-editor.js";
import { FormViewEditor } from "./form-view-editor.js";
import { TableViewEditor } from "./table-view-editor.js";
import { ViewerPanel } from "./viewer-panel.js";

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

const fields = (e: EntityDocument): EntityDocument => e;

// One case per editor: how to mount it on a document, two different edits, and the Save button.
interface Case<T extends Document> {
  readonly name: string;
  readonly doc: T;
  readonly other: T; // a document with another id
  readonly mount: (doc: T, onSave: (d: T) => void) => ReactNode;
  readonly edits: readonly [() => void, () => void];
  readonly save: string;
}

const task = fields(entity);
const table: TableView = { kind: "table", specVersion: 0, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "done" }] };
const form: FormView = {
  kind: "form", specVersion: 0, id: "task_form", entity: "task", revision: 3, dataSource: "default",
  sections: [{ id: "main", title: "Task", items: [{ field: "title" }, { field: "done" }] }],
};
const board: BoardView = { kind: "board", specVersion: 0, id: "tasks_board", title: "Tasks", entity: "task", revision: 3, dataSource: "default", groupBy: [{ field: "title" }] };
const calendar: CalendarView = { kind: "calendar", specVersion: 0, id: "plan", title: "Plan", entity: "task", revision: 3, dataSource: "default", dateField: "due" };
const dashboard: DashboardView = {
  kind: "dashboard", specVersion: 0, id: "home", revision: 1,
  tabs: [{ id: "one", title: "One", items: [{ id: "total", x: 0, y: 0, w: 3, h: 2, widget: "count", label: "First", view: "tasks" }] }],
};
const viewerDoc: ViewerDocument = {
  kind: "viewer", specVersion: 0, id: "viewer", revision: 3,
  facts: [{ id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor"] }, default: "viewer" }],
};
const tasksView: TableView = { ...table, title: "Tasks" };
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const noop = () => {};

const cases: readonly Case<Document>[] = [
  {
    name: "TableViewEditor", doc: table, other: { ...table, id: "other_table" }, save: "Save table",
    mount: (d, onSave) => <TableViewEditor view={d as TableView} entity={task} registry={mockRegistry} onSave={onSave} onCancel={noop} />,
    edits: [() => press("Make Title editable"), () => press("Make Done editable")],
  },
  {
    name: "FormViewEditor", doc: form, other: { ...form, id: "other_form" }, save: "Save form",
    mount: (d, onSave) => <FormViewEditor view={d as FormView} entity={task} registry={mockRegistry} onSave={onSave} onCancel={noop} />,
    edits: [() => press("Move Done up"), () => press("Move Done down")],
  },
  {
    name: "BoardViewEditor", doc: board, other: { ...board, id: "other_board" }, save: "Save board",
    mount: (d, onSave) => <BoardViewEditor view={d as BoardView} entity={task} registry={mockRegistry} onSave={onSave} onCancel={noop} />,
    edits: [
      () => { fireEvent.click(screen.getByLabelText("Dragging a card to another column moves it")); press("Apply settings"); },
      () => { fireEvent.click(screen.getByLabelText("Dragging a card to another column moves it")); press("Apply settings"); },
    ],
  },
  {
    name: "CalendarViewEditor", doc: calendar, other: { ...calendar, id: "other_calendar" }, save: "Save calendar",
    mount: (d, onSave) => <CalendarViewEditor view={d as CalendarView} entity={task} registry={mockRegistry} onSave={onSave} onCancel={noop} />,
    edits: [
      () => { type("Title field", "Title"); press("Apply settings"); },
      () => { type("Title field", ""); press("Apply settings"); },
    ],
  },
  {
    name: "EntityFieldsEditor", doc: task, other: { ...task, id: "other_entity" }, save: "Save fields",
    mount: (d, onSave) => <EntityFieldsEditor entity={d as EntityDocument} views={[]} registry={mockRegistry} onSave={onSave} onCancel={noop} />,
    edits: [
      () => { press("Edit Title"); fireEvent.click(screen.getByLabelText("Set by the server (read-only)")); press("Apply changes"); },
      () => { press("Edit Done"); fireEvent.click(screen.getByLabelText("Set by the server (read-only)")); press("Apply changes"); },
    ],
  },
  {
    name: "DashboardLayoutEditor", doc: dashboard, other: { ...dashboard, id: "other_home" }, save: "Save layout",
    mount: (d, onSave) => <DashboardLayoutEditor dashboard={d as DashboardView} registry={mockRegistry} onSave={onSave} onCancel={noop} views={[tasksView]} entities={new Map([["task", task]])} />,
    edits: [
      () => fireEvent.keyDown(screen.getByRole("group", { name: /^Count: First/ }), { key: "ArrowRight" }),
      () => fireEvent.keyDown(screen.getByRole("group", { name: /^Count: First/ }), { key: "ArrowRight" }),
    ],
  },
  {
    name: "ViewerPanel", doc: viewerDoc, other: { ...viewerDoc, id: "other_viewer" }, save: "Save viewer facts",
    mount: (d, onSave) => <ViewerPanel viewer={d as ViewerDocument} registry={mockRegistry} onSave={onSave} onCancel={noop} />,
    edits: [
      () => { type("New fact name", "Plan"); press("Add fact"); },
      () => { type("New fact name", "Beta"); press("Add fact"); },
    ],
  },
];

/** A host that stores what it is given and keeps the editor mounted: no `key`. */
function hostOf(c: Case<Document>, saved: Document[], options: { readonly failSaves?: boolean } = {}) {
  let setDoc: (d: Document) => void = noop;
  function Host() {
    const [doc, set] = useState<Document>(c.doc);
    setDoc = set;
    return c.mount(doc, (d) => { saved.push(d); if (options.failSaves !== true) set(d); });
  }
  return { Host, setDoc: (d: Document) => setDoc(d) };
}

describe.each(cases)("$name, kept mounted by a host that stores the saved document", (c) => {
  test("two saves in a row give revisions N+1 and N+2, and Save is disabled in between", () => {
    const saved: Document[] = [];
    const { Host } = hostOf(c, saved);
    render(<Host />);
    c.edits[0]();
    press(c.save);
    expect(saved[0]?.revision).toBe(c.doc.revision + 1);
    expect(button(c.save).disabled).toBe(true);
    c.edits[1]();
    expect(button(c.save).disabled).toBe(false);
    press(c.save);
    expect(saved[1]?.revision).toBe(c.doc.revision + 2);
    expect(saved[1]).not.toEqual({ ...saved[0], revision: saved[1]?.revision });
  });

  test("Undo steps back past the Save, the editor is dirty again, and the next Save is one above the stored revision", () => {
    const saved: Document[] = [];
    const { Host } = hostOf(c, saved);
    render(<Host />);
    c.edits[0]();
    press(c.save);
    expect(button(c.save).disabled).toBe(true);
    press("Undo");
    expect(button(c.save).disabled).toBe(false);
    press(c.save);
    expect(saved[1]?.revision).toBe(c.doc.revision + 2);
    expect(saved[1]).toEqual({ ...c.doc, revision: c.doc.revision + 2 });
  });

  test("a document with another id starts a new session with an empty undo log", () => {
    const saved: Document[] = [];
    const { Host, setDoc } = hostOf(c, saved);
    render(<Host />);
    c.edits[0]();
    expect(button(c.save).disabled).toBe(false);
    act(() => setDoc(c.other));
    expect(button(c.save).disabled).toBe(true);
    expect(button("Undo").disabled).toBe(true);
    expect(saved).toEqual([]);
  });

  test("a failed save that hands back the old document keeps the edits and Save enabled", () => {
    const saved: Document[] = [];
    const { Host, setDoc } = hostOf(c, saved, { failSaves: true });
    render(<Host />);
    c.edits[0]();
    press(c.save);
    expect(saved).toHaveLength(1);
    act(() => setDoc({ ...c.doc }));
    expect(button(c.save).disabled).toBe(false);
    expect(button("Undo").disabled).toBe(false);
    press(c.save);
    expect(saved[1]?.revision).toBe(c.doc.revision + 1);
  });
});
