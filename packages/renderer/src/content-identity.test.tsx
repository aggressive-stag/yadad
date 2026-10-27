// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DashboardView, EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DashboardRenderer } from "./dashboard-renderer.js";
import type { DocumentSet } from "./document-set.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 2,
  id: "item",
  revision: 1,
  fields: [
    { id: "name", type: "text", label: "Name" },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["a", "b"] } },
  ],
};
const base = { kind: "table", specVersion: 2, entity: "item", revision: 1, dataSource: "default" } as const;
const list: TableView = { ...base, id: "list", title: "List", columns: [{ field: "name" }, { field: "kind" }], quickFilters: [{ field: "name" }], rowAction: { open: "detail", bind: [{ field: "kind", to: "kind" }] } };
const detail: TableView = { ...base, id: "detail", title: "Detail", columns: [{ field: "name" }], quickFilters: [{ field: "name" }] };
const other: TableView = { ...base, id: "other", title: "Other", columns: [{ field: "name" }] };
const board: DashboardView = {
  kind: "dashboard",
  specVersion: 2,
  id: "home",
  revision: 1,
  tabs: [
    { id: "one", title: "One", items: [{ id: "w1", x: 0, y: 0, w: 12, h: 4, widget: "view", view: "list" }] },
    { id: "two", title: "Two", items: [{ id: "w2", x: 0, y: 0, w: 12, h: 4, widget: "view", view: "other" }] },
  ],
};

/** Equal content, new objects at every level: what a host that rebuilds its documents on each render passes. */
const fresh = <T,>(value: T): T => structuredClone(value);
const build = (): DocumentSet => ({
  entities: new Map([[entity.id, fresh(entity)]]),
  views: new Map<string, TableView>([list, detail, other].map((v) => [v.id, fresh(v)])),
});

async function seeded() {
  const db = createMemoryAdapter();
  for (const values of [{ name: "x", kind: "a" }, { name: "y", kind: "b" }]) await db.create("item", values, { entityRevision: 1 });
  const find = vi.spyOn(db, "find");
  return { db, find, dataSources: new Map([["default", db]]) };
}

type Drill = readonly { viewId: string; bindings: Readonly<Record<string, string>> }[];

async function scenario(rebuild: boolean): Promise<number> {
  const { find, dataSources } = await seeded();
  const stable = build();
  const docs = () => (rebuild ? build() : stable);
  const drill: Drill = [{ viewId: "detail", bindings: { kind: "a" } }];
  const ui = (d: Drill, tab: string) => (
    <>
      <TableRenderer entity={rebuild ? fresh(entity) : entity} view={rebuild ? fresh(list) : list} registry={mockRegistry} dataSources={new Map(dataSources)} documents={docs()} drill={rebuild ? fresh(d) : d} />
      <DashboardRenderer dashboard={rebuild ? fresh(board) : board} documents={docs()} registry={mockRegistry} dataSources={new Map(dataSources)} tab={tab} />
    </>
  );
  const r = render(ui(drill, "one"));
  await waitFor(() => expect(screen.getAllByText("x").length).toBeGreaterThan(0));
  // Host re-renders with new, equal props: no fetch may follow.
  for (let i = 0; i < 3; i++) r.rerender(ui(drill, "one"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Drill open: a second hop; the first hop must not refetch.
  r.rerender(ui([...drill, { viewId: "detail", bindings: { kind: "b" } }], "one"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Tab switch.
  r.rerender(ui(drill, "two"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Quick-filter change on the top table.
  fireEvent.change(screen.getAllByTestId("input-name")[0] as HTMLElement, { target: { value: "x" } });
  await new Promise((resolve) => setTimeout(resolve, 400));
  r.rerender(ui(drill, "two"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  return find.mock.calls.length;
}

describe("data fetches depend on document content, not object identity", () => {
  test("rebuilt but equal props fetch exactly as often as stable ones (drill open, tab switch, quick filter)", async () => {
    const stable = await scenario(false);
    cleanup();
    const rebuilt = await scenario(true);
    expect(stable).toBeGreaterThan(0);
    expect(rebuilt).toBe(stable);
  });
});
