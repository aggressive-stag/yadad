// @vitest-environment jsdom
import type { DashboardView, EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardRenderer } from "./dashboard-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "row",
  revision: 1,
  fields: [
    { id: "n", type: "number", label: "N" },
    { id: "tag", type: "text", label: "Tag" },
  ],
};

const table = (extra: Partial<TableView> = {}): TableView => ({
  kind: "table",
  specVersion: 1,
  id: "rows",
  entity: "row",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "n" }, { field: "tag" }],
  pageSize: 2,
  quickFilters: [{ field: "tag" }],
  ...extra,
});

async function seeded(count: number, paging?: "cursor"): Promise<ReturnType<typeof createMemoryAdapter>> {
  const db = createMemoryAdapter(paging === undefined ? {} : { paging });
  for (let i = 1; i <= count; i++) {
    await db.create("row", { n: i, tag: i % 2 === 0 ? "even" : "odd" }, { entityRevision: 1 });
  }
  return db;
}

const ns = () => screen.getAllByRole("row").slice(1).map((r) => r.querySelectorAll("[data-testid='display-n']")[0]?.textContent);
const pager = () => document.querySelector("[data-yadad-pager]")!;
const pageLabel = () => pager().querySelector("span")?.textContent;
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const label = (text: string) => screen.getByLabelText(text) as HTMLInputElement;

describe("cursor pager (a server with no total)", () => {
  test("pages forward to the end and back with only Page N — no of N", async () => {
    const db = await seeded(5, "cursor");
    render(<TableRenderer entity={entity} view={table()} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(ns()).toEqual(["1", "2"]));
    expect(pageLabel()).toBe("Page 1"); // no "of N"
    press("Next");
    await waitFor(() => expect(ns()).toEqual(["3", "4"]));
    expect(pageLabel()).toBe("Page 2");
    press("Next");
    await waitFor(() => expect(ns()).toEqual(["5"]));
    // last page: next is null, Next is disabled
    await waitFor(() => expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true));
    press("Previous"); // back through the saved cursors
    await waitFor(() => expect(ns()).toEqual(["3", "4"]));
    press("Previous");
    await waitFor(() => expect(ns()).toEqual(["1", "2"]));
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("sorting resets the cursor stack back to page 1", async () => {
    const db = await seeded(5, "cursor");
    render(<TableRenderer entity={entity} view={table()} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(ns()).toEqual(["1", "2"]));
    press("Next");
    await waitFor(() => expect(ns()).toEqual(["3", "4"]));
    fireEvent.click(screen.getByRole("button", { name: "N" })); // sort by N
    await waitFor(() => expect(ns()).toEqual(["1", "2"]));
    expect(pageLabel()).toBe("Page 1");
  });

  test("a quick filter resets the stack too, and the walked count is the filtered one", async () => {
    const db = await seeded(5, "cursor");
    render(<TableRenderer entity={entity} view={table({ pageSize: 4 })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(ns()).toEqual(["1", "2", "3", "4"]));
    press("Next");
    await waitFor(() => expect(ns()).toEqual(["5"]));
    fireEvent.change(label("Tag"), { target: { value: "even" } });
    await waitFor(() => expect(ns()).toEqual(["2", "4"])); // back at the start of the new question
    expect(pager() === null || pager().textContent === "Page 1").toBe(true);
  });

  test("a last page that answers neither total nor next shows no pager", async () => {
    // Cursor mode, final page: next is null and there is no total — the client treats the page as the last (RFC 0007).
    const db = await seeded(3, "cursor");
    render(<TableRenderer entity={entity} view={table({ pageSize: 5 })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(ns()).toEqual(["1", "2", "3"]));
    expect(pager()).toBeNull(); // no next, and one page read: no pager at all
  });
});

describe("count widget without a total", () => {
  const dashboard: DashboardView = {
    kind: "dashboard",
    specVersion: 1,
    id: "d",
    revision: 1,
    tabs: [{ id: "t", title: "T", items: [{ id: "c", x: 0, y: 0, w: 4, h: 1, widget: "count", label: "Rows", view: "rows" }] }],
  };
  const tableOnly: TableView = { kind: "table", specVersion: 1, id: "rows", entity: "row", revision: 1, dataSource: "default", columns: [{ field: "n" }] };

  function renderCount(db: ReturnType<typeof createMemoryAdapter>) {
    render(
      <DashboardRenderer
        dashboard={dashboard}
        documents={{ entities: new Map([["row", entity]]), views: new Map([["rows", tableOnly]]) }}
        registry={mockRegistry}
        dataSources={new Map([["default", db]])}
      />,
    );
  }

  test("walks the pages and shows the number read", async () => {
    const db = await seeded(12, "cursor");
    renderCount(db);
    await waitFor(() => expect(screen.getByTestId("count").textContent).toContain("12"));
  });

  test("shows 5000+ at the cap", async () => {
    const db = await seeded(5001, "cursor");
    renderCount(db);
    await waitFor(() => expect(screen.getByTestId("count").textContent).toMatch(/5\D?000\+/));
  }, 30_000);
});
