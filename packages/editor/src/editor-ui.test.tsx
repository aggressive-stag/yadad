// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DashboardView, EntityDocument, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor";
import { EntityFieldsEditor } from "./entity-fields-editor";

afterEach(cleanup);

describe("DashboardLayoutEditor", () => {
  const dashboard: DashboardView = {
    kind: "dashboard",
    specVersion: 0,
    id: "d",
    title: "Training",
    revision: 2,
    tabs: [
      {
        id: "log",
        title: "Log",
        items: [
          { id: "form", x: 0, y: 0, w: 8, h: 4, widget: "view", view: "log_set" },
          { id: "count", x: 8, y: 0, w: 4, h: 2, widget: "count", label: "Sets", view: "sets" },
        ],
      },
    ],
  };

  function setup() {
    const saved: DashboardView[] = [];
    render(<DashboardLayoutEditor dashboard={dashboard} registry={mockRegistry} onSave={(d) => saved.push(d)} onCancel={() => {}} describeView={(id) => `View: ${id}`} />);
    const card = () => screen.getByRole("group", { name: /^Count: Sets/ });
    const status = () => document.querySelector("[data-yadad-editor-status]")?.textContent;
    return { saved, card, status };
  }

  test("arrow keys move the focused card; Shift resizes it", () => {
    const { card, status } = setup();
    fireEvent.keyDown(card(), { key: "ArrowDown" });
    expect(status()).toBe("Count: Sets is now at column 9, row 2, 4 wide, 2 tall.");
    fireEvent.keyDown(card(), { key: "ArrowDown", shiftKey: true });
    expect(card().getAttribute("aria-label")).toBe("Count: Sets, column 9, row 2, 4 wide, 3 tall");
    fireEvent.keyDown(card(), { key: "ArrowRight" });
    expect(card().getAttribute("aria-label")).toContain("column 9"); // already at the right edge
  });

  test("an overlapping move is refused and announced", () => {
    const { card, status } = setup();
    fireEvent.keyDown(card(), { key: "ArrowLeft" });
    expect(status()).toBe("Not moved: Grid item 1 overlaps item 0.");
    expect(card().getAttribute("aria-label")).toContain("column 9, row 1");
  });

  test("undo, then save the edited layout with a new revision", () => {
    const { card, saved } = setup();
    const save = () => screen.getByRole("button", { name: "Save layout" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.keyDown(card(), { key: "ArrowDown" });
    fireEvent.keyDown(card(), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(save());
    expect(saved).toHaveLength(1);
    expect(saved[0]?.revision).toBe(3);
    expect(saved[0]?.tabs[0]?.items[1]).toMatchObject({ x: 8, y: 1 });
  });
});

describe("EntityFieldsEditor", () => {
  const entity: EntityDocument = {
    kind: "entity",
    specVersion: 0,
    id: "set",
    revision: 1,
    fields: [
      { id: "day", type: "date", label: "Day", required: true },
      { id: "spare", type: "text", label: "Spare" },
    ],
  };
  const table: TableView = { kind: "table", specVersion: 0, id: "sets", entity: "set", revision: 1, dataSource: "default", columns: [{ field: "day" }] };

  function setup() {
    const saved: EntityDocument[] = [];
    render(<EntityFieldsEditor entity={entity} views={[table]} registry={mockRegistry} onSave={(e) => saved.push(e)} onCancel={() => {}} />);
    const panel = () => screen.getByRole("group", { name: /Add a field|Edit "/ });
    return { saved, panel };
  }

  test("adds a number field with options", () => {
    const { saved, panel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "New field" }));
    fireEvent.change(within(panel()).getByLabelText(/^Field type/), { target: { value: "Number" } });
    fireEvent.change(within(panel()).getByLabelText(/^Id/), { target: { value: "weight" } });
    fireEvent.change(within(panel()).getByLabelText(/^Label/), { target: { value: "Weight" } });
    fireEvent.change(within(panel()).getByLabelText("Step (e.g. 2.5)"), { target: { value: "2.5" } });
    fireEvent.change(within(panel()).getByLabelText("Unit (e.g. kg)"), { target: { value: "kg" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Add field" }));
    expect(screen.getByRole("table", { name: "Fields of set" }).textContent).toContain("Weight");
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(saved[0]?.revision).toBe(2);
    expect(saved[0]?.fields.at(-1)).toEqual({ id: "weight", type: "number", label: "Weight", step: 2.5, unit: "kg" });
  });

  test("invalid fields are refused with the reason", () => {
    const { panel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "New field" }));
    fireEvent.change(within(panel()).getByLabelText(/^Id/), { target: { value: "Bad Id" } });
    fireEvent.change(within(panel()).getByLabelText(/^Label/), { target: { value: "Bad" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Add field" }));
    expect(screen.getByTestId("error-summary").textContent).toContain('"Bad Id" is not a valid id.');
    expect(panel()).toBeTruthy(); // stays open to fix
  });

  test("edits a label; refuses to remove a field in use; removes an unused one", () => {
    const { saved } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit Spare" }));
    expect(screen.queryByLabelText(/^Id/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "Spare notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Day" }));
    expect(screen.getByTestId("error-summary").textContent).toContain('"day" is still used by: sets/columns/0');
    fireEvent.click(screen.getByRole("button", { name: "Remove Spare notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(saved[0]?.fields.map((f) => f.id)).toEqual(["day"]);
  });
});
