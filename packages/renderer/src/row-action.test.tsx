// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DashboardView, EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardRenderer } from "./dashboard-renderer.js";
import type { DocumentSet } from "./document-set.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 2,
  id: "workout_set",
  revision: 1,
  fields: [
    { id: "day", type: "date", label: "Day" },
    { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
    { id: "weight", type: "number", label: "Weight" },
  ],
};

const base = { kind: "table", specVersion: 2, entity: "workout_set", revision: 1, dataSource: "default" } as const;
const sets: TableView = {
  ...base,
  id: "sets",
  title: "Sets",
  columns: [{ field: "day" }, { field: "exercise" }, { field: "weight" }],
  sort: [{ field: "day", dir: "asc" }],
  pageSize: 2,
  quickFilters: [{ field: "exercise" }],
  rowAction: { open: "history", bind: [{ field: "exercise", to: "exercise" }] },
};
const history: TableView = {
  ...base,
  id: "history",
  title: "Exercise history",
  columns: [{ field: "day" }, { field: "weight" }],
  sort: [{ field: "day", dir: "asc" }],
  quickFilters: [{ field: "exercise" }, { field: "weight" }],
};
const documents: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map<string, TableView>([[sets.id, sets], [history.id, history]]) };

async function seed() {
  const db = createMemoryAdapter();
  for (const values of [
    { day: "2026-10-01", exercise: "Squat", weight: 100 },
    { day: "2026-10-02", exercise: "Bench", weight: 80 },
    { day: "2026-10-03", exercise: "Squat", weight: 105 },
    { day: "2026-10-04", exercise: "Squat", weight: 110 },
  ]) {
    await db.create("workout_set", values, { entityRevision: 1 });
  }
  return new Map([["default", db]]);
}

async function open(view: TableView = sets) {
  const dataSources = await seed();
  render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={dataSources} documents={documents} />);
  await screen.findByText("2026-10-01");
}

const bodyRows = () => screen.getAllByRole("row").slice(1);
const cellText = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent ?? "");

describe("row action", () => {
  test("every row has an Open button with a name that says what opens", async () => {
    await open();
    const names = screen.getAllByRole("button", { name: /^Open / }).map((b) => b.textContent);
    expect(names).toEqual(["Open Exercise history for Squat (2026-10-01)", "Open Exercise history for Bench (2026-10-02)"]);
  });

  test("opening shows the target filtered by the row, with a heading, chips and Back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /for Bench/ }));
    const heading = await screen.findByRole("heading", { name: "Exercise history: Exercise = Bench" });
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(bodyRows().map((r) => cellText(r)[0])).toEqual(["2026-10-02"]);
    expect(document.activeElement).toBe(heading);
    // the bound field's quick filter is hidden; the others still work
    const level = within(document.querySelector<HTMLElement>('[data-yadad-drill-level="1"]') as HTMLElement);
    expect(level.queryByTestId("input-exercise")).toBeNull();
    expect(level.getAllByTestId("input-weight").length).toBe(2); // from and to
  });

  test("the target is filtered by all matching rows, ignoring the source's paging", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /for Squat/ }));
    await screen.findByRole("heading", { name: /Squat/ });
    await waitFor(() => expect(bodyRows().map((r) => cellText(r)[0])).toEqual(["2026-10-01", "2026-10-03", "2026-10-04"]));
  });

  test("Back restores the source table, with its page, and returns focus to the originating row's action", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("2026-10-03");
    const origin = screen.getAllByRole("button", { name: /^Open / })[1];
    if (!origin) throw new Error("no row action");
    fireEvent.click(origin);
    await screen.findByRole("heading", { name: /Squat/ });
    expect(screen.getByText("Page 2 of 2").closest("[hidden]")).not.toBeNull(); // the source is kept, hidden, not shown beside the target
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2").closest("[hidden]")).toBeNull());
    expect(screen.queryByRole("heading", { name: /Squat/ })).toBeNull();
    expect(bodyRows().map((r) => cellText(r)[0])).toEqual(["2026-10-03", "2026-10-04"]);
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  test("a table without a row action has no Open buttons and no Back", async () => {
    const { rowAction: _unused, ...plain } = sets;
    await open(plain);
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  test("an unknown target is reported in the core error format, not guessed", async () => {
    const dataSources = await seed();
    const broken: TableView = { ...sets, rowAction: { open: "ghost", bind: [{ field: "exercise", to: "exercise" }] } };
    render(<TableRenderer entity={entity} view={broken} registry={mockRegistry} dataSources={dataSources} documents={documents} />);
    expect((await screen.findByRole("alert")).textContent).toContain('"ghost"');
  });

  test("chains go up to three hops deep, each Back going one level up", async () => {
    const dataSources = await seed();
    const chain = (id: string, next?: string): TableView => ({ ...history, id, title: id, quickFilters: [], ...(next ? { rowAction: { open: next, bind: [{ field: "day", to: "day" }] } } : {}) });
    const views = new Map<string, TableView>([["a", chain("a", "b")], ["b", chain("b", "c")], ["c", chain("c", "d")], ["d", chain("d")]]);
    const docs: DocumentSet = { entities: documents.entities, views };
    const a = views.get("a");
    if (!a) throw new Error("no a");
    render(<TableRenderer entity={entity} view={a} registry={mockRegistry} dataSources={dataSources} documents={docs} />);
    for (const next of ["b", "c", "d"]) {
      await screen.findAllByText("2026-10-01");
      fireEvent.click(screen.getAllByRole("button", { name: /^Open / })[0] as HTMLElement);
      await screen.findByRole("heading", { name: new RegExp(`^${next}:`) });
    }
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: /^c:/ });
  });
});

describe("row action in a dashboard widget", () => {
  test("the target replaces the widget's contents and Back restores them", async () => {
    const dataSources = await seed();
    const dashboard: DashboardView = {
      kind: "dashboard",
      specVersion: 2,
      id: "board",
      revision: 1,
      tabs: [{ id: "main", title: "Main", items: [{ id: "w", x: 0, y: 0, w: 12, h: 4, widget: "view", view: "sets" }] }],
    };
    render(<DashboardRenderer dashboard={dashboard} documents={documents} registry={mockRegistry} dataSources={dataSources} />);
    await screen.findByText("2026-10-01");
    fireEvent.click(screen.getByRole("button", { name: /for Bench/ }));
    await screen.findByRole("heading", { name: "Exercise history: Exercise = Bench" });
    expect(document.querySelectorAll("[data-yadad-grid-item]").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("button", { name: /for Bench/ });
  });
});
