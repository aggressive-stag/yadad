// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DashboardView, EntityDocument, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";

afterEach(cleanup);

// Grid item ids are unique per tab, so two tabs may both use "total".
const task: EntityDocument = { kind: "entity", specVersion: 0, id: "task", revision: 1, fields: [{ id: "title", type: "text", label: "Title" }] };
const tasks: TableView = { kind: "table", specVersion: 0, id: "tasks", title: "Tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }] };
const dashboard: DashboardView = {
  kind: "dashboard",
  specVersion: 0,
  id: "home",
  revision: 1,
  tabs: [
    { id: "one", title: "One", items: [{ id: "total", x: 0, y: 0, w: 3, h: 2, widget: "count", label: "First", view: "tasks" }] },
    { id: "two", title: "Two", items: [{ id: "total", x: 0, y: 0, w: 3, h: 2, widget: "count", label: "Second", view: "tasks", filter: { op: "eq", field: "title", value: "x" } }] },
  ],
};

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("DashboardLayoutEditor with the same grid item id in several tabs", () => {
  function setup() {
    const saved: DashboardView[] = [];
    render(<DashboardLayoutEditor dashboard={dashboard} registry={mockRegistry} onSave={(d) => saved.push(d)} onCancel={() => {}} views={[tasks]} entities={new Map([["task", task]])} />);
    return saved;
  }

  test("an open count filter stays on its own tab", () => {
    setup();
    press("Filter the count of Count: First");
    expect(document.querySelector("[data-yadad-count-filter-builder]")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(document.querySelector("[data-yadad-count-filter-builder]")).toBeNull();
  });

  test("moving and removing a widget changes only the tab it is on", () => {
    const saved = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    const card = screen.getByRole("group", { name: /^Count: Second/ });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    press("Save layout");
    expect(saved[0]?.tabs.map((t) => t.items.map((i) => [i.id, i.x]))).toEqual([[["total", 0]], [["total", 1]]]);
  });

  test("removing a widget on one tab leaves the same id on the other", () => {
    const saved = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    fireEvent.keyDown(screen.getByRole("group", { name: /^Count: Second/ }), { key: "Delete" });
    press("Save layout");
    expect(saved[0]?.tabs.map((t) => t.items.length)).toEqual([1, 0]);
  });
});
