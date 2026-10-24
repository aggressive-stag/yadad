// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Condition, DashboardView, DataAdapter, EntityDocument, FormView, Registry, SeriesWidgetProps, TableView, ViewDocument } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { DashboardRenderer } from "./dashboard-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "set",
  revision: 1,
  fields: [
    { id: "exercise", type: "select", label: "Exercise", required: true, options: { source: "static", values: ["Squat", "Bench"] } },
    { id: "warmup", type: "boolean", label: "Warm-up" },
  ],
};
const form: FormView = { kind: "form", specVersion: 0, id: "log", entity: "set", revision: 1, dataSource: "default", sections: [{ id: "s", title: "Log a set", items: [{ field: "exercise" }] }] };
const table: TableView = { kind: "table", specVersion: 0, id: "sets", title: "Sets", entity: "set", revision: 1, dataSource: "default", columns: [{ field: "exercise" }] };
const editableTable: TableView = { ...table, id: "sets_edit", columns: [{ field: "exercise" }, { field: "warmup", editable: true }] };
const dashboard: DashboardView = {
  kind: "dashboard",
  specVersion: 0,
  id: "training",
  title: "Training",
  revision: 1,
  tabs: [
    {
      id: "log",
      title: "Log",
      items: [
        { id: "form", x: 0, y: 0, w: 8, h: 1, widget: "view", view: "log" },
        { id: "total", x: 8, y: 0, w: 4, h: 1, widget: "count", label: "Squat sets", view: "sets", filter: { op: "eq", field: "exercise", value: "Squat" } },
      ],
    },
    { id: "history", title: "History", columns: 4, items: [{ id: "table", x: 0, y: 0, w: 4, h: 1, widget: "view", view: "sets" }] },
  ],
};

function renderDashboard(views: ViewDocument[] = [form, table], d: DashboardView = dashboard) {
  const db = createMemoryAdapter();
  render(
    <DashboardRenderer
      dashboard={d}
      documents={{ entities: new Map([["set", entity]]), views: new Map(views.map((v) => [v.id, v])) }}
      registry={mockRegistry}
      dataSources={new Map([["default", db]])}
    />,
  );
  return db;
}

