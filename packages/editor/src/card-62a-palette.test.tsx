// @vitest-environment jsdom
// Card 62a defect A (RED): two table views sharing a title collide in the widget picker —
// duplicate option labels, duplicate React keys, and the second view is unselectable.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DashboardView, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("DashboardLayoutEditor palette label collisions (card 62a)", () => {
  afterEach(cleanup);
  const dashboard: DashboardView = { kind: "dashboard", specVersion: 0, id: "home", revision: 1, tabs: [{ id: "main", title: "Main", items: [] }] };
  const t1: TableView = { kind: "table", specVersion: 0, id: "tasks", title: "Tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }] };
  const t2: TableView = { kind: "table", specVersion: 0, id: "archive", title: "Tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }] };

  function setup() {
    const saved: DashboardView[] = [];
    render(<DashboardLayoutEditor dashboard={dashboard} registry={mockRegistry} onSave={(d) => saved.push(d)} onCancel={() => {}} views={[t1, t2]} describeView={(id) => `Table: ${(id === "tasks" ? t1 : t2).title}`} />);
    return saved;
  }

  test("palette options are unique when two views share a title", () => {
    setup();
    const opts = (screen.getByLabelText("Widget to add") as HTMLSelectElement).options;
    const labels = [...opts].map((o) => o.textContent);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("the second same-titled view is selectable and adds the right widget", () => {
    const saved = setup();
    const picker = screen.getByLabelText("Widget to add") as HTMLSelectElement;
    const labels = [...picker.options].map((o) => o.textContent || "");
    const viewLabel = labels.find((l) => /archive/.test(l) && !/^(Count|Stat|Series) of /.test(l));
    expect(viewLabel).toMatch(/archive/); // disambiguated, not a duplicate
    fireEvent.change(picker, { target: { value: viewLabel } });
    press("Add to Main");
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items?.[0]).toMatchObject({ widget: "view", view: "archive" });
  });
});
