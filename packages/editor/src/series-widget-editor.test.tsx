// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DashboardView, EntityDocument, GridItem, TableView } from "@yadad/core";
import { validateDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";
import { fieldReferences } from "./fields.js";
import { groupableFieldIds, setSeriesBucket, setSeriesDisplay, setSeriesGroupBy, setSeriesLimit, setSeriesMeasure, setSeriesSort, setSeriesView } from "./views.js";

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
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function setup(dashboard: DashboardView = empty, moreViews: readonly TableView[] = []) {
  const saved: DashboardView[] = [];
  render(<DashboardLayoutEditor dashboard={dashboard} registry={mockRegistry} onSave={(d) => saved.push(d)} onCancel={() => {}} views={[sets, ...moreViews]} entities={new Map([["set", entity]])} />);
  return saved;
}

type SeriesItem = Extract<GridItem, { widget: "series" }>;
const series = (over: Partial<Pick<SeriesItem, "groupBy" | "measure" | "display" | "sort" | "limit" | "filter">> = {}): SeriesItem => ({
  id: "s",
  x: 0,
  y: 0,
  w: 6,
  h: 4,
  widget: "series",
  label: "S",
  view: "sets",
  groupBy: { field: "exercise" },
  measure: { op: "sum", field: "weight" },
  display: "bar",
  ...over,
});
const board = (item: SeriesItem): DashboardView => ({ ...empty, tabs: [{ id: "main", title: "Main", items: [item, { id: "f", x: 6, y: 0, w: 3, h: 2, widget: "view", view: "sets" }] }] });

describe("series patches", () => {
  const b = board(series());
  test("groupableFieldIds lists the validator's types in entity order", () => {
    expect(groupableFieldIds(entity)).toEqual(["exercise", "day"]);
    expect(groupableFieldIds({ ...entity, fields: [{ id: "n", type: "number", label: "N" }] })).toEqual([]);
  });
  test("setSeriesView replaces view, groupBy and measure together", () => {
    const r = setSeriesView(b, "main", "s", "pr", { field: "day", bucket: "week" }, { op: "count" });
    expect(r).toEqual({
      ok: true,
      patch: [
        { op: "test", path: "/tabs/0/items/0/id", value: "s" },
        { op: "replace", path: "/tabs/0/items/0/view", value: "pr" },
        { op: "replace", path: "/tabs/0/items/0/groupBy", value: { field: "day", bucket: "week" } },
        { op: "replace", path: "/tabs/0/items/0/measure", value: { op: "count" } },
      ],
    });
    expect(setSeriesView(b, "main", "s", "sets", { field: "exercise" }, { op: "sum", field: "weight" })).toEqual({ ok: true, patch: [] });
    expect(setSeriesView(b, "main", "f", "pr", { field: "day" }, { op: "count" }).ok).toBe(false);
  });
  test("setSeriesGroupBy keeps a bucket only on a date field", () => {
    const r = setSeriesGroupBy(b, "main", "s", entity, "day", "month");
    expect(r).toEqual({ ok: true, patch: [{ op: "test", path: "/tabs/0/items/0/id", value: "s" }, { op: "replace", path: "/tabs/0/items/0/groupBy", value: { field: "day", bucket: "month" } }] });
    // A bucket offered for a text field is dropped, not persisted.
    const back = setSeriesGroupBy({ ...b, tabs: [{ ...b.tabs[0]!, items: [series({ groupBy: { field: "day", bucket: "week" } }), b.tabs[0]!.items[1]!] }] }, "main", "s", entity, "exercise");
    expect(back).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "replace", path: "/tabs/0/items/0/groupBy", value: { field: "exercise" } }] });
    expect(setSeriesGroupBy(b, "main", "s", entity, "weight").ok).toBe(false);
    expect(setSeriesGroupBy(b, "main", "f", entity, "day").ok).toBe(false);
  });
  test("setSeriesBucket rides a date groupBy and can be cleared", () => {
    const dated = board(series({ groupBy: { field: "day" } }));
    expect(setSeriesBucket(dated, "main", "s", entity, "week")).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "replace", path: "/tabs/0/items/0/groupBy", value: { field: "day", bucket: "week" } }] });
    expect(setSeriesBucket({ ...dated, tabs: [{ ...dated.tabs[0]!, items: [series({ groupBy: { field: "day", bucket: "week" } }), dated.tabs[0]!.items[1]!] }] }, "main", "s", entity, undefined)).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "replace", path: "/tabs/0/items/0/groupBy", value: { field: "day" } }] });
    // Already at week: nothing to patch.
    expect(setSeriesBucket({ ...dated, tabs: [{ ...dated.tabs[0]!, items: [series({ groupBy: { field: "day", bucket: "week" } }), dated.tabs[0]!.items[1]!] }] }, "main", "s", entity, "week")).toEqual({ ok: true, patch: [] });
    // A text groupBy has no buckets to set.
    expect(setSeriesBucket(b, "main", "s", entity, "day").ok).toBe(false);
  });
  test("setSeriesDisplay, setSeriesMeasure, setSeriesSort and setSeriesLimit patch their key", () => {
    expect(setSeriesDisplay(b, "main", "s", "line")).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "replace", path: "/tabs/0/items/0/display", value: "line" }] });
    expect(setSeriesDisplay(b, "main", "s", "bar")).toEqual({ ok: true, patch: [] });
    expect(setSeriesMeasure(b, "main", "s", { op: "count" })).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "replace", path: "/tabs/0/items/0/measure", value: { op: "count" } }] });
    expect(setSeriesSort(b, "main", "s", { by: "value", dir: "desc" })).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "add", path: "/tabs/0/items/0/sort", value: { by: "value", dir: "desc" } }] });
    const sorted = board(series({ sort: { by: "value", dir: "desc" } }));
    expect(setSeriesSort(sorted, "main", "s", undefined)).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "remove", path: "/tabs/0/items/0/sort" }] });
    expect(setSeriesLimit(b, "main", "s", 10)).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "add", path: "/tabs/0/items/0/limit", value: 10 }] });
    expect(setSeriesLimit(b, "main", "s", 0).ok).toBe(false);
    expect(setSeriesLimit(b, "main", "s", 1.5).ok).toBe(false);
    const capped = board(series({ limit: 10 }));
    expect(setSeriesLimit(capped, "main", "s", undefined)).toMatchObject({ ok: true, patch: [{ op: "test" }, { op: "remove", path: "/tabs/0/items/0/limit" }] });
    expect(setSeriesDisplay(b, "main", "f", "line").ok).toBe(false);
  });
  test("fieldReferences finds the fields a series uses", () => {
    const withAll = board(series({ groupBy: { field: "day", bucket: "week" }, measure: { op: "sum", product: ["weight", "reps"] }, filter: { op: "eq", field: "reps", value: 5 } }));
    expect(fieldReferences([withAll], "set", "day")).toEqual(["d/tabs/0/items/0/groupBy/field"]);
    expect(fieldReferences([withAll], "set", "reps")).toEqual(["d/tabs/0/items/0/filter", "d/tabs/0/items/0/measure"]);
    expect(fieldReferences([withAll], "set", "weight")).toEqual(["d/tabs/0/items/0/measure"]);
  });
});

