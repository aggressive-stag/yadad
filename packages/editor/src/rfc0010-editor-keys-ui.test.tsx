// @vitest-environment jsdom
// Card 48l: the RFC 0010 keys are editable, write their exact contract key and validate.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SPEC_VERSION, validateDocument, validateDocuments } from "@yadad/core";
import type { EntityDocument, TableView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { builtOf, ConditionBuilder } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { EntityFieldsEditor } from "./entity-fields-editor.js";
import { TableViewEditor } from "./table-view-editor.js";
import { setColumnSortable, setQuickFilter, setQuickFilterSettings, setTableSortable } from "./views.js";
import { startSession, edit } from "./session.js";

afterEach(cleanup);

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label) as HTMLInputElement, { target: { value } });
const pick = (testid: string, value: string) => fireEvent.change(document.querySelector(`[data-testid="input-${testid}"]`) as HTMLSelectElement, { target: { value } });

const entity: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "task",
  revision: 1,
  fields: [
    { id: "id", type: "text", label: "Id", required: true, readOnly: true },
    { id: "title", type: "text", label: "Title" },
    { id: "state", type: "select", label: "State", options: { source: "static", values: ["open", "closed"] } },
    { id: "done", type: "boolean", label: "Done" },
    { id: "points", type: "number", label: "Points" },
    { id: "at", type: "datetime", label: "At" },
  ],
};
const table: TableView = { kind: "table", specVersion: SPEC_VERSION, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "state" }, { field: "points" }, { field: "at" }] };
const valid = (v: TableView) => validateDocuments([entity, v]).ok;

describe("table patches (RFC 0010)", () => {
  test("setColumnSortable writes false or removes the key, and refuses a sorted column", () => {
    const off = setColumnSortable(table, "title", false);
    expect(off.ok && off.patch.at(-1)).toEqual({ op: "add", path: "/columns/0/sortable", value: false });
    const sorted: TableView = { ...table, sort: [{ field: "title", dir: "asc" }] };
    expect(setColumnSortable(sorted, "title", false).ok).toBe(false);
    const withFlag: TableView = { ...table, columns: [{ field: "title", sortable: false }, ...table.columns.slice(1)] };
    const on = setColumnSortable(withFlag, "title", true);
    expect(on.ok && on.patch.at(-1)).toEqual({ op: "remove", path: "/columns/0/sortable" });
  });

  test("setTableSortable refuses while a sort is declared", () => {
    expect(setTableSortable({ ...table, sort: [{ field: "title", dir: "asc" }] }, false).ok).toBe(false);
    const r = setTableSortable(table, false);
    expect(r.ok && r.patch).toEqual([{ op: "add", path: "/sortable", value: false }]);
  });

  test("quick filter settings keep the default and refuse a placeholder off a text filter", () => {
    let s = startSession({ ...table, quickFilters: [{ field: "state" }] } as TableView);
    expect(setQuickFilterSettings(s.current, "state", { placeholder: "x" }, "select").ok).toBe(false);
    const r = setQuickFilterSettings(s.current, "state", { label: "Status", default: "open" }, "select");
    if (!r.ok) throw new Error("refused");
    s = edit(s, r.patch);
    expect(s.rejected).toEqual([]);
    expect(s.current.quickFilters).toEqual([{ field: "state", label: "Status", default: "open" }]);
    expect(valid(s.current)).toBe(true);
    expect(setQuickFilter(s.current, "state", false)).toBeTruthy();
  });
});

