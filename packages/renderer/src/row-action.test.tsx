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
    expect(names).toEqual(["Open Exercise history — Squat (2026-10-01)", "Open Exercise history — Bench (2026-10-02)"]);
  });

  test("a target title ending in \"for …\" cannot stutter the connector", async () => {
    // The consumer report this card fixes: a target view titled "Sets for
    // session" used to render "Open Sets for session for 3 (…)" — the ` for `
    // connector collided with the title's own preposition. An em dash cannot.
    const target: TableView = { ...base, id: "per-session", title: "Sets for session", columns: [{ field: "day" }, { field: "exercise" }] };
    const source: TableView = { ...sets, id: "sessions", rowAction: { open: "per-session", bind: [{ field: "exercise", to: "exercise" }] } };
    const docs: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map<string, TableView>([[source.id, source], [target.id, target]]) };
    render(<TableRenderer entity={entity} view={source} registry={mockRegistry} dataSources={await seed()} documents={docs} />);
    await screen.findByText("2026-10-01");
    const names = screen.getAllByRole("button", { name: /^Open / }).map((b) => b.textContent);
    expect(names).toEqual(["Open Sets for session — Squat (2026-10-01)", "Open Sets for session — Bench (2026-10-02)"]);
  });

  test("opening shows the target filtered by the row, with a heading, chips and Back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /— Bench/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /— Squat/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /— Bench/ }));
    await screen.findByRole("heading", { name: "Exercise history: Exercise = Bench" });
    expect(document.querySelectorAll("[data-yadad-grid-item]").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("button", { name: /— Bench/ });
  });
});