describe("DashboardLayoutEditor series widgets", () => {
  test("adds a series from the palette and saves a valid dashboard", () => {
    const saved = setup();
    choose("Widget to add", "Series of sets");
    press("Add to Main");
    expect(screen.getByRole("group", { name: /^Series: Sets/ })).toBeTruthy();
    press("Save layout");
    const item = saved[0]?.tabs[0]?.items[0];
    expect(item).toMatchObject({ widget: "series", view: "sets", groupBy: { field: "exercise" }, measure: { op: "sum", field: "weight" }, display: "bar" });
    expect(validateDocument(saved[0]).ok).toBe(true);
  });

  test("grouping by a date makes the bucket picker appear", () => {
    const saved = setup(board(series()));
    expect(screen.queryByLabelText(/Bucket of/)).toBeNull();
    choose("Group by of S", "day");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Series: S now groups by Day.");
    choose("Bucket of S", "week");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Series: S now buckets by week.");
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items[0]).toMatchObject({ groupBy: { field: "day", bucket: "week" } });
    expect(validateDocument(saved[0]).ok).toBe(true);
    // Back to an exact date removes the bucket again.
    choose("Bucket of S", "(exact date)");
    press("Save layout");
    expect(saved[1]?.tabs[0]?.items[0]).toMatchObject({ groupBy: { field: "day" } });
    expect(saved[1]?.tabs[0]?.items[0]).not.toHaveProperty("groupBy.bucket");
  });

  test("the display, sort and limit pickers patch the widget", () => {
    const saved = setup(board(series()));
    choose("Display of S", "line");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Series: S displays as line.");
    choose("Sort by of S", "value");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Series: S sorts by value asc.");
    choose("Sort direction of S", "desc");
    type("Limit of S (default 50)", "12");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Series: S keeps 12 groups.");
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items[0]).toMatchObject({ display: "line", sort: { by: "value", dir: "desc" }, limit: 12 });
    expect(validateDocument(saved[0]).ok).toBe(true);
    press("Clear the limit of Series: S");
    choose("Sort by of S", "(group, ascending)");
    press("Save layout");
    expect(saved[1]?.tabs[0]?.items[0]).not.toHaveProperty("limit");
    expect(saved[1]?.tabs[0]?.items[0]).not.toHaveProperty("sort");
  });

  test("the table view picker reseeds group and measure for a foreign entity", () => {
    const other: EntityDocument = { kind: "entity", specVersion: 2, id: "lift", revision: 1, fields: [{ id: "bar", type: "select", label: "Bar", options: { source: "static", values: ["20", "45"] } }, { id: "kg", type: "number", label: "Kg" }] };
    const lifts: TableView = { kind: "table", specVersion: 2, id: "lifts", title: "Lifts", entity: "lift", revision: 1, dataSource: "default", columns: [{ field: "kg" }] };
    const saved: DashboardView[] = [];
    render(<DashboardLayoutEditor dashboard={board(series())} registry={mockRegistry} onSave={(d) => saved.push(d)} onCancel={() => {}} views={[sets, lifts]} entities={new Map([["set", entity], ["lift", other]])} />);
    choose("Table view of S", "lifts");
    expect(document.querySelector("[data-yadad-editor-status]")?.textContent).toBe("Series: S now reads the lifts table.");
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items[0]).toMatchObject({ view: "lifts", groupBy: { field: "bar" }, measure: { op: "sum", field: "kg" } });
    expect(validateDocument(saved[0]).ok).toBe(true);
  });

  test("a series' filter edits through the condition builder", () => {
    const saved = setup(board(series({ filter: { op: "eq", field: "exercise", value: "Squat" } })));
    expect(screen.getByText(/Series now matches/)).toBeTruthy();
    press("Edit the series filter of Series: S");
    expect(document.querySelector("[data-yadad-count-filter-builder]")).not.toBeNull();
    press("Cancel the series filter");
    press("Remove the series filter of Series: S");
    press("Save layout");
    expect(saved[0]?.tabs[0]?.items[0]).not.toHaveProperty("filter");
  });

  test("a series edit undoes back to a clean session", () => {
    setup(board(series()));
    choose("Display of S", "table");
    press("Undo");
    expect((screen.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