describe("TableViewEditor RFC 0010 controls", () => {
  function setup(view: TableView = table) {
    const saved: TableView[] = [];
    render(<TableViewEditor view={view} entity={entity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("a column can be made not sortable and sortable again", () => {
    const saved = setup();
    press("Make Title not sortable");
    press("Make Title sortable");
    press("Make Points not sortable");
    press("Save table");
    expect(saved[0]?.columns).toEqual([{ field: "title" }, { field: "state" }, { field: "points", sortable: false }, { field: "at" }]);
    expect(valid(saved[0]!)).toBe(true);
  });

  test("the whole table can be made not sortable", () => {
    const saved = setup();
    fireEvent.click(screen.getByLabelText("Not sortable (every column)"));
    press("Save table");
    expect(saved[0]?.sortable).toBe(false);
    expect(valid(saved[0]!)).toBe(true);
  });

  test("a select quick filter takes a label and a default option", () => {
    const saved = setup({ ...table, quickFilters: [{ field: "state" }] } as TableView);
    type("State filter label", "Status");
    pick("state_default", "closed");
    press("Apply State filter details");
    press("Save table");
    expect(saved[0]?.quickFilters).toEqual([{ field: "state", label: "Status", default: "closed" }]);
    expect(valid(saved[0]!)).toBe(true);
  });

  test("a text quick filter takes a placeholder; a number filter takes a range default", () => {
    const saved = setup({ ...table, quickFilters: [{ field: "title" }, { field: "points" }] } as TableView);
    type("Title filter placeholder", "Search titles");
    press("Apply Title filter details");
    expect(screen.queryByLabelText("State filter placeholder")).toBeNull();
    expect(screen.queryByLabelText("Points filter placeholder")).toBeNull();
    type("Points default from", "3");
    press("Apply Points filter details");
    press("Save table");
    expect(saved[0]?.quickFilters).toEqual([{ field: "title", placeholder: "Search titles" }, { field: "points", default: { from: 3 } }]);
    expect(valid(saved[0]!)).toBe(true);
  });
});

describe("EntityFieldsEditor readOnly", () => {
  test("the server-set toggle writes readOnly", () => {
    const saved: EntityDocument[] = [];
    render(<EntityFieldsEditor entity={entity} views={[]} registry={mockRegistry} onSave={(e) => saved.push(e)} onCancel={() => {}} />);
    press("Edit Title");
    fireEvent.click(screen.getByLabelText("Set by the server (read-only)"));
    press("Apply changes");
    press("Save fields");
    expect(saved[0]?.fields.find((f) => f.id === "title")?.readOnly).toBe(true);
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("an existing readOnly field shows the toggle on and clearing it removes the key", () => {
    const saved: EntityDocument[] = [];
    render(<EntityFieldsEditor entity={entity} views={[]} registry={mockRegistry} onSave={(e) => saved.push(e)} onCancel={() => {}} />);
    press("Edit Id");
    const box = screen.getByLabelText("Set by the server (read-only)") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    press("Apply changes");
    press("Save fields");
    expect("readOnly" in (saved[0]?.fields[0] ?? {})).toBe(false);
  });
});

describe("condition builder: hours from now", () => {
  function Harness({ initial, onDraft }: { initial: ConditionDraft; onDraft: (d: ConditionDraft | undefined) => void }) {
    const [draft, setDraft] = useState<ConditionDraft | undefined>(initial);
    return <ConditionBuilder id="t" label="Rows always match" registry={mockRegistry} entity={entity} draft={draft} onChange={(d) => { setDraft(d); onDraft(d); }} />;
  }

  test("a datetime comparison can compare with hours from now, and keeps it across comparing ops", () => {
    const drafts: (ConditionDraft | undefined)[] = [];
    render(<Harness initial={{ combine: "all", comparisons: [{ not: false, op: "gte", field: "at" }] }} onDraft={(d) => drafts.push(d)} />);
    fireEvent.change(document.getElementById("t-mode-0") as HTMLSelectElement, { target: { value: "Hours from now" } });
    fireEvent.change(document.getElementById("t-hours-0") as HTMLInputElement, { target: { value: "-24" } });
    expect(builtOf(drafts.at(-1))).toEqual({ op: "gte", field: "at", value: { hoursFromNow: -24 } });
    expect(screen.getByText("At is at least 24 hours ago")).toBeTruthy();
    fireEvent.change(document.getElementById("t-op-0") as HTMLSelectElement, { target: { value: "is at most" } });
    expect(builtOf(drafts.at(-1))).toEqual({ op: "lte", field: "at", value: { hoursFromNow: -24 } });
    fireEvent.change(document.getElementById("t-hours-0") as HTMLInputElement, { target: { value: "" } });
    expect(builtOf(drafts.at(-1))).toBeUndefined();
  });

  test("a number field is not offered hours from now", () => {
    render(<Harness initial={{ combine: "all", comparisons: [{ not: false, op: "gte", field: "points" }] }} onDraft={() => {}} />);
    expect(document.getElementById("t-hours-0")).toBeNull();
    expect(document.getElementById("t-mode-0")).toBeNull();
  });
});
