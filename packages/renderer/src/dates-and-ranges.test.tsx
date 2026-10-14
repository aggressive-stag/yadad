// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Condition, DashboardView, DataAdapter, EntityDocument, Query, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DashboardRenderer } from "./dashboard-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// A fixed local "today" of 2026-10-14; only Date is faked so waitFor keeps working.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
});

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "set",
  revision: 1,
  fields: [
    { id: "day", type: "date", label: "Day" },
    { id: "rpe", type: "number", label: "RPE" },
    { id: "note", type: "text", label: "Note" },
  ],
};

const rows = [
  { day: "2026-10-14", rpe: 7, note: "today a" },
  { day: "2026-10-14", rpe: 9, note: "today b" },
  { day: "2026-10-10", rpe: 8, note: "four days ago" },
  { day: "2026-10-01", rpe: 6, note: "two weeks ago" },
];

/** A memory adapter that records every query it is asked. */
async function capturing(): Promise<{ db: DataAdapter; queries: Query[] }> {
  const inner = createMemoryAdapter();
  for (const values of rows) await inner.create("set", values, { entityRevision: 1 });
  const queries: Query[] = [];
  return { db: { ...inner, find: (e, q) => (queries.push(q), inner.find(e, q)) }, queries };
}

const table = (extra: Partial<TableView>): TableView => ({
  kind: "table",
  specVersion: 1,
  id: "sets",
  entity: "set",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "note" }],
  ...extra,
});

const notes = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]?.textContent);
const filterBar = () => screen.getByRole("group", { name: "Filter" });
const hasRelative = (q: Query) => JSON.stringify(q).includes("daysFromToday");

describe("relative dates", () => {
  test("a table filter reaches the adapter as a fixed date", async () => {
    const { db, queries } = await capturing();
    const filter: Condition = { op: "gte", field: "day", value: { daysFromToday: -7 } };
    render(<TableRenderer entity={entity} view={table({ filter })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(notes()).toEqual(["today a", "today b", "four days ago"]));
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some(hasRelative)).toBe(false);
    expect(queries.at(-1)?.filter).toEqual({ op: "gte", field: "day", value: "2026-10-07" });
  });

  test("a count widget filter reaches the adapter as a fixed date", async () => {
    const { db, queries } = await capturing();
    const dashboard: DashboardView = {
      kind: "dashboard",
      specVersion: 1,
      id: "board",
      revision: 1,
      tabs: [{ id: "t", title: "T", items: [{ id: "c", x: 0, y: 0, w: 4, h: 1, widget: "count", label: "Today", view: "sets", filter: { op: "eq", field: "day", value: { daysFromToday: 0 } } }] }],
    };
    render(
      <DashboardRenderer dashboard={dashboard} documents={{ entities: new Map([["set", entity]]), views: new Map([["sets", table({})]]) }} registry={mockRegistry} dataSources={new Map([["default", db]])} />,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("2"));
    expect(queries.some(hasRelative)).toBe(false);
    expect(queries.at(-1)?.filter).toEqual({ op: "eq", field: "day", value: "2026-10-14" });
  });
});

describe("range quick filters", () => {
  async function setup() {
    const { db, queries } = await capturing();
    const view = table({ columns: [{ field: "note" }], quickFilters: [{ field: "rpe" }, { field: "day" }] });
    render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(5));
    return queries;
  }
  const set = (label: string, value: string) => fireEvent.change(within(filterBar()).getByLabelText(label), { target: { value } });

  test("number: from, to, both and either end empty", async () => {
    await setup();
    set("RPE from", "8");
    await waitFor(() => expect(notes()).toEqual(["today b", "four days ago"]));
    set("RPE to", "8");
    await waitFor(() => expect(notes()).toEqual(["four days ago"]));
    set("RPE from", "");
    await waitFor(() => expect(notes()).toEqual(["today a", "four days ago", "two weeks ago"]));
    set("RPE to", "");
    await waitFor(() => expect(notes()).toHaveLength(4));
  });

  test("date: from and to, sent as gte/lte conditions", async () => {
    const queries = await setup();
    set("Day from", "2026-10-05");
    await waitFor(() => expect(notes()).toEqual(["today a", "today b", "four days ago"]));
    set("Day to", "2026-10-11");
    await waitFor(() => expect(notes()).toEqual(["four days ago"]));
    expect(queries.at(-1)?.filter).toEqual({
      op: "and",
      conditions: [
        { op: "gte", field: "day", value: "2026-10-05" },
        { op: "lte", field: "day", value: "2026-10-11" },
      ],
    });
  });

  test("a range filter combines with the fixed filter and with other quick filters", async () => {
    const { db } = await capturing();
    const view = table({ filter: { op: "gte", field: "day", value: { daysFromToday: -7 } }, quickFilters: [{ field: "rpe" }, { field: "note" }] });
    render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    set("RPE from", "8");
    await waitFor(() => expect(notes()).toEqual(["today b", "four days ago"]));
    set("Note", "today");
    await waitFor(() => expect(notes()).toEqual(["today b"]));
  });
});
