// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BoardView, EntityDocument, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { BoardViewEditor } from "./board-view-editor.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "done"] } },
    { id: "flag", type: "boolean", label: "Flagged" },
    { id: "agreed", type: "boolean", label: "Agreed", required: true },
    { id: "list", type: "reference", label: "List", entity: "list" },
    { id: "notes", type: "text", label: "Notes" },
    { id: "due", type: "date", label: "Due" },
  ],
};

const view: BoardView = { kind: "board", specVersion: 0, id: "tasks_board", title: "Tasks", entity: "task", revision: 3, dataSource: "default", groupBy: [{ field: "status" }] };

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const rowsOf = (caption: RegExp) =>
  within(screen.getByRole("table", { name: caption }))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.textContent ?? "");

describe("BoardViewEditor", () => {
  function setup() {
    const saved: BoardView[] = [];
    render(<BoardViewEditor view={view} entity={entity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("applies settings as one undoable edit, then saves with a new revision", () => {
    const saved = setup();
    fireEvent.change(screen.getByLabelText("Title field"), { target: { value: "Notes" } });
    fireEvent.click(screen.getByLabelText("Dragging a card to another column moves it"));
    press("Apply settings");
    expect(screen.getByText("Board settings applied.")).toBeTruthy();
    expect(button("Save board").disabled).toBe(false);
    press("Save board");
    expect(saved[0]).toMatchObject({ revision: 4, titleField: "notes", editable: true });
    press("Undo");
    expect(button("Save board").disabled).toBe(true);
  });

  test("adds, reorders and removes groupings; the first is labelled the default and the last cannot be removed", () => {
    const saved = setup();
    expect(button("Remove Status").disabled).toBe(true);
    // Only groupable fields are offered.
    const offered = Array.from((screen.getByLabelText("Grouping to add") as HTMLSelectElement).options).map((o) => o.text).filter((t) => t !== "Choose…");
    expect(offered).toEqual(["Flagged", "List"]);
    press("Add grouping");
    press("Add grouping");
    expect(rowsOf(/Groupings of/).map((t) => t.replace(/Move.*$/, ""))[0]).toContain("(default)");
    press("Move List up");
    expect(screen.getByText(/List moved up to position 2/)).toBeTruthy();
    press("Move List up");
    expect(screen.getByText(/List moved up to position 1, the default grouping/)).toBeTruthy();
    expect(rowsOf(/Groupings of/)[0]).toContain("List (default)");
    press("Save board");
    expect(saved[0]?.groupBy.map((g) => g.field)).toEqual(["list", "status", "flag"]);
    press("Remove List");
    expect(screen.getByText(/List removed from the groupings/)).toBeTruthy();
  });

  test("a grip moves a grouping with the arrow keys", () => {
    setup();
    press("Add grouping");
    const grip = screen.getByRole("button", { name: /Drag the grouping Flagged/ });
    fireEvent.keyDown(grip, { key: "ArrowUp" });
    expect(screen.getByText(/Flagged moved up to position 1, the default grouping/)).toBeTruthy();
  });

  test("adds, reorders and removes card fields up to three, never the title", () => {
    const saved = setup();
    const offered = () => Array.from((screen.getByLabelText("Card field to add") as HTMLSelectElement).options).map((o) => o.text);
    expect(offered()).not.toContain("Title");
    press("Add card field");
    press("Add card field");
    press("Add card field");
    expect(screen.queryByRole("button", { name: "Add card field" })).toBeNull();
    expect(rowsOf(/Card fields of/)).toHaveLength(3);
    const first = rowsOf(/Card fields of/)[0] ?? "";
    fireEvent.click(within(screen.getByRole("table", { name: /Card fields of/ })).getAllByRole("button", { name: /^Move .* down$/ })[0]!);
    expect(rowsOf(/Card fields of/)[1]).toContain(first.replace(/Move.*$/, "").trim());
    press("Save board");
    expect(saved[0]?.cardFields).toHaveLength(3);
  });

  test("changing the title field to a card field keeps the board valid", () => {
    const saved: BoardView[] = [];
    render(<BoardViewEditor view={{ ...view, cardFields: ["notes"] }} entity={entity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Title field"), { target: { value: "Notes" } });
    press("Apply settings");
    press("Save board");
    expect(saved[0]).toMatchObject({ titleField: "notes" });
    expect(saved[0]?.cardFields).toBeUndefined();
  });

  test("sets and clears a fixed filter", () => {
    setup();
    press("Set cards always match");
    const comparison = document.querySelector("[data-yadad-condition-comparison]") as HTMLElement;
    fireEvent.change(within(comparison).getByTestId("input-field"), { target: { value: "Status" } });
    fireEvent.change(within(comparison).getByTestId("input-status"), { target: { value: "open" } });
    press("Apply cards always match");
    expect(screen.getAllByText(/Cards always match: Status/).length).toBeGreaterThan(0);
    press("Edit cards always match");
    press("Remove cards always match");
    expect(screen.getAllByText("Cards always match: none.").length).toBeGreaterThan(0);
  });

  test("a row action is offered only with a context, and can be set and cleared", () => {
    const table: TableView = { kind: "table", specVersion: 0, id: "task_history", title: "Task history", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }] };
    const context = { tables: [table], entities: [entity] };
    render(<BoardViewEditor view={view} entity={entity} registry={mockRegistry} context={context} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Activating a card does nothing.")).toBeTruthy();
    press("Set row action");
    expect(screen.getByText(/Activating a card opens Task history/)).toBeTruthy();
    press("Remove row action");
    expect(screen.getByText("Activating a card does nothing.")).toBeTruthy();
  });
});
