// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DashboardView, EntityDocument, FormView, TableView, ViewDocument } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
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
