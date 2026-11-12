// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "set",
  revision: 1,
  fields: [
    { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
    { id: "notes", type: "text", label: "Notes" },
  ],
};

const base: TableView = {
  kind: "table",
  specVersion: 0,
  id: "sets",
  title: "Sets",
  entity: "set",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "exercise" }, { field: "notes" }],
  filter: { op: "eq", field: "exercise", value: "Squat" },
};

describe("table empty state", () => {
  test("a fixed filter alone does not claim the filters matched nothing", async () => {
    render(<TableRenderer entity={entity} view={base} registry={mockRegistry} dataSources={new Map([["default", createMemoryAdapter()]])} />);
    await waitFor(() => expect(screen.getByText("No records yet.")).toBeTruthy());
    expect(screen.queryByText("No records match the filters.")).toBeNull();
  });

  test("a quick filter that matches nothing says so, and clearing it restores the plain wording", async () => {
    const db = createMemoryAdapter();
    await db.create("set", { exercise: "Bench", notes: "light" }, { entityRevision: 1 });
    const view: TableView = { ...base, quickFilters: [{ field: "notes" }] };
    render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(screen.getByText("No records yet.")).toBeTruthy());
    const notes = () => within(screen.getByRole("group", { name: "Filter" })).getByLabelText("Notes");
    fireEvent.change(notes(), { target: { value: "nothing like this" } });
    await waitFor(() => expect(screen.getByText("No records match the filters.")).toBeTruthy());
    fireEvent.change(notes(), { target: { value: "" } });
    await waitFor(() => expect(screen.getByText("No records yet.")).toBeTruthy());
  });

  test("an empty table with a quick filter the viewer has not touched says No records yet", async () => {
    const { filter: _fixed, ...rest } = base;
    const view: TableView = { ...rest, quickFilters: [{ field: "notes" }] };
    render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", createMemoryAdapter()]])} />);
    await waitFor(() => expect(screen.getByText("No records yet.")).toBeTruthy());
  });
});
