// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CalendarView, EntityDocument, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { CalendarViewEditor } from "./calendar-view-editor.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "booking",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "done"] } },
    { id: "when", type: "date", label: "When" },
    { id: "notes", type: "text", label: "Notes" },
    { id: "owner", type: "text", label: "Owner" },
  ],
};

const view: CalendarView = { kind: "calendar", specVersion: 0, id: "bookings", title: "Bookings", entity: "booking", revision: 3, dataSource: "default", dateField: "when" };

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("CalendarViewEditor", () => {
  function setup() {
    const saved: CalendarView[] = [];
    render(<CalendarViewEditor view={view} entity={entity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("applies settings as one undoable edit, then saves with a new revision", () => {
    const saved = setup();
    fireEvent.change(screen.getByLabelText("Title field"), { target: { value: "Title" } });
    fireEvent.change(screen.getByLabelText("Colour field"), { target: { value: "Status" } });
    fireEvent.change(screen.getByLabelText("Week starts on (0 Sunday – 6 Saturday)"), { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText("Dragging an entry to another day moves it"));
    press("Apply settings");
    expect((button("Save calendar")).disabled).toBe(false);
    press("Save calendar");
    expect(saved[0]).toMatchObject({ revision: 4, titleField: "title", colorField: "status", weekStartsOn: 0, editable: true });
    press("Undo");
    expect((button("Save calendar")).disabled).toBe(true);
  });

  test("adds, reorders and removes detail fields", () => {
    const saved = setup();
    press("Add detail field");
    press("Add detail field");
    const rows = () => within(screen.getByRole("table", { name: /Detail fields of/ })).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows()).toHaveLength(2);
    const second = rows()[1]?.includes("Notes") ? "Notes" : "Status";
    press(`Move ${second} up`);
    press("Save calendar");
    expect(saved[0]?.detailFields).toHaveLength(2);
  });

  test("turns modes on and off, and sets the default", () => {
    setup();
    expect(screen.getByText(/month is the default/)).toBeTruthy();
    press("Make week the default");
    expect(screen.getByText(/week is the default/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("week"));
    expect(screen.getByText(/month is the default/)).toBeTruthy();
  });

  test("sets and clears a fixed filter", () => {
    setup();
    press("Set entries always match");
    const comparison = document.querySelector("[data-yadad-condition-comparison]") as HTMLElement;
    fireEvent.change(within(comparison).getByTestId("input-field"), { target: { value: "Status" } });
    fireEvent.change(within(comparison).getByTestId("input-status"), { target: { value: "open" } });
    press("Apply entries always match");
    expect(screen.getAllByText(/Entries always match: Status/).length).toBeGreaterThan(0);
    press("Edit entries always match");
    press("Remove entries always match");
    expect(screen.getAllByText("Entries always match: none.").length).toBeGreaterThan(0);
  });

  test("a row action is offered only with a context, and can be set and cleared", () => {
    const table: TableView = { kind: "table", specVersion: 0, id: "booking_history", title: "Booking history", entity: "booking", revision: 1, dataSource: "default", columns: [{ field: "title" }] };
    const context = { tables: [table], entities: [entity] };
    render(<CalendarViewEditor view={view} entity={entity} registry={mockRegistry} context={context} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Activating an entry does nothing.")).toBeTruthy();
    press("Set row action");
    expect(screen.getByText(/Activating an entry opens Booking history/)).toBeTruthy();
    press("Remove row action");
    expect(screen.getByText("Activating an entry does nothing.")).toBeTruthy();
  });
});
