// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DashboardView, EntityDocument, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";
import { EntityFieldsEditor } from "./entity-fields-editor.js";

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
    expect(status()).toBe('Not moved: "count" would overlap "form".');
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

  const actionPanel = () => screen.getByRole("group", { name: /Add an action|Edit action "/ });

  test("adds an action with a confirm; the row appears and saving keeps it", () => {
    const { saved } = setup();
    fireEvent.click(screen.getByRole("button", { name: "New action" }));
    fireEvent.change(within(actionPanel()).getByLabelText(/^Id/), { target: { value: "ship" } });
    fireEvent.change(within(actionPanel()).getByLabelText(/^Label/), { target: { value: "Ship" } });
    fireEvent.change(within(actionPanel()).getByLabelText(/Confirm message/), { target: { value: "This marks the task shipped." } });
    fireEvent.change(within(actionPanel()).getByLabelText(/Confirm tone/), { target: { value: "Danger" } });
    fireEvent.click(within(actionPanel()).getByRole("button", { name: "Add action" }));
    const table = screen.getByRole("table", { name: "Actions of set" });
    expect(table.textContent).toContain("Ship");
    expect(table.textContent).toContain("Danger: This marks the task shipped.");
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(saved[0]?.actions).toEqual([{ id: "ship", label: "Ship", confirm: { message: "This marks the task shipped.", tone: "danger" } }]);
  });

  test("an action without a confirm message runs on press", () => {
    const { saved } = setup();
    fireEvent.click(screen.getByRole("button", { name: "New action" }));
    fireEvent.change(within(actionPanel()).getByLabelText(/^Id/), { target: { value: "retry" } });
    fireEvent.change(within(actionPanel()).getByLabelText(/^Label/), { target: { value: "Retry" } });
    fireEvent.click(within(actionPanel()).getByRole("button", { name: "Add action" }));
    expect(screen.getByRole("table", { name: "Actions of set" }).textContent).toContain("Runs on press");
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(saved[0]?.actions).toEqual([{ id: "retry", label: "Retry" }]);
  });

  test("a duplicate action id is refused with the reason and the panel stays open", () => {
    const { saved } = setup();
    fireEvent.click(screen.getByRole("button", { name: "New action" }));
    fireEvent.change(within(actionPanel()).getByLabelText(/^Id/), { target: { value: "ship" } });
    fireEvent.change(within(actionPanel()).getByLabelText(/^Label/), { target: { value: "Ship" } });
    fireEvent.click(within(actionPanel()).getByRole("button", { name: "Add action" }));
    fireEvent.click(screen.getByRole("button", { name: "New action" }));
    fireEvent.change(within(actionPanel()).getByLabelText(/^Id/), { target: { value: "ship" } });
    fireEvent.change(within(actionPanel()).getByLabelText(/^Label/), { target: { value: "Ship again" } });
    fireEvent.click(within(actionPanel()).getByRole("button", { name: "Add action" }));
    expect(screen.getByTestId("error-summary").textContent).toContain('An action "ship" already exists on "set".');
    expect(actionPanel()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(saved[0]?.actions?.map((a) => a.id)).toEqual(["ship"]);
  });

  test("an action id is fixed after creation; the label and confirm stay editable", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "New action" }));
    fireEvent.change(within(actionPanel()).getByLabelText(/^Id/), { target: { value: "ship" } });
    fireEvent.change(within(actionPanel()).getByLabelText(/^Label/), { target: { value: "Ship" } });
    fireEvent.click(within(actionPanel()).getByRole("button", { name: "Add action" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Ship" }));
    expect(within(actionPanel()).queryByLabelText(/^Id/)).toBeNull();
    expect(actionPanel().textContent).toContain("Id: ship");
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "Publish" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(screen.getByRole("table", { name: "Actions of set" }).textContent).toContain("Publish");
  });

  test("reordering an action keeps its id and disables the move at each end", () => {
    setup();
    for (const [id, label] of [["ship", "Ship"], ["drop", "Drop"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: "New action" }));
      fireEvent.change(within(actionPanel()).getByLabelText(/^Id/), { target: { value: id } });
      fireEvent.change(within(actionPanel()).getByLabelText(/^Label/), { target: { value: label } });
      fireEvent.click(within(actionPanel()).getByRole("button", { name: "Add action" }));
    }
    const table = () => screen.getByRole("table", { name: "Actions of set" });
    expect(table().textContent?.indexOf("Ship")).toBeLessThan(table().textContent!.indexOf("Drop"));
    expect(screen.getByRole("button", { name: "Move Ship up" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move Drop up" }));
    expect(table().textContent?.indexOf("Drop")).toBeLessThan(table().textContent!.indexOf("Ship"));
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
  });

  test("removal is refused while a view offers the action", () => {
    cleanup();
    const savedWithOffer: EntityDocument[] = [];
    const offering: TableView = { ...table, recordActions: ["ship"] };
    render(<EntityFieldsEditor entity={{ ...entity, actions: [{ id: "ship", label: "Ship" }] }} views={[offering]} registry={mockRegistry} onSave={(e) => savedWithOffer.push(e)} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ship" }));
    expect(screen.getByTestId("error-summary").textContent).toContain('"ship" is still offered by: sets/recordActions/0');
    fireEvent.click(screen.getByRole("button", { name: "Remove Ship" }));
    expect(screen.getByTestId("error-summary").textContent).toContain("still offered");
    expect(screen.getByRole("table", { name: "Actions of set" }).textContent).toContain("Ship");
    expect(savedWithOffer).toEqual([]);
  });

  test("undo reverts an action add and redo re-applies it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "New action" }));
    fireEvent.change(within(actionPanel()).getByLabelText(/^Id/), { target: { value: "ship" } });
    fireEvent.change(within(actionPanel()).getByLabelText(/^Label/), { target: { value: "Ship" } });
    fireEvent.click(within(actionPanel()).getByRole("button", { name: "Add action" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("table", { name: "Actions of set" }).textContent).toContain("No actions yet");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByRole("table", { name: "Actions of set" }).textContent).toContain("Ship");
  });
});

describe("EntityFieldsEditor reference fields", () => {
  const exercise: EntityDocument = { kind: "entity", specVersion: 2, id: "exercise", revision: 1, fields: [{ id: "name", type: "text", label: "Name" }] };
  const entry: EntityDocument = { kind: "entity", specVersion: 2, id: "set_entry", revision: 1, fields: [{ id: "reps", type: "number", label: "Reps" }] };

  test("adds a reference field by picking the target entity and display field", () => {
    const saved: EntityDocument[] = [];
    render(<EntityFieldsEditor entity={entry} views={[]} entities={[exercise]} registry={mockRegistry} onSave={(e) => saved.push(e)} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New field" }));
    fireEvent.change(screen.getByLabelText(/Field type/), { target: { value: "Link to another record" } });
    fireEvent.change(screen.getByLabelText(/Id \(letters/), { target: { value: "lift" } });
    fireEvent.change(screen.getByLabelText("Label", { exact: false }), { target: { value: "Lift" } });
    fireEvent.change(screen.getByLabelText(/Target entity/), { target: { value: "exercise" } });
    fireEvent.change(screen.getByLabelText(/Display field/), { target: { value: "name" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(saved[0]?.fields.at(-1)).toEqual({ id: "lift", type: "reference", label: "Lift", entity: "exercise", display: "name" });
  });
});