describe("DashboardRenderer", () => {
  test("lays out the selected tab's widgets on the grid", async () => {
    renderDashboard();
    expect(screen.getByRole("tablist", { name: "Training" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Log" }).getAttribute("aria-selected")).toBe("true");
    const formItem = document.querySelector<HTMLElement>('[data-yadad-grid-item="form"]')!;
    expect(formItem.style.gridColumn).toBe("1 / span 8");
    expect(document.querySelector<HTMLElement>('[data-yadad-grid-item="total"]')!.style.gridColumn).toBe("9 / span 4");
    const grid = document.querySelector<HTMLElement>('[data-yadad-grid="log"]')!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
    expect(grid.style.gridAutoRows).toBe("var(--yadad-grid-row-height, 4rem)");
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("0"));
  });

  test("initialTab seeds the selection, and the viewer's own click wins from then on", async () => {
    // Only the first render reads `initialTab` — the states preview opens a
    // dashboard on a second tab without taking the tab bar away.
    const db = createMemoryAdapter();
    const { rerender } = render(
      <DashboardRenderer
        dashboard={dashboard}
        documents={{ entities: new Map([["set", entity]]), views: new Map([form, table].map((v) => [v.id, v])) }}
        registry={mockRegistry}
        dataSources={new Map([["default", db]])}
        initialTab="history"
      />,
    );
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("table", { name: "Sets" })).toBeTruthy();
    // A re-render with the same initialTab must not yank the viewer back.
    fireEvent.click(screen.getByRole("tab", { name: "Log" }));
    rerender(
      <DashboardRenderer
        dashboard={dashboard}
        documents={{ entities: new Map([["set", entity]]), views: new Map([form, table].map((v) => [v.id, v])) }}
        registry={mockRegistry}
        dataSources={new Map([["default", db]])}
        initialTab="history"
      />,
    );
    expect(screen.getByRole("tab", { name: "Log" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByLabelText(/^Exercise/)).toBeTruthy();
  });

  test("one visible tab means no tab strip; a named region keeps the landmark; two tabs keep the strip", () => {
    // A strip with one tab repeats the page title and pushes content down on a phone.
    const single: DashboardView = { ...dashboard, tabs: [dashboard.tabs[1]!] };
    const one = render(
      <DashboardRenderer
        dashboard={single}
        documents={{ entities: new Map([["set", entity]]), views: new Map([form, table].map((v) => [v.id, v])) }}
        registry={mockRegistry}
        dataSources={new Map([["default", createMemoryAdapter()]])}
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("region", { name: "Training" })).toBeTruthy();
    one.unmount();
    // Untitled, the id names the region — the landmark never goes anonymous.
    const { title: _untitled, ...noTitle } = single;
    const idNamed = render(
      <DashboardRenderer
        dashboard={noTitle}
        documents={{ entities: new Map([["set", entity]]), views: new Map([form, table].map((v) => [v.id, v])) }}
        registry={mockRegistry}
        dataSources={new Map([["default", createMemoryAdapter()]])}
      />,
    );
    expect(screen.getByRole("region", { name: "training" })).toBeTruthy();
    idNamed.unmount();
    renderDashboard();
    expect(screen.getByRole("tablist", { name: "Training" })).toBeTruthy();
  });

  test("a failed count request shows an error instead of loading forever", async () => {
    const db = createMemoryAdapter();
    const failing: DataAdapter = { ...db, find: () => Promise.reject(new Error("The server responded with status 401.")) };
    render(
      <DashboardRenderer
        dashboard={dashboard}
        documents={{ entities: new Map([["set", entity]]), views: new Map([form, table].map((v) => [v.id, v])) }}
        registry={mockRegistry}
        dataSources={new Map([["default", failing]])}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load records: The server responded with status 401.");
    expect(alert.textContent).toContain("Retry, or reload the page."); // card 45d: one hint for every view
    expect(screen.queryByTestId("count")).toBeNull();
  });

  test("saving the form updates the count; the other tab shows the table", async () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText(/^Exercise/), { target: { value: "Squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("1"));
    fireEvent.change(screen.getByLabelText(/^Exercise/), { target: { value: "Bench" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText(/^Exercise/)).toHaveProperty("value", ""));
    expect(screen.getByTestId("count").textContent).toContain("1");

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const sets = await screen.findByRole("table", { name: "Sets" });
    await waitFor(() => expect(within(sets).getAllByRole("row")).toHaveLength(3));
    expect(document.querySelector<HTMLElement>('[data-yadad-grid="history"]')!.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  test("an in-place table edit refreshes the count widget beside it", async () => {
    // The form path already bumped the dashboard's reloadKey; a write made
    // inside a widget (here: an in-place edit) must bump it the same way,
    // or the count stays stale until the page reloads.
    const db = createMemoryAdapter();
    await db.create("set", { exercise: "Squat", warmup: true }, { entityRevision: 1 });
    const find = vi.fn(db.find.bind(db));
    const countCalls = (): number => find.mock.calls.filter(([, opts]) => (opts as { page?: { limit?: number } }).page?.limit === 0).length;
    const dash: DashboardView = {
      kind: "dashboard",
      specVersion: 0,
      id: "training",
      title: "Training",
      revision: 1,
      tabs: [
        {
          id: "edit",
          title: "Edit",
          items: [
            { id: "t", x: 0, y: 0, w: 8, h: 4, widget: "view", view: "sets_edit" },
            { id: "total", x: 8, y: 0, w: 4, h: 1, widget: "count", label: "Warmed up", view: "sets_edit", filter: { op: "eq", field: "warmup", value: true } },
          ],
        },
      ],
    };
    render(
      <DashboardRenderer
        dashboard={dash}
        documents={{ entities: new Map([["set", entity]]), views: new Map([[editableTable.id, editableTable]]) }}
        registry={mockRegistry}
        dataSources={new Map([["default", { ...db, find } satisfies DataAdapter]])}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("1"));
    expect(countCalls()).toBe(1); // loading the count is not itself a change to report

    const row = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(row()).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(row()).getByRole("checkbox", { name: "Warm-up" }));
    fireEvent.click(within(row()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("0"));
    expect(countCalls()).toBe(2); // the widget re-asked; it did not just re-render the old number
  });

  test("a record action run inside a table refreshes the count widget beside it", async () => {
    const db = createMemoryAdapter({ actions: { "set.stamp": () => ({ values: { warmup: true } }) } });
    await db.create("set", { exercise: "Squat", warmup: false }, { entityRevision: 1 });
    const stamped: EntityDocument = { ...entity, actions: [{ id: "stamp", label: "Stamp" }] };
    const actionTable: TableView = { ...table, id: "sets_actions", columns: [{ field: "exercise" }, { field: "warmup" }], recordActions: ["stamp"] };
    const dash: DashboardView = {
      kind: "dashboard",
      specVersion: 0,
      id: "training",
      title: "Training",
      revision: 1,
      tabs: [
        {
          id: "edit",
          title: "Edit",
          items: [
            { id: "t", x: 0, y: 0, w: 8, h: 4, widget: "view", view: "sets_actions" },
            { id: "total", x: 8, y: 0, w: 4, h: 1, widget: "count", label: "Warmed up", view: "sets_actions", filter: { op: "eq", field: "warmup", value: true } },
          ],
        },
      ],
    };
    render(
      <DashboardRenderer
        dashboard={dash}
        documents={{ entities: new Map([["set", stamped]]), views: new Map([[actionTable.id, actionTable]]) }}
        registry={mockRegistry}
        dataSources={new Map([["default", db]])}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("0"));
    fireEvent.click(document.querySelector("[data-testid='action-stamp']") as HTMLElement);
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("1"));
    expect((await db.find("set", {})).items[0]!.values["warmup"]).toBe(true); // the action really wrote
  });

  test("narrow screens stack the widgets full width, in reading order", () => {
    // jsdom has no layout: report a phone-sized width to every observer.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          this.callback([{ contentRect: { width: 390 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        disconnect() {}
      },
    );
    try {
      renderDashboard();
      const grid = document.querySelector<HTMLElement>('[data-yadad-grid="log"]')!;
      expect(grid.hasAttribute("data-yadad-grid-stacked")).toBe(true);
      expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
      const items = [...grid.querySelectorAll<HTMLElement>("[data-yadad-grid-item]")];
      expect(items.map((el) => el.dataset["yadadGridItem"])).toEqual(["form", "total"]);
      expect(items.map((el) => el.style.gridColumn)).toEqual(["1 / -1", "1 / -1"]);
      expect(grid.style.gridAutoRows).toBe("auto");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("DOM order follows reading order, not document order", () => {
    const swapped: DashboardView = { ...dashboard, tabs: [{ ...dashboard.tabs[0]!, items: [...dashboard.tabs[0]!.items].reverse() }] };
    renderDashboard(undefined, swapped);
    const ids = [...document.querySelectorAll<HTMLElement>("[data-yadad-grid-item]")].map((el) => el.dataset["yadadGridItem"]);
    expect(ids).toEqual(["form", "total"]);
  });

  test("reports widgets that point at missing or unsuitable views", () => {
    const nested: DashboardView = { ...dashboard, id: "nested", tabs: [{ id: "t", title: "T", items: [{ id: "x", x: 0, y: 0, w: 1, h: 1, widget: "view", view: "training" }] }] };
    const bad: DashboardView = {
      ...dashboard,
      tabs: [
        {
          id: "t",
          title: "T",
          items: [
            { id: "a", x: 0, y: 0, w: 1, h: 1, widget: "view", view: "nope" },
            { id: "b", x: 1, y: 0, w: 1, h: 1, widget: "count", label: "n", view: "log" },
            { id: "c", x: 2, y: 0, w: 1, h: 1, widget: "view", view: "nested" },
          ],
        },
      ],
    };
    renderDashboard([form, table, nested], bad);
    const summary = screen.getByTestId("error-summary").textContent;
    expect(summary).toContain('No view with id "nope"');
    expect(summary).toContain("A count widget needs a table view");
    expect(summary).toContain("dashboards cannot be nested");
  });
});

describe("stat widgets", () => {
  const sets: EntityDocument = {
    kind: "entity",
    specVersion: 2,
    id: "set",
    revision: 1,
    fields: [
      { id: "exercise", type: "text", label: "Exercise" },
      { id: "weight", type: "number", label: "Weight" },
      { id: "reps", type: "number", label: "Reps" },
      { id: "day", type: "date", label: "Day" },
    ],
  };
  const tbl: TableView = { kind: "table", specVersion: 2, id: "sets", entity: "set", revision: 1, dataSource: "default", columns: [{ field: "exercise" }] };
  const board = (items: DashboardView["tabs"][number]["items"]): DashboardView => ({ kind: "dashboard", specVersion: 2, id: "b", revision: 1, tabs: [{ id: "t", title: "T", items }] });
  const stat = (id: string, y: number, measure: Extract<DashboardView["tabs"][number]["items"][number], { widget: "stat" }>["measure"], extra: { filter?: Condition } = {}) =>
    ({ id, x: 0, y, w: 4, h: 1, widget: "stat" as const, label: id, view: "sets", measure, ...extra });

  async function show(d: DashboardView, db: DataAdapter) {
    render(
      <DashboardRenderer dashboard={d} documents={{ entities: new Map([["set", sets]]), views: new Map([["sets", tbl]]) }} registry={mockRegistry} dataSources={new Map([["default", db]])} />,
    );
  }
  const text = (id: string) => document.querySelector(`[data-yadad-grid-item="${id}"]`)!.textContent ?? "";

  test("shows each measure through the count component, formatted, with dashes for nothing", async () => {
    const db = createMemoryAdapter();
    await db.create("set", { exercise: "Squat", weight: 100, reps: 5, day: "2026-10-01" }, { entityRevision: 1 });
    await db.create("set", { exercise: "Squat", weight: 102.5, reps: 10, day: "2026-10-03" }, { entityRevision: 1 });
    await db.create("set", { exercise: "Bench", weight: 80, reps: 3, day: "2026-10-03" }, { entityRevision: 1 });
    await show(
      board([
        stat("volume", 0, { op: "sum", product: ["weight", "reps"] }),
        stat("avg", 1, { op: "avg", field: "weight" }),
        stat("days", 2, { op: "countDistinct", field: "day" }),
        stat("first", 3, { op: "min", field: "day" }),
        stat("squat_best", 4, { op: "max", field: "weight" }, { filter: { op: "eq", field: "exercise", value: "Squat" } }),
        stat("none", 5, { op: "avg", field: "weight" }, { filter: { op: "eq", field: "exercise", value: "Press" } }),
        stat("none_sum", 6, { op: "sum", field: "weight" }, { filter: { op: "eq", field: "exercise", value: "Press" } }),
      ]),
      db,
    );
    await waitFor(() => expect(text("volume")).toContain(NF(1765)));
    await waitFor(() => expect(text("avg")).toContain(NF(94.17)));
    expect(text("days")).toContain("2");
    expect(text("first")).toContain("2026-10-01");
    expect(text("squat_best")).toContain(NF(102.5));
    expect(text("none")).toContain("—");
    expect(text("none_sum")).toContain("0");
    expect(document.querySelector("[data-yadad-stat-partial]")).toBeNull();
  });

  test("shows a loading marker first, and an error when records cannot be loaded", async () => {
    const db = createMemoryAdapter();
    const failing: DataAdapter = { ...db, find: () => Promise.reject(new Error("boom")) };
    await show(board([stat("volume", 0, { op: "sum", field: "weight" })]), failing);
    expect(text("volume")).toContain("…");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("boom");
    expect(screen.queryByTestId("count")).toBeNull();
  });

  test("says so when only the first 5000 records were read", async () => {
    const db = createMemoryAdapter();
    const many = Array.from({ length: 5001 }, () => ({ weight: 1 }));
    await db.batch("set", { create: many }, { entityRevision: 1 });
    await show(board([stat("total", 0, { op: "sum", field: "weight" })]), db);
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain(NF(5000));
    expect(note.textContent).toContain(NF(5001));
    expect(text("total")).toContain(NF(5000));
  });

  test("a stat with an unknown measure field is reported, not rendered", () => {
    const db = createMemoryAdapter();
    render(
      <DashboardRenderer
        dashboard={board([stat("bad", 0, { op: "sum", field: "ghost" })])}
        documents={{ entities: new Map([["set", sets]]), views: new Map([["sets", tbl]]) }}
        registry={mockRegistry}
        dataSources={new Map([["default", db]])}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain('Field "ghost" does not exist');
  });
});

const NF = (n: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);

// RFC 0001 slice 2 (card 43f): the series widget reaches widgets.series with computed groups and drawn labels.
describe("series widgets", () => {
  const exercise: EntityDocument = {
    kind: "entity",
    specVersion: 7,
    id: "exercise",
    revision: 1,
    fields: [{ id: "name", type: "text", label: "Name" }],
  };
  const sets: EntityDocument = {
    kind: "entity",
    specVersion: 7,
    id: "set",
    revision: 1,
    fields: [
      { id: "exercise", type: "reference", label: "Exercise", entity: "exercise" },
      { id: "modality", type: "select", label: "Modality", options: { source: "static", values: ["strength", "cardio"] } },
      { id: "warmup", type: "boolean", label: "Warm-up" },
      { id: "note", type: "text", label: "Note" },
      { id: "day", type: "date", label: "Day" },
      { id: "weight", type: "number", label: "Weight" },
    ],
  };
  const tbl: TableView = { kind: "table", specVersion: 7, id: "sets", entity: "set", revision: 1, dataSource: "default", columns: [{ field: "note" }] };
  const board = (items: DashboardView["tabs"][number]["items"]): DashboardView => ({ kind: "dashboard", specVersion: 7, id: "b", revision: 1, tabs: [{ id: "t", title: "T", items }] });

  type SeriesSpy = (props: SeriesWidgetProps) => ReactNode;
  function seriesRegistry(): { registry: Registry<ReactNode>; calls: () => SeriesWidgetProps[] } {
    const calls: SeriesWidgetProps[] = [];
    const Series: SeriesSpy = (props) => {
      calls.push(props);
      return (
        <div data-testid="series">
          <span>{props.label}</span>
          <span data-testid="series-measure">{props.measureLabel}</span>
          <span data-testid="series-skipped">{props.skipped}</span>
          {props.partial ? <small data-testid="series-partial">{`${props.partial.read}/${props.partial.total}`}</small> : null}
          {props.groups.map((g) => (
            <span key={g.key} data-testid="series-group">
              {g.key}|{g.label}|{g.text}
            </span>
          ))}
        </div>
      );
    };
    return { registry: { ...mockRegistry, widgets: { ...mockRegistry.widgets, series: Series } }, calls: () => calls };
  }

  async function seedSets(): Promise<ReturnType<typeof createMemoryAdapter>> {
    const db = createMemoryAdapter();
    await db.create("exercise", { name: "Squat" }, { entityRevision: 1 });
    await db.create("exercise", { name: "Bench" }, { entityRevision: 1 });
    await db.create("set", { exercise: "1", modality: "strength", warmup: false, note: "fast", day: "2026-10-05", weight: 100 }, { entityRevision: 1 });
    await db.create("set", { exercise: "2", modality: "strength", warmup: true, note: "fast", day: "2026-10-05", weight: 60 }, { entityRevision: 1 });
    await db.create("set", { exercise: "1", modality: "cardio", note: "slow", day: "2026-10-07", weight: 0 }, { entityRevision: 1 });
    return db;
  }

  function show(d: DashboardView, db: DataAdapter, registry: Registry<ReactNode>, entities?: ReadonlyMap<string, EntityDocument>) {
    render(
      <DashboardRenderer
        dashboard={d}
        documents={{ entities: entities ?? new Map([["set", sets], ["exercise", exercise]]), views: new Map([[tbl.id, tbl]]) }}
        registry={registry}
        dataSources={new Map([["default", db]])}
      />,
    );
  }
  const groupTexts = (): string[] => [...document.querySelectorAll("[data-testid='series-group']")].map((el) => el.textContent ?? "");

  const series = (id: string, groupBy: { field: string; bucket?: "day" | "week" | "month" }, extra: Partial<Extract<DashboardView["tabs"][number]["items"][number], { widget: "series" }>> = {}): DashboardView["tabs"][number]["items"][number] => ({
    id,
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    widget: "series" as const,
    label: `Series ${id}`,
    view: "sets",
    groupBy,
    measure: { op: "count" as const },
    display: "bar" as const,
    ...extra,
  });

  test("a registry with no widgets.series gets an error summary naming the key", async () => {
    const db = await seedSets();
    const { series: _series, ...widgets } = mockRegistry.widgets;
    show(board([series("s", { field: "modality" })]), db, { ...mockRegistry, widgets });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This registry has no widgets.series component, so the series widget s cannot be drawn.");
    expect(alert.querySelector("[data-path='/widgets/series'][data-code='required']")).toBeTruthy();
  });

  test("select and text groups keep the raw value as the label; measureLabel names the measure", async () => {
    const db = await seedSets();
    const { registry, calls } = seriesRegistry();
    show(board([series("by_modality", { field: "modality" }, { measure: { op: "sum", field: "weight" } })]), db, registry);
    await waitFor(() => expect(groupTexts()).toHaveLength(2));
    expect(groupTexts()).toEqual(["cardio|cardio|0", "strength|strength|160"]);
    expect(document.querySelector("[data-testid='series-measure']")!.textContent).toBe("Sum of weight");
    expect(calls().at(-1)!.display).toBe("bar");
    expect(calls().at(-1)!.loading).toBe(false);
  });

  test("a min measure arrives with both the prose label and the machine aggregation (card 45g)", async () => {
    const db = await seedSets();
    const { registry, calls } = seriesRegistry();
    show(board([series("min_weight", { field: "modality" }, { measure: { op: "min", field: "weight" } })]), db, registry);
    await waitFor(() => expect(groupTexts()).toHaveLength(2));
    const props = calls().at(-1)!;
    expect(props.measureLabel).toBe("Minimum weight");
    expect(props.aggregation).toBe("min"); // components branch on this, never on the label's first word
  });

  test("boolean groups label Yes/No", async () => {
    const db = await seedSets();
    const { registry } = seriesRegistry();
    show(board([series("by_warmup", { field: "warmup" })]), db, registry);
    await waitFor(() => expect(groupTexts()).toHaveLength(2));
    expect(groupTexts()).toEqual(["false|No|1", "true|Yes|1"]); // the third row has no warmup at all: skipped, not a group
  });

  test("reference groups label through the references hook; an unwired target warns (39b)", async () => {
    const db = await seedSets();
    const { registry } = seriesRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    show(board([series("by_exercise", { field: "exercise" })]), db, registry, new Map([["set", sets]]));
    await waitFor(() => expect(groupTexts()).toHaveLength(2));
    expect(groupTexts()).toEqual(["1|1|2", "2|2|1"]); // target entity never wired: the hook says the raw id and warns
    expect(warn.mock.calls.some((c) => String(c[0]).includes('points at entity "exercise"'))).toBe(true);
    warn.mockRestore();
  });

  test("reference groups show the target's display value when wired", async () => {
    const db = await seedSets();
    const { registry } = seriesRegistry();
    show(board([series("by_exercise", { field: "exercise" })]), db, registry);
    await waitFor(() => expect(groupTexts().some((t) => t.includes("Squat|"))).toBe(true));
  });

  test("date groups format with the viewer's locale: day, week, month", async () => {
    const db = await seedSets();
    const { registry } = seriesRegistry();
    const dayDash = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeZone: "UTC" }).format(new Date("2026-10-05T00:00:00Z"));
    show(board([series("by_day", { field: "day" }, { sort: { by: "group", dir: "asc" } })]), db, registry);
    await waitFor(() => expect(groupTexts().length).toBeGreaterThanOrEqual(2));
    expect(groupTexts()[0]).toBe(`2026-10-05|${dayDash}|2`);
  });

  test("week buckets label 'Week of <date>' and month buckets '<Month YYYY>'", async () => {
    const db = await seedSets();
    const { registry } = seriesRegistry();
    const weekLabel = `Week of ${new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeZone: "UTC" }).format(new Date("2026-10-05T00:00:00Z"))}`;
    show(board([series("by_week", { field: "day", bucket: "week" })]), db, registry);
    await waitFor(() => expect(groupTexts()).toHaveLength(1));
    expect(groupTexts()[0]).toBe("2026-10-05|" + weekLabel + "|3");

    const { registry: monthReg } = seriesRegistry();
    cleanup();
    show(board([series("by_month", { field: "day", bucket: "month" })]), db, monthReg);
    await waitFor(() => expect(groupTexts()).toHaveLength(1));
    expect(groupTexts()[0]).toBe("2026-10|October 2026|3");
  });

  test("a gap bucket draws a dash for avg and 0 for count", async () => {
    const db = createMemoryAdapter();
    await db.create("set", { day: "2026-10-01", weight: 10 }, { entityRevision: 1 });
    await db.create("set", { day: "2026-10-03", weight: 30 }, { entityRevision: 1 });
    const { registry } = seriesRegistry();
    show(board([series("gap_avg", { field: "day" }, { measure: { op: "avg", field: "weight" } })]), db, registry);
    await waitFor(() => expect(groupTexts()).toHaveLength(3));
    expect(groupTexts()).toEqual(["2026-10-01|" + new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeZone: "UTC" }).format(new Date("2026-10-01T00:00:00Z")) + "|10", "2026-10-02|" + new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeZone: "UTC" }).format(new Date("2026-10-02T00:00:00Z")) + "|—", "2026-10-03|" + new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeZone: "UTC" }).format(new Date("2026-10-03T00:00:00Z")) + "|30"]);
  });

  test("skipped records are counted and passed through", async () => {
    const db = await seedSets();
    await db.create("set", { note: "groupless" }, { entityRevision: 1 });
    const { registry } = seriesRegistry();
    show(board([series("by_modality", { field: "modality" })]), db, registry);
    await waitFor(() => expect(document.querySelector("[data-testid='series-skipped']")!.textContent).toBe("1"));
  });

  test("past the ceiling the partial note reaches the component", async () => {
    const db = createMemoryAdapter();
    await db.batch("set", { create: Array.from({ length: 5001 }, (_, i) => ({ modality: i % 2 === 0 ? "strength" : "cardio" })) }, { entityRevision: 1 });
    const { registry } = seriesRegistry();
    show(board([series("by_modality", { field: "modality" })]), db, registry);
    const note = await screen.findByTestId("series-partial");
    expect(note.textContent).toBe("5000/5001"); // the contract hands raw numbers; the component formats
  });

  test("a reload refetches the series", async () => {
    const db = await seedSets();
    const { registry } = seriesRegistry();
    const find = vi.fn(db.find.bind(db));
    const dash: DashboardView = {
      kind: "dashboard",
      specVersion: 7,
      id: "b",
      revision: 1,
      tabs: [
        {
          id: "t",
          title: "T",
          items: [
            { id: "tbl", x: 0, y: 0, w: 6, h: 4, widget: "view", view: "sets" },
            series("by_note", { field: "note" }),
          ],
        },
      ],
    };
    const editable: TableView = { ...tbl, columns: [{ field: "note", editable: true }] };
    render(
      <DashboardRenderer
        dashboard={dash}
        documents={{ entities: new Map([["set", sets], ["exercise", exercise]]), views: new Map([[tbl.id, editable]]) }}
        registry={registry}
        dataSources={new Map([["default", { ...db, find } satisfies DataAdapter]])}
      />,
    );
    await waitFor(() => expect(groupTexts()).toEqual(["fast|fast|2", "slow|slow|1"]));
    const callsBefore = find.mock.calls.length;

    const row = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(row()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(row()).getByRole("textbox", { name: "Note" }), { target: { value: "slow" } });
    fireEvent.click(within(row()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(groupTexts()).toEqual(["fast|fast|1", "slow|slow|2"]));
    expect(find.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  test("a series whose view, measure or groupBy field is broken is reported, not rendered", async () => {
    const db = await seedSets();
    const { registry } = seriesRegistry();
    show(board([series("bad_measure", { field: "modality" }, { measure: { op: "sum", field: "ghost" } as never })]), db, registry);
    const alert1 = await screen.findByRole("alert");
    expect(alert1.textContent).toContain('Field "ghost" does not exist');
    cleanup();
    show(board([series("bad_group", { field: "ghost" })]), db, registry);
    const alert2 = await screen.findByRole("alert");
    expect(alert2.textContent).toContain('Field "ghost" does not exist');
  });
});
