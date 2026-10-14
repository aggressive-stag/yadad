// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DashboardView, EntityDocument, FormView, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardRenderer } from "./dashboard-renderer.js";

afterEach(cleanup);

// Two tabs that reuse the grid item id "main" for different views.
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "note",
  revision: 1,
  fields: [{ id: "title", type: "text", label: "Title" }],
};
const formA: FormView = { kind: "form", specVersion: 0, id: "form_a", entity: "note", revision: 1, dataSource: "default", sections: [{ id: "s", title: "Form A", items: [{ field: "title" }] }] };
const formB: FormView = { kind: "form", specVersion: 0, id: "form_b", entity: "note", revision: 1, dataSource: "default", sections: [{ id: "s", title: "Form B", items: [{ field: "title" }] }] };
const table: TableView = { kind: "table", specVersion: 0, id: "notes", title: "Notes", entity: "note", revision: 1, dataSource: "default", columns: [{ field: "title" }] };
const dashboard: DashboardView = {
  kind: "dashboard",
  specVersion: 0,
  id: "home",
  revision: 1,
  tabs: [
    { id: "one", title: "One", items: [{ id: "main", x: 0, y: 0, w: 6, h: 1, widget: "view", view: "form_a" }] },
    { id: "two", title: "Two", items: [{ id: "main", x: 0, y: 0, w: 6, h: 1, widget: "view", view: "form_b" }] },
    { id: "three", title: "Three", items: [{ id: "main", x: 0, y: 0, w: 6, h: 1, widget: "view", view: "notes" }] },
  ],
};

describe("DashboardRenderer with the same grid item id in several tabs", () => {
  test("renders each tab's own widget and does not carry form input from one tab to the next", () => {
    render(
      <DashboardRenderer
        dashboard={dashboard}
        documents={{ entities: new Map([["note", entity]]), views: new Map([formA, formB, table].map((v) => [v.id, v])) }}
        registry={mockRegistry}
        dataSources={new Map([["default", createMemoryAdapter()]])}
      />,
    );
    expect(document.querySelectorAll('[data-yadad-grid-item="main"]')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "typed in tab one" } });
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("Form B")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: "Three" }));
    expect(screen.getByRole("table")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "One" }));
    expect(screen.getByText("Form A")).toBeTruthy();
  });
});
