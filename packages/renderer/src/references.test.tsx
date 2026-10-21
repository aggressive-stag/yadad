// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DataAdapter, EntityDocument, FormView, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FormRenderer } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const exercise: EntityDocument = {
  kind: "entity",
  specVersion: 2,
  id: "exercise",
  revision: 1,
  fields: [{ id: "name", type: "text", label: "Name", required: true }],
};
const entry: EntityDocument = {
  kind: "entity",
  specVersion: 2,
  id: "set_entry",
  revision: 1,
  fields: [
    { id: "exercise", type: "reference", label: "Exercise", required: true, entity: "exercise" },
    { id: "reps", type: "number", label: "Reps" },
  ],
};
const entities = new Map([
  ["exercise", exercise],
  ["set_entry", entry],
]);
const form: FormView = {
  kind: "form",
  specVersion: 2,
  id: "log",
  entity: "set_entry",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "main", items: [{ field: "exercise" }, { field: "reps" }] }],
};
const table: TableView = {
  kind: "table",
  specVersion: 2,
  id: "entries",
  title: "Entries",
  entity: "set_entry",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "exercise", editable: true }, { field: "reps" }],
};

async function seeded(): Promise<DataAdapter> {
  const db = createMemoryAdapter();
  for (const name of ["Squat", "Bench"]) await db.create("exercise", { name }, { entityRevision: 1 });
  return db;
}

describe("reference field in a form", () => {
  test("offers the target's records sorted by label and saves the chosen id", async () => {
    const db = await seeded();
    render(<FormRenderer entity={entry} view={form} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={entities} />);
    const select = screen.getByTestId("input-exercise") as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "Bench", "Squat"]);
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await db.find("set_entry", {})).items[0]?.values).toEqual({ exercise: "1" }));
  });

  test("requires a choice", async () => {
    const db = await seeded();
    render(<FormRenderer entity={entry} view={form} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={entities} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByTestId("field-error")).getAttribute("data-code")).toBe("required");
  });

  test("shows an error state when the target entity was not provided", async () => {
    const db = await seeded();
    render(<FormRenderer entity={entry} view={form} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    expect((await screen.findByTestId("options-error-exercise")).textContent).toContain('Entity "exercise" was not provided');
  });

  test("shows the empty state and the more-records signal", async () => {
    const empty = createMemoryAdapter();
    render(<FormRenderer entity={entry} view={form} registry={mockRegistry} dataSources={new Map([["default", empty]])} entities={entities} />);
    expect(await screen.findByTestId("options-empty-exercise")).toBeTruthy();
    cleanup();
    const big = createMemoryAdapter();
    for (let i = 0; i < 201; i++) await big.create("exercise", { name: `E${String(i).padStart(3, "0")}` }, { entityRevision: 1 });
    render(<FormRenderer entity={entry} view={form} registry={mockRegistry} dataSources={new Map([["default", big]])} entities={entities} />);
    expect(await screen.findByTestId("options-more-exercise")).toBeTruthy();
  });
});

describe("reference field in a table", () => {
  test("shows labels, the raw id while loading, and Unknown for a deleted record", async () => {
    const db = await seeded();
    await db.create("set_entry", { exercise: "2", reps: 5 }, { entityRevision: 1 });
    await db.create("set_entry", { exercise: "99", reps: 3 }, { entityRevision: 1 });
    render(<TableRenderer entity={entry} view={table} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={entities} />);
    await waitFor(() => expect(screen.getAllByTestId("display-exercise").map((e) => e.textContent)).toEqual(["Bench", "Unknown"]));
    expect(screen.getAllByTestId("display-exercise").map((e) => e.getAttribute("data-status"))).toEqual(["found", "missing"]);
  });

  test("the reference column is not sortable", async () => {
    const db = await seeded();
    render(<TableRenderer entity={entry} view={table} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={entities} />);
    await screen.findByRole("table");
    expect(within(screen.getByRole("columnheader", { name: "Exercise" })).queryByRole("button")).toBeNull();
    expect(within(screen.getByRole("columnheader", { name: "Reps" })).getByRole("button")).toBeTruthy();
  });

  test("an edited row offers the picker with its current label selected", async () => {
    const db = await seeded();
    await db.create("set_entry", { exercise: "1", reps: 5 }, { entityRevision: 1 });
    render(<TableRenderer entity={entry} view={table} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={entities} />);
    await waitFor(() => expect(screen.getByTestId("display-exercise").textContent).toBe("Squat"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const select = (await screen.findByTestId("input-exercise")) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3));
    expect(select.value).toBe("1");
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("display-exercise").textContent).toBe("Bench"));
  });

  test("a table whose reference target was never wired warns once and keeps the raw id", async () => {
    const db = await seeded();
    await db.create("set_entry", { exercise: "1", reps: 5 }, { entityRevision: 1 });
    await db.create("set_entry", { exercise: "2", reps: 3 }, { entityRevision: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Only the row's own entity is passed; the reference target is missing.
      const partial = new Map([["set_entry", entry]]);
      render(<TableRenderer entity={entry} view={table} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={partial} />);
      // The raw ids stay on screen: no contract change, the warning is the signal.
      await waitFor(() => expect(screen.getAllByTestId("display-exercise").map((e) => e.textContent)).toEqual(["1", "2"]));
      // Two rows, one target entity: exactly one warning per mount.
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn.mock.calls[0]?.[0]).toBe('yadad: reference field "exercise" points at entity "exercise", which was not passed in the renderer\'s "entities" prop, so its cells show raw ids.');
    } finally {
      warn.mockRestore();
    }
  });

  test("a wired reference target does not warn", async () => {
    const db = await seeded();
    await db.create("set_entry", { exercise: "1", reps: 5 }, { entityRevision: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<TableRenderer entity={entry} view={table} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={entities} />);
      await waitFor(() => expect(screen.getByTestId("display-exercise").textContent).toBe("Squat"));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