describe("controlled drill (RFC 0010 item 1)", () => {
  const chain = (id: string, next?: string): TableView => ({ ...history, id, title: id, quickFilters: [], ...(next ? { rowAction: { open: next, bind: [{ field: "day", to: "day" }] } } : {}) });
  const views = new Map<string, TableView>([["a", chain("a", "b")], ["b", chain("b", "c")], ["c", chain("c")]]);
  const docs: DocumentSet = { entities: documents.entities, views };
  const a = chain("a", "b");

  async function mount(drill: readonly { viewId: string; bindings: Readonly<Record<string, string>> }[], onDrillChange?: (d: readonly { viewId: string; bindings: Readonly<Record<string, string>> }[]) => void) {
    const dataSources = await seed();
    const ui = (d: typeof drill) => <TableRenderer entity={entity} view={a} registry={mockRegistry} dataSources={dataSources} documents={docs} drill={d} {...(onDrillChange ? { onDrillChange } : {})} />;
    const r = render(ui(drill));
    return { rerender: (d: typeof drill) => r.rerender(ui(d)) };
  }

  test("a push and Back are reported, and the host's value is what renders", async () => {
    const seen: unknown[] = [];
    const { rerender } = await mount([], (d) => seen.push(d));
    await screen.findAllByText("2026-10-01");
    fireEvent.click(screen.getAllByRole("button", { name: /^Open / })[0] as HTMLElement);
    expect(seen).toEqual([[{ viewId: "b", bindings: { day: "2026-10-01" } }]]);
    expect(screen.queryByRole("heading", { name: /^b:/ })).toBeNull(); // the host has not taken it yet
    rerender([{ viewId: "b", bindings: { day: "2026-10-01" } }]);
    await screen.findByRole("heading", { name: "b: Day = 2026-10-01" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(seen[1]).toEqual([]);
    rerender([]);
    await waitFor(() => expect(screen.queryByRole("heading", { name: /^b:/ })).toBeNull());
  });

  test("a two-hop drill is restored on first render, filtered by its bindings", async () => {
    await mount([{ viewId: "b", bindings: { day: "2026-10-01" } }, { viewId: "c", bindings: { day: "2026-10-01" } }]);
    await screen.findByRole("heading", { name: "c: Day = 2026-10-01" });
    await waitFor(() => expect(bodyRows().map((r) => cellText(r)[0])).toEqual(["2026-10-01"]));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a stale level cuts the drill back to its valid prefix and says so", async () => {
    const seen: unknown[] = [];
    await mount([{ viewId: "b", bindings: { day: "2026-10-01" } }, { viewId: "ghost", bindings: { day: "2026-10-01" } }], (d) => seen.push(d));
    await screen.findByRole("heading", { name: "b: Day = 2026-10-01" });
    expect(screen.queryByRole("heading", { name: /^c:/ })).toBeNull();
    await waitFor(() => expect(seen).toEqual([[{ viewId: "b", bindings: { day: "2026-10-01" } }]]));
    expect(screen.getByRole("status").textContent).toContain("no longer available");
  });
});

describe("dashboard drills keyed by widget (RFC 0010 item 1)", () => {
  const two: DashboardView = {
    kind: "dashboard",
    specVersion: 2,
    id: "board2",
    revision: 1,
    tabs: [{ id: "main", title: "Main", items: [
      { id: "w1", x: 0, y: 0, w: 6, h: 4, widget: "view", view: "sets" },
      { id: "w2", x: 6, y: 0, w: 6, h: 4, widget: "view", view: "sets" },
    ] }],
  };
  type Drill = readonly { viewId: string; bindings: Readonly<Record<string, string>> }[];
  const ui = (dataSources: Awaited<ReturnType<typeof seed>>, drills?: Record<string, Drill>, onDrillChange?: (id: string, d: Drill) => void) => (
    <DashboardRenderer dashboard={two} documents={documents} registry={mockRegistry} dataSources={dataSources} {...(drills ? { drills } : {})} {...(onDrillChange ? { onDrillChange } : {})} />
  );

  test("each table widget is restored from its own key", async () => {
    const dataSources = await seed();
    render(ui(dataSources, { w1: [{ viewId: "history", bindings: { exercise: "Bench" } }], w2: [{ viewId: "history", bindings: { exercise: "Squat" } }] }));
    await screen.findByRole("heading", { name: "Exercise history: Exercise = Bench" });
    await screen.findByRole("heading", { name: "Exercise history: Exercise = Squat" });
  });

  test("a widget with no key reports under its own id and starts at the top", async () => {
    const dataSources = await seed();
    const seen: unknown[] = [];
    render(ui(dataSources, { w1: [{ viewId: "history", bindings: { exercise: "Bench" } }] }, (id, d) => seen.push([id, d])));
    await screen.findByRole("heading", { name: "Exercise history: Exercise = Bench" });
    const w2 = within(document.querySelectorAll<HTMLElement>("[data-yadad-grid-item]")[1] as HTMLElement);
    await w2.findByText("2026-10-01");
    expect(w2.queryByRole("heading", { name: /^Exercise history/ })).toBeNull();
    fireEvent.click(w2.getAllByRole("button", { name: /— Bench/ })[0] as HTMLElement);
    expect(seen).toEqual([["w2", [{ viewId: "history", bindings: { exercise: "Bench" } }]]]);
  });

  test("a controlled Back returns focus to the row the level came from", async () => {
    const dataSources = await seed();
    const step = { viewId: "history", bindings: { exercise: "Bench" } };
    const r = render(ui(dataSources, { w1: [step] }, () => undefined));
    await screen.findByRole("heading", { name: "Exercise history: Exercise = Bench" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    r.rerender(ui(dataSources, { w1: [] }, () => undefined));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Open Exercise history — Bench (2026-10-02)"));
  });
});

describe("the record id as a binding (RFC 0008 item 1)", () => {
  test("opening a row whose action binds field id filters the child view by that record's id", async () => {
    const parent: EntityDocument = { kind: "entity", specVersion: 9, id: "session", revision: 1, fields: [{ id: "name", type: "text", label: "Name" }] };
    const child: EntityDocument = { kind: "entity", specVersion: 9, id: "log", revision: 1, fields: [{ id: "session_id", type: "text", label: "Session" }, { id: "note", type: "text", label: "Note" }] };
    const sessions: TableView = { kind: "table", specVersion: 9, id: "sessions", entity: "session", revision: 1, dataSource: "default", columns: [{ field: "name" }], rowAction: { open: "logs", bind: [{ field: "id", to: "session_id" }] } };
    const logs: TableView = { kind: "table", specVersion: 9, id: "logs", entity: "log", revision: 1, dataSource: "default", columns: [{ field: "note" }] };
    const docs: DocumentSet = { entities: new Map([[parent.id, parent], [child.id, child]]), views: new Map<string, TableView>([[sessions.id, sessions], [logs.id, logs]]) };
    const db = createMemoryAdapter();
    const one = await db.create("session", { name: "Monday" }, { entityRevision: 1 });
    const two = await db.create("session", { name: "Tuesday" }, { entityRevision: 1 });
    await db.create("log", { session_id: one.id, note: "squats" }, { entityRevision: 1 });
    await db.create("log", { session_id: two.id, note: "bench" }, { entityRevision: 1 });
    const seen: unknown[] = [];
    render(<TableRenderer entity={parent} view={sessions} registry={mockRegistry} dataSources={new Map([["default", db]])} documents={docs} onDrillChange={(d) => seen.push(d)} />);
    await screen.findByText("Monday");
    fireEvent.click(screen.getAllByRole("button", { name: /^Open / })[0] as HTMLElement);
    await screen.findByText("squats");
    expect(screen.queryByText("bench")).toBeNull();
    expect(seen).toEqual([[{ viewId: "logs", bindings: { session_id: one.id } }]]);
  });
});
