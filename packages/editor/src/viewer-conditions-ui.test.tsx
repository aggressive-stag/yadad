// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SPEC_VERSION } from "@yadad/core";
import type { BoardView, CalendarView, DashboardView, EntityDocument, FormView, TableView, ViewerDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BoardViewEditor } from "./board-view-editor.js";
import { CalendarViewEditor } from "./calendar-view-editor.js";
import { builtOf, ConditionBuilder } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { asViewerCondition, parseGroup, roundTrips } from "./conditions.js";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";
import { FormViewEditor } from "./form-view-editor.js";
import { TableViewEditor } from "./table-view-editor.js";
import { setColumnEditable, setColumnEditableWhen, setColumnVisibleWhen, setItemVisibleWhen, setTabVisibleWhen } from "./views.js";

afterEach(cleanup);

const viewer: ViewerDocument = {
  kind: "viewer",
  specVersion: SPEC_VERSION,
  id: "viewer",
  revision: 1,
  facts: [
    { id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor", "owner"] }, default: "viewer" },
    { id: "beta", label: "Beta", type: "boolean", default: false },
  ],
};
const entity: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "done"] } },
    { id: "due", type: "date", label: "Due" },
  ],
};
const table: TableView = { kind: "table", specVersion: SPEC_VERSION, id: "t", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title", editable: true }, { field: "status" }] };
const form: FormView = { kind: "form", specVersion: SPEC_VERSION, id: "f", entity: "task", revision: 1, dataSource: "default", sections: [{ id: "main", items: [{ field: "title" }, { field: "status" }] }] };
const owner = { op: "viewerIn", fact: "role", values: ["owner"] } as const;

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("viewer comparisons", () => {
  test("viewerIn round-trips through the builder, alone, negated and with record comparisons", () => {
    expect(roundTrips(owner)).toBe(true);
    expect(roundTrips({ op: "not", condition: owner })).toBe(true);
    expect(roundTrips({ op: "and", conditions: [owner, { op: "eq", field: "status", value: "open" }] })).toBe(true);
    expect(parseGroup(owner)?.comparisons[0]).toMatchObject({ op: "viewerIn", field: "role", values: ["owner"] });
    expect(asViewerCondition({ op: "or", conditions: [owner, { op: "not", condition: owner }] })).toBeDefined();
    expect(asViewerCondition({ op: "and", conditions: [owner, { op: "eq", field: "status", value: "open" }] })).toBeUndefined();
  });

  test("the builder offers a Viewer source next to Field and builds viewerIn", () => {
    const drafts: (ConditionDraft | undefined)[] = [];
    function H() {
      const [d, setD] = useState<ConditionDraft | undefined>({ combine: "all", comparisons: [{ not: false, op: "eq", field: "status", value: "open" }] });
      return <ConditionBuilder id="t" label="Show only when" registry={mockRegistry} entity={entity} viewer={viewer} draft={d} onChange={(x) => (setD(x), drafts.push(x))} />;
    }
    render(<H />);
    fireEvent.change(document.getElementById("t-source-0") as HTMLSelectElement, { target: { value: "The viewer" } });
    expect(drafts.at(-1)?.comparisons[0]).toMatchObject({ op: "viewerIn", field: "role" });
    fireEvent.click(document.getElementById("t-in-0-owner") as HTMLInputElement);
    expect(builtOf(drafts.at(-1))).toEqual(owner);
    fireEvent.change(document.getElementById("t-fact-0") as HTMLSelectElement, { target: { value: "Beta" } });
    fireEvent.click(document.getElementById("t-in-0-true") as HTMLInputElement);
    expect(builtOf(drafts.at(-1))).toEqual({ op: "viewerIn", fact: "beta", values: [true] });
    fireEvent.change(document.getElementById("t-source-0") as HTMLSelectElement, { target: { value: "A field of the record" } });
    expect(drafts.at(-1)?.comparisons[0]).toMatchObject({ op: "eq", field: "title" });
  });

  test("without a viewer there is no Viewer source", () => {
    render(<ConditionBuilder id="t" label="x" registry={mockRegistry} entity={entity} draft={{ combine: "all", comparisons: [{ not: false, op: "eq", field: "status" }] }} onChange={() => {}} />);
    expect(document.getElementById("t-source-0")).toBeNull();
  });
});

describe("viewer patches", () => {
  test("column rules: set, clear, editableWhen needs editable, un-editing drops it", () => {
    const set = setColumnVisibleWhen(table, "status", owner);
    expect(set).toMatchObject({ ok: true });
    expect(setColumnEditableWhen(table, "status", owner).ok).toBe(false);
    const withRule: TableView = { ...table, columns: [{ field: "title", editable: true, editableWhen: owner }, { field: "status" }] };
    const off = setColumnEditable(withRule, "title", false);
    expect(off.ok && off.patch.map((p) => p.op + " " + ("path" in p ? p.path : ""))).toEqual(expect.arrayContaining(["remove /columns/0/editableWhen", "remove /columns/0/editable"]));
    expect(setColumnVisibleWhen(table, "status", undefined)).toEqual({ ok: true, patch: [] });
  });
  test("tab and widget rules", () => {
    const dash: DashboardView = { kind: "dashboard", specVersion: SPEC_VERSION, id: "d", revision: 1, tabs: [{ id: "a", title: "A", items: [{ id: "w", x: 0, y: 0, w: 4, h: 3, widget: "view", view: "t" }] }] };
    expect(setTabVisibleWhen(dash, "a", owner)).toMatchObject({ ok: true });
    expect(setItemVisibleWhen(dash, "a", "w", owner)).toMatchObject({ ok: true });
    expect(setItemVisibleWhen(dash, "a", "nope", owner).ok).toBe(false);
  });
});

describe("editors with a viewer", () => {
  test("table: hide a column for viewers, saved as visibleWhen; keyboard buttons only", () => {
    const onSave = vi.fn();
    render(<TableViewEditor view={table} entity={entity} registry={mockRegistry} viewer={viewer} onSave={onSave} onCancel={() => {}} />);
    press("Show: Status");
    fireEvent.click(document.querySelector("[data-yadad-viewer-rule-builder] input[id$='-in-0-owner']") as HTMLInputElement);
    press("Apply Show: Status");
    press("Save table");
    expect((onSave.mock.calls[0]?.[0] as TableView).columns[1]).toEqual({ field: "status", visibleWhen: owner });
  });

  test("table: editing rule appears only on editable columns", () => {
    render(<TableViewEditor view={table} entity={entity} registry={mockRegistry} viewer={viewer} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: "Allow editing: Status" })).toBeNull();
    expect(screen.getByRole("button", { name: "Allow editing: Title" })).toBeTruthy();
  });

  test("table: no viewer prop, no viewer column", () => {
    render(<TableViewEditor view={table} entity={entity} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: "Show: Status" })).toBeNull();
  });

  test("form: a field can be shown by a viewer fact; clear-while-hidden is then off", () => {
    const onSave = vi.fn();
    render(<FormViewEditor view={form} entity={entity} registry={mockRegistry} viewer={viewer} onSave={onSave} onCancel={() => {}} />);
    press("Show only when: Status");
    fireEvent.change(document.querySelector("[id$='-source-0']") as HTMLSelectElement, { target: { value: "The viewer" } });
    fireEvent.click(document.querySelector("[id*='-in-0-owner']") as HTMLInputElement);
    press("Apply show only when");
    expect(screen.getByText(/Shown when the viewer's Role is one of owner/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear Status while hidden" }).hasAttribute("disabled")).toBe(true);
    press("Save form");
    expect((onSave.mock.calls[0]?.[0] as FormView).sections[0]?.items[1]?.visibleWhen).toEqual(owner);
  });

  test("calendar and board: editableWhen only while editable", () => {
    const cal: CalendarView = { kind: "calendar", specVersion: SPEC_VERSION, id: "c", entity: "task", revision: 1, dataSource: "default", dateField: "due", editable: true };
    const board: BoardView = { kind: "board", specVersion: SPEC_VERSION, id: "b", entity: "task", revision: 1, dataSource: "default", groupBy: [{ field: "status" }] };
    const { unmount } = render(<CalendarViewEditor view={cal} entity={entity} registry={mockRegistry} viewer={viewer} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Allow moving: c" })).toBeTruthy();
    unmount();
    render(<BoardViewEditor view={board} entity={entity} registry={mockRegistry} viewer={viewer} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: /Allow moving/ })).toBeNull();
  });

  test("dashboard: tab and widget rules", () => {
    const dash: DashboardView = { kind: "dashboard", specVersion: SPEC_VERSION, id: "d", revision: 1, tabs: [{ id: "a", title: "A", items: [{ id: "w", x: 0, y: 0, w: 4, h: 3, widget: "view", view: "t" }] }] };
    const onSave = vi.fn();
    render(<DashboardLayoutEditor dashboard={dash} registry={mockRegistry} viewer={viewer} views={[table]} onSave={onSave} onCancel={() => {}} />);
    press("List tab: A");
    fireEvent.click(document.querySelector("[data-yadad-tab-viewer-rule] input[id$='-in-0-owner']") as HTMLInputElement);
    press("Apply List tab: A");
    press("Show: t");
    fireEvent.click(document.querySelector("[data-yadad-item-viewer-rule] input[id$='-in-0-editor']") as HTMLInputElement);
    press("Apply Show: t");
    press("Save layout");
    const saved = onSave.mock.calls[0]?.[0] as DashboardView;
    expect(saved.tabs[0]?.visibleWhen).toEqual(owner);
    expect(saved.tabs[0]?.items[0]?.visibleWhen).toEqual({ op: "viewerIn", fact: "role", values: ["editor"] });
  });
});
