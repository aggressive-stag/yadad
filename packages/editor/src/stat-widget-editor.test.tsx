// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DashboardView, EntityDocument, TableView } from "@yadad/core";
import { validateDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";
import { fieldReferences } from "./fields.js";
import { measureFor, setCountWidgetFilter, setStatMeasure } from "./views.js";

afterEach(cleanup);

const entity: EntityDocument = {
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
const sets: TableView = { kind: "table", specVersion: 2, id: "sets", title: "Sets", entity: "set", revision: 1, dataSource: "default", columns: [{ field: "exercise" }] };
const empty: DashboardView = { kind: "dashboard", specVersion: 2, id: "d", revision: 1, tabs: [{ id: "main", title: "Main", items: [] }] };
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function setup(dashboard: DashboardView = empty) {
  const saved: DashboardView[] = [];
  render(<DashboardLayoutEditor dashboard={dashboard} registry={mockRegistry} onSave={(d) => saved.push(d)} onCancel={() => {}} views={[sets]} entities={new Map([["set", entity]])} />);
  return saved;
}

describe("measureFor", () => {
  test("picks a field the op accepts and keeps a fitting one", () => {
    expect(measureFor(entity, "count")).toEqual({ op: "count" });
    expect(measureFor(entity, "sum")).toEqual({ op: "sum", field: "weight" });
    expect(measureFor(entity, "sum", "reps", "weight")).toEqual({ op: "sum", product: ["reps", "weight"] });
    expect(measureFor(entity, "max", "day")).toEqual({ op: "max", field: "day" });
    expect(measureFor(entity, "avg", "day")).toEqual({ op: "avg", field: "weight" });
    expect(measureFor(entity, "countDistinct", "exercise")).toEqual({ op: "countDistinct", field: "exercise" });
    expect(measureFor(entity, "min", "weight", "reps")).toEqual({ op: "min", field: "weight" }); // only sum and avg multiply
    expect(measureFor({ ...entity, fields: [{ id: "n", type: "text", label: "N" }] }, "sum")).toBeUndefined();
  });
});

describe("stat widget patches", () => {
  const board: DashboardView = { ...empty, tabs: [{ id: "main", title: "Main", items: [{ id: "v", x: 0, y: 0, w: 3, h: 2, widget: "stat", label: "V", view: "sets", measure: { op: "count" } }, { id: "f", x: 3, y: 0, w: 3, h: 2, widget: "view", view: "sets" }] }] };
  test("setStatMeasure replaces the measure and refuses other widgets", () => {
    const r = setStatMeasure(board, "main", "v", { op: "sum", product: ["weight", "reps"] });
    expect(r).toEqual({ ok: true, patch: [{ op: "test", path: "/tabs/0/items/0/id", value: "v" }, { op: "replace", path: "/tabs/0/items/0/measure", value: { op: "sum", product: ["weight", "reps"] } }] });
    expect(setStatMeasure(board, "main", "f", { op: "count" }).ok).toBe(false);
    expect(setStatMeasure(board, "main", "ghost", { op: "count" }).ok).toBe(false);
  });
  test("a stat's filter is set like a count's", () => {
    const r = setCountWidgetFilter(board, "main", "v", { op: "eq", field: "exercise", value: "Squat" });
    expect(r).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "add", path: "/tabs/0/items/0/filter" }] });
    expect(setCountWidgetFilter(board, "main", "f", undefined).ok).toBe(false);
  });
  test("fieldReferences finds a field used by a stat's measure and filter", () => {
    const withFilter: DashboardView = { ...board, tabs: [{ ...board.tabs[0]!, items: [{ id: "v", x: 0, y: 0, w: 3, h: 2, widget: "stat", label: "V", view: "sets", measure: { op: "sum", product: ["weight", "reps"] }, filter: { op: "eq", field: "reps", value: 5 } }] }] };
    expect(fieldReferences([withFilter], "set", "weight")).toEqual(["d/tabs/0/items/0/measure"]);
    expect(fieldReferences([withFilter], "set", "reps")).toEqual(["d/tabs/0/items/0/filter", "d/tabs/0/items/0/measure"]);
  });
});

describe("DashboardLayoutEditor stat widgets", () => {
  test("adds a stat from the palette, changes its measure, and saves a valid dashboard", () => {
    const saved = setup();
    choose("Widget to add", "Stat of sets");
    press("Add to Main");
    expect(screen.getByRole("group", { name: /^Stat: Sets/ })).toBeTruthy();
    choose("Measure of Sets", "avg");
    choose("Times (optional) of Sets", "reps");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Stat: Sets now shows avg of Weight times Reps.");
    choose("Measure of Sets", "max");
    choose("Field of Sets", "day");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Stat: Sets now shows max of Day.");
    press("Save layout");
    const item = saved[0]?.tabs[0]?.items[0];
    expect(item).toMatchObject({ widget: "stat", view: "sets", measure: { op: "max", field: "day" } });
    expect(validateDocument(saved[0]).ok).toBe(true);
  });

  test("a new stat starts as the total of the first number field", () => {
    const saved = setup();
    choose("Widget to add", "Stat of sets");
    press("Add to Main");
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items[0]).toMatchObject({ measure: { op: "sum", field: "weight" } });
  });

  test("a stat's filter edits through the condition builder", () => {
    const saved = setup({ ...empty, tabs: [{ id: "main", title: "Main", items: [{ id: "v", x: 0, y: 0, w: 3, h: 2, widget: "stat", label: "V", view: "sets", measure: { op: "count" }, filter: { op: "eq", field: "exercise", value: "Squat" } }] }] });
    expect(screen.getByText(/Stat now matches/)).toBeTruthy();
    press("Edit the stat filter of Stat: V");
    expect(document.querySelector("[data-yadad-count-filter-builder]")).not.toBeNull();
    press("Cancel the stat filter");
    press("Remove the stat filter of Stat: V");
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items[0]).not.toHaveProperty("filter");
  });
});
