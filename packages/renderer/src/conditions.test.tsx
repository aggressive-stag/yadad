// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Condition, DataRecord, EntityDocument, FormView, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "set",
  revision: 1,
  fields: [
    { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
    { id: "felt", type: "select", label: "Felt", options: { source: "static", values: ["Easy", "Hard"] } },
    { id: "why", type: "text", label: "What made it hard?" },
    { id: "warmup", type: "boolean", label: "Warm-up" },
    { id: "notes", type: "text", label: "Notes" },
  ],
};

describe("form conditions", () => {
  const hard: Condition = { op: "eq", field: "felt", value: "Hard" };
  const view: FormView = {
    kind: "form",
    specVersion: 0,
    id: "log",
    entity: "set",
    revision: 1,
    dataSource: "default",
    sections: [{ id: "s", items: [{ field: "felt" }, { field: "why", visibleWhen: hard, requiredWhen: hard, clearWhenHidden: true }] }],
  };

  test("a field appears, becomes required, and its hidden value is dropped on save", async () => {
    const db = createMemoryAdapter();
    const saved: DataRecord[] = [];
    render(<FormRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", db]])} onSaved={(r) => saved.push(r)} />);
    expect(screen.queryByLabelText(/What made it hard/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Felt"), { target: { value: "Hard" } });
    const why = screen.getByLabelText(/What made it hard/);
    expect(screen.getByText("What made it hard?").parentElement?.textContent).toContain("*");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByTestId("field-error")).textContent).toContain("required");

    fireEvent.change(why, { target: { value: "bad sleep" } });
    fireEvent.change(screen.getByLabelText("Felt"), { target: { value: "Easy" } });
    expect(screen.queryByLabelText(/What made it hard/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.values).toEqual({ felt: "Easy" });
  });
});

describe("table filters", () => {
  const view: TableView = {
    kind: "table",
    specVersion: 0,
    id: "sets",
    title: "Sets",
    entity: "set",
    revision: 1,
    dataSource: "default",
    columns: [{ field: "exercise" }, { field: "notes" }],
    filter: { op: "neq", field: "felt", value: "Hard" },
    quickFilters: [{ field: "exercise" }, { field: "warmup" }, { field: "notes" }],
  };

  async function setup() {
    const db = createMemoryAdapter();
    for (const values of [
      { exercise: "Squat", felt: "Easy", warmup: true, notes: "light" },
      { exercise: "Squat", felt: "Easy", notes: "top set" }, // checkbox never touched: no warmup value
      { exercise: "Bench", felt: "Easy", warmup: false, notes: "Top set, paused" },
      { exercise: "Bench", felt: "Hard", warmup: false, notes: "grindy" },
    ]) {
      await db.create("set", values, { entityRevision: 1 });
    }
    render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
  }
  const notes = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[1]?.textContent);
  const filterBar = () => screen.getByRole("group", { name: "Filter" });

  test("the fixed filter always applies", async () => {
    await setup();
    expect(notes()).toEqual(["light", "top set", "Top set, paused"]);
  });

  test("quick filters narrow the rows and combine", async () => {
    await setup();
    fireEvent.change(within(filterBar()).getByLabelText("Exercise"), { target: { value: "Squat" } });
    await waitFor(() => expect(notes()).toEqual(["light", "top set"]));
    fireEvent.change(within(filterBar()).getByLabelText("Warm-up"), { target: { value: "No" } });
    await waitFor(() => expect(notes()).toEqual(["top set"]));
    fireEvent.change(within(filterBar()).getByLabelText("Exercise"), { target: { value: "Bench" } });
    fireEvent.change(within(filterBar()).getByLabelText("Notes"), { target: { value: "nothing like this" } });
    await waitFor(() => expect(screen.getByText("No records match the filters.")).toBeTruthy());
    fireEvent.change(within(filterBar()).getByLabelText("Notes"), { target: { value: "" } });
    fireEvent.change(within(filterBar()).getByLabelText("Warm-up"), { target: { value: "" } });
    fireEvent.change(within(filterBar()).getByLabelText("Exercise"), { target: { value: "" } });
    fireEvent.change(within(filterBar()).getByLabelText("Notes"), { target: { value: "TOP SET" } });
    await waitFor(() => expect(notes()).toEqual(["top set", "Top set, paused"]));
  });
});

test("quick filters on unsupported field types are reported", () => {
  const view: TableView = {
    kind: "table",
    specVersion: 0,
    id: "t",
    entity: "set",
    revision: 1,
    dataSource: "default",
    columns: [{ field: "notes" }],
    quickFilters: [{ field: "notes" }],
  };
  const withNumber: EntityDocument = { ...entity, fields: [...entity.fields.filter((f) => f.id !== "notes"), { id: "notes", type: "number", label: "Notes" }] };
  render(<TableRenderer entity={withNumber} view={view} registry={mockRegistry} dataSources={new Map([["default", createMemoryAdapter()]])} />);
  expect(screen.getByTestId("error-summary").textContent).toContain("do not support number fields");
});
