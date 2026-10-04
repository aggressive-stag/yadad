// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DataAdapter, EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { TableRenderer } from "./table-renderer";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "workout_set",
  revision: 3,
  fields: [
    { id: "day", type: "date", label: "Day", required: true },
    { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
    { id: "weight", type: "number", label: "Weight", min: 0, step: 2.5 },
    { id: "done", type: "boolean", label: "Done" },
  ],
};

const view: TableView = {
  kind: "table",
  specVersion: 0,
  id: "sets",
  title: "Sets",
  entity: "workout_set",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "day" }, { field: "exercise" }, { field: "weight", editable: true }, { field: "done", editable: true }],
  sort: [{ field: "day", dir: "desc" }],
  pageSize: 2,
};

async function setup(props: { view?: TableView } = {}): Promise<{ db: DataAdapter; rerender: (key: number) => void }> {
  const db = createMemoryAdapter();
  for (const values of [
    { day: "2026-10-01", exercise: "Squat", weight: 100, done: true },
    { day: "2026-10-03", exercise: "Bench", weight: 80, done: false },
    { day: "2026-10-02", exercise: "Squat", weight: 105, done: true },
  ]) {
    await db.create("workout_set", values, { entityRevision: 1 });
  }
  const dataSources = new Map([["default", db]]);
  const ui = (key: number) => <TableRenderer entity={entity} view={props.view ?? view} registry={mockRegistry} dataSources={dataSources} reloadKey={key} />;
  const { rerender } = render(ui(0));
  await screen.findAllByRole("row");
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return { db, rerender: (key) => rerender(ui(key)) };
}

/** Day of each body row, top to bottom. */
const days = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent);

const header = (label: string) => screen.getByRole("columnheader", { name: new RegExp(`^${label}`) });

describe("TableRenderer", () => {
  test("loads one page of rows in the view's default sort", async () => {
    await setup();
    expect(screen.getByRole("table", { name: "Sets" })).toBeTruthy();
    expect(days()).toEqual(["2026-10-03", "2026-10-02"]);
    expect(header("Day").getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  });

  test("clicking a header sorts by it; clicking again flips it", async () => {
    await setup();
    fireEvent.click(within(header("Weight")).getByRole("button"));
    await waitFor(() => expect(days()).toEqual(["2026-10-03", "2026-10-01"]));
    expect(header("Weight").getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(within(header("Weight")).getByRole("button"));
    await waitFor(() => expect(days()).toEqual(["2026-10-02", "2026-10-01"]));
  });

  test("pages through records", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(days()).toEqual(["2026-10-01"]));
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("edits a row in place: validates first, then saves under the current revision", async () => {
    const { db } = await setup();
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));

    const weight = within(firstRow()).getByRole("spinbutton", { name: "Weight" });
    fireEvent.change(weight, { target: { value: "81" } });
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("multiple of 2.5");
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    expect(weight.getAttribute("aria-describedby")).toBe(alert.id);

    fireEvent.change(weight, { target: { value: "82.5" } });
    fireEvent.click(within(firstRow()).getByRole("checkbox", { name: "Done" }));
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(firstRow()).queryByRole("spinbutton")).toBeNull());
    expect(firstRow().textContent).toContain("82.5");
    const saved = (await db.find("workout_set", {})).items.find((r) => r.values["day"] === "2026-10-03");
    expect(saved).toMatchObject({ entityRevision: 3, values: { weight: 82.5, done: true, exercise: "Bench" } });
  });

  test("Cancel discards an edit", async () => {
    await setup();
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "50" } });
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Cancel" }));
    expect(firstRow().textContent).toContain("80");
    expect(firstRow().textContent).not.toContain("50");
  });

  test("reloads when reloadKey changes", async () => {
    const { db, rerender } = await setup();
    await db.create("workout_set", { day: "2026-10-04", exercise: "Squat" }, { entityRevision: 3 });
    rerender(1);
    await waitFor(() => expect(days()[0]).toBe("2026-10-04"));
  });

  test("a view without editable columns has no actions column", async () => {
    await setup({ view: { ...view, columns: [{ field: "day" }, { field: "weight" }] } });
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
