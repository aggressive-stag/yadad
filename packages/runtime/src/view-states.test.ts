import { describe, expect, it } from "vitest";
import type { BoardView, CalendarView, Condition, DashboardView, DataRecord, Document, EntityDocument, FormView, TableView, ViewerCondition, ViewerDocument } from "@yadad/core";
import { combineAxes } from "./combine-axes.js";
import type { CombinableAxis } from "./combine-axes.js";
import { AGGREGATE_MAX_RECORDS } from "./aggregate.js";
import { validateRecord } from "./record.js";
import { viewStates } from "./view-states.js";
import type { SeriesStateWidget, StateAxis, ViewState, ViewStateRender, ViewStatesResult } from "./view-states.js";

const NOW = new Date(2026, 9, 17, 12, 0, 0); // 2026-10-17, local

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "task",
  revision: 2,
  fields: [
    { id: "title", label: "Title", type: "text", required: true },
    { id: "status", label: "Status", type: "select", options: { source: "static", values: ["todo", "doing", "done"] } },
    { id: "due", label: "Due", type: "date" },
    { id: "amount", label: "Amount", type: "number", min: 0, max: 1000 },
    { id: "urgent", label: "Urgent", type: "boolean" },
    { id: "agreed", label: "Agreed", type: "boolean", required: true },
    { id: "note", label: "Note", type: "text" },
    { id: "owner", label: "Owner", type: "reference", entity: "person" },
  ],
};

const base = { specVersion: 4 as const, revision: 1, dataSource: "tasks" };
const eq = (field: string, value: string | number | boolean): Condition => ({ op: "eq", field, value });

const form = (visibleWhen?: Condition, requiredWhen?: Condition): FormView => ({
  ...base,
  kind: "form",
  id: "task-form",
  entity: "task",
  sections: [
    {
      id: "main",
      items: [
        { field: "title" },
        { field: "status" },
        { field: "due" },
        { field: "amount" },
        { field: "note", ...(visibleWhen ? { visibleWhen } : {}), ...(requiredWhen ? { requiredWhen } : {}) },
      ],
    },
  ],
});

const table = (filter?: Condition, pageSize?: number): TableView => ({
  ...base,
  kind: "table",
  id: "task-table",
  entity: "task",
  columns: [{ field: "title" }, { field: "status" }],
  ...(filter ? { filter } : {}),
  ...(pageSize ? { pageSize } : {}),
});

const calendar: CalendarView = { ...base, kind: "calendar", id: "task-cal", entity: "task", dateField: "due", filter: eq("status", "todo") };
const board: BoardView = { ...base, kind: "board", id: "task-board", entity: "task", groupBy: [{ field: "status" }, { field: "urgent" }] };

const docs: Document[] = [entity, form(), table(), calendar, board];

function axis(result: ViewStatesResult, id: string): StateAxis {
  const found = result.axes.find((a) => a.id === id);
  if (!found) throw new Error(`no axis ${id}`);
  return found;
}
const ids = (a: StateAxis): string[] => a.values.map((v) => v.id);
const labels = (a: StateAxis): string[] => a.values.map((v) => v.label);

describe("batch composer rows axis", () => {
  it("a batch form gets a rows axis whose three-row state carries rows: 3", () => {
    const batch: FormView = { ...form(), repeat: "batch" };
    const r = viewStates(batch, [entity, batch], { now: NOW });
    expect(labels(axis(r, "rows"))).toEqual(["one row", "three rows queued"]);
    const rows = r.states.flatMap((s) => (s.render.kind === "form" ? [s.render.rows] : []));
    expect(new Set(rows)).toEqual(new Set([1, 3]));
  });

  it("a plain form has no rows axis and no rows", () => {
    const f = form();
    const r = viewStates(f, [entity, f], { now: NOW });
    expect(r.states.every((s) => s.render.kind === "form" && s.render.rows === undefined)).toBe(true);
  });
});

describe("field boundaries", () => {
  it("select: every option plus empty", () => {
    const r = viewStates(form(eq("status", "done")), docs, { now: NOW });
    expect(labels(axis(r, "field:status"))).toEqual(["status empty", "status = todo", "status = doing", "status = done"]);
  });

  it("boolean: false and true, plus empty when not required", () => {
    const f: FormView = { ...form(), sections: [{ id: "s", items: [{ field: "urgent", visibleWhen: eq("urgent", true) }, { field: "agreed", visibleWhen: eq("agreed", true) }] }] };
    const r = viewStates(f, [entity, f], { now: NOW });
    expect(labels(axis(r, "field:urgent"))).toEqual(["urgent empty", "urgent = false", "urgent = true"]);
    expect(labels(axis(r, "field:agreed"))).toEqual(["agreed empty", "agreed = false", "agreed = true"]); // a form is a draft: still shown
    const t: TableView = table({ op: "and", conditions: [eq("urgent", true), eq("agreed", true)] });
    const rt = viewStates(t, [entity, t], { now: NOW });
    expect(labels(axis(rt, "field:agreed"))).toEqual(["agreed = true"]); // a record must be checked
    expect(rt.skipped.map((s) => s.id)).toContain("field:agreed=v:false");
  });

  it("number: just below, at and just above each threshold, plus empty", () => {
    const r = viewStates(form({ op: "gte", field: "amount", value: 10 }), docs, { now: NOW });
    expect(labels(axis(r, "field:amount"))).toEqual(["amount empty", "amount = 9", "amount = 10", "amount = 11"]);
    const decimal = viewStates(form({ op: "lt", field: "amount", value: 2.5 }), docs, { now: NOW });
    expect(labels(axis(decimal, "field:amount"))).toEqual(["amount empty", "amount = 2.4", "amount = 2.5", "amount = 2.6"]);
  });

  it("number: several thresholds merge, sorted", () => {
    const c: Condition = { op: "or", conditions: [{ op: "lt", field: "amount", value: 100 }, { op: "gt", field: "amount", value: 10 }] };
    const r = viewStates(form(c), docs, { now: NOW });
    expect(labels(axis(r, "field:amount"))).toEqual(["amount empty", "amount = 9", "amount = 10", "amount = 11", "amount = 99", "amount = 100", "amount = 101"]);
  });

  it("number in a record: values outside min and max are skipped, not generated", () => {
    const r = viewStates(table({ op: "lt", field: "amount", value: 0 }), docs, { now: NOW });
    expect(labels(axis(r, "field:amount"))).toEqual(["amount empty", "amount = 0", "amount = 1"]);
    expect(r.skipped.map((s) => s.id)).toEqual(["field:amount=v:-1"]);
  });

  it("date: the day before, the day of and the day after, with relative dates resolved against now", () => {
    const r = viewStates(form({ op: "lt", field: "due", value: { daysFromToday: 0 } }), docs, { now: NOW });
    expect(labels(axis(r, "field:due"))).toEqual(["due empty", "due yesterday", "due today", "due tomorrow"]);
    const fixed = viewStates(form({ op: "eq", field: "due", value: "2026-12-31" }), docs, { now: NOW });
    expect(ids(axis(fixed, "field:due"))).toEqual(["empty", "v:2026-12-30", "v:2026-12-31", "v:2027-01-01"]);
    const later = viewStates(form({ op: "gt", field: "due", value: { daysFromToday: 7 } }), docs, { now: NOW });
    expect(ids(axis(later, "field:due"))).toEqual(["empty", "v:2026-10-23", "v:2026-10-24", "v:2026-10-25"]);
  });

  it("date: relative dates follow now", () => {
    const next = new Date(2026, 11, 31, 8);
    const r = viewStates(form({ op: "eq", field: "due", value: { daysFromToday: 0 } }), docs, { now: next });
    expect(ids(axis(r, "field:due"))).toEqual(["empty", "v:2026-12-30", "v:2026-12-31", "v:2027-01-01"]);
  });

  it("text: empty, filled, and the compared value for eq and contains", () => {
    const c: Condition = { op: "or", conditions: [eq("note", "urgent"), { op: "contains", field: "note", value: "fix" }] };
    const r = viewStates(form(c), docs, { now: NOW });
    expect(labels(axis(r, "field:note"))).toEqual(["note empty", "note filled", "note = urgent", "note = fix"]);
  });

  it("reference: empty and set", () => {
    const f: FormView = { ...form(), sections: [{ id: "s", items: [{ field: "owner", visibleWhen: { op: "notEmpty", field: "owner" } }] }] };
    const r = viewStates(f, [entity, f], { now: NOW });
    expect(labels(axis(r, "field:owner"))).toEqual(["owner empty", "owner set"]);
  });

  it("in: each member is a value", () => {
    const r = viewStates(form({ op: "in", field: "amount", values: [5, 50] }), docs, { now: NOW });
    expect(labels(axis(r, "field:amount"))).toEqual(["amount empty", "amount = 5", "amount = 50", "amount = 51"]);
  });
});

describe("nested conditions", () => {
  it("walks and, or and not, in order of first appearance, for visibleWhen and requiredWhen", () => {
    const visible: Condition = { op: "and", conditions: [{ op: "not", condition: eq("status", "done") }, { op: "or", conditions: [{ op: "empty", field: "due" }, eq("amount", 5)] }] };
    const required: Condition = { op: "contains", field: "title", value: "x" };
    const r = viewStates(form(visible, required), docs, { now: NOW });
    expect(r.axes.map((a) => a.id)).toEqual(["field:status", "field:due", "field:amount", "field:title", "fill"]);
  });

  it("ignores fields the entity does not have", () => {
    const r = viewStates(form(eq("ghost", 1)), docs, { now: NOW });
    expect(r.axes.map((a) => a.id)).toEqual(["fill"]);
  });
});

describe("form", () => {
  it("states hold the form values and now; empty axis values leave the field out", () => {
    const r = viewStates(form(eq("status", "done")), docs, { now: NOW });
    expect(r.strategy).toBe("full");
    expect(r.states).toHaveLength(8);
    const first = r.states[0];
    expect(first?.render).toEqual({ kind: "form", view: "task-form", values: {}, now: NOW });
    const doneFilled = r.states.find((s) => s.values["field:status"] === "v:done" && s.values["fill"] === "filled");
    expect(doneFilled?.render).toMatchObject({ kind: "form", values: { status: "done", title: "Sample text", amount: 0 } });
    expect(doneFilled?.label).toBe("status = done · other fields filled");
    const emptyFilled = r.states.find((s) => s.values["field:status"] === "empty" && s.values["fill"] === "filled");
    expect(emptyFilled?.render).toMatchObject({ kind: "form" });
    expect(emptyFilled?.render.kind === "form" && "status" in emptyFilled.render.values).toBe(false);
  });

  it("a form without conditions still has its fill states", () => {
    const r = viewStates(form(), docs, { now: NOW });
    expect(r.states.map((s) => s.id)).toEqual(["fill=empty", "fill=filled"]);
  });
});

describe("collection views", () => {
  it("table: records axis and labels", () => {
    const r = viewStates(table(eq("status", "done"), 10), docs, { now: NOW, limit: 100 });
    expect(labels(axis(r, "records"))).toEqual(["no records", "1 record", "1 record, optional values empty", "1 record, long text", "11 records"]);
    const state = r.states.find((s) => s.values["records"] === "one" && s.values["field:status"] === "v:done");
    expect(state?.label).toBe("status = done · 1 record · pages by total"); // the paging axis names its value in the label
    expect(state?.render).toMatchObject({ kind: "table", pageSize: 10 });
    expect(state?.render.kind === "table" && state.render.matching).toEqual(["rec-1"]);
  });

  it("table: default page size makes 26 records for the many state", () => {
    const r = viewStates(table(), docs, { now: NOW });
    const many = r.states.find((s) => s.values["records"] === "many");
    expect(many?.render.kind === "table" && many.render.records.length).toBe(26);
  });

  it("table: an all-empty record and a long-text record", () => {
    const r = viewStates(table(), docs, { now: NOW });
    const emptyRec = r.states.find((s) => s.values["records"] === "empty");
    const longRec = r.states.find((s) => s.values["records"] === "long");
    if (emptyRec?.render.kind !== "table" || longRec?.render.kind !== "table") throw new Error("missing");
    expect(emptyRec.render.records[0]?.values).toMatchObject({ title: "Sample text", status: null, due: null, amount: null, urgent: null, note: null, owner: null, agreed: true });
    const long = longRec.render.records[0]?.values["note"];
    expect(typeof long === "string" && long.length > 200).toBe(true);
    expect(longRec.render.records[0]?.values["status"]).toBe("doing"); // the longest option
  });

  it("filter boundaries decide which records match", () => {
    const t = table({ op: "gte", field: "amount", value: 10 });
    const r = viewStates(t, [entity, t], { now: NOW, limit: 100 });
    const matching = (n: number): readonly string[] | undefined => {
      const render = r.states.find((s) => s.values["field:amount"] === `v:${n}` && s.values["records"] === "one")?.render;
      return render?.kind === "table" ? render.matching : undefined;
    };
    expect(matching(9)).toEqual([]);
    expect(matching(10)).toEqual(["rec-1"]);
    expect(matching(11)).toEqual(["rec-1"]);
  });

  it("calendar: each mode, with records on the first and last visible day", () => {
    const r = viewStates(calendar, docs, { now: NOW, limit: 100 });
    expect(ids(axis(r, "mode"))).toEqual(["month", "week"]);
    const month = r.states.find((s) => s.values["mode"] === "month" && s.values["records"] === "edges");
    const week = r.states.find((s) => s.values["mode"] === "week" && s.values["records"] === "edges");
    if (month?.render.kind !== "calendar" || week?.render.kind !== "calendar") throw new Error("missing");
    expect(month.render.anchor).toBe("2026-10-17");
    expect(month.render.range).toEqual({ first: "2026-09-28", last: "2026-11-08" });
    expect(month.render.records.map((x) => x.values["due"])).toEqual(["2026-09-28", "2026-11-08"]);
    expect(week.render.range).toEqual({ first: "2026-10-12", last: "2026-10-18" });
    expect(week.render.records.map((x) => x.values["due"])).toEqual(["2026-10-12", "2026-10-18"]);
  });

  it("calendar: honours the view's modes and weekStartsOn", () => {
    const c: CalendarView = { ...calendar, modes: ["week"], weekStartsOn: 0 };
    const r = viewStates(c, [entity, c], { now: NOW, limit: 100 });
    expect(ids(axis(r, "mode"))).toEqual(["week"]);
    const week = r.states.find((s) => s.values["records"] === "edges");
    expect(week?.render.kind === "calendar" && week.render.range.first).toBe("2026-10-11");
  });

  it("board: each groupBy choice", () => {
    const r = viewStates(board, docs, { now: NOW, limit: 100 });
    expect(ids(axis(r, "group"))).toEqual(["status", "urgent"]);
    const grouped = r.states.filter((s) => s.values["group"] === "urgent");
    expect(grouped.every((s) => s.render.kind === "board" && s.render.groupBy === "urgent")).toBe(true);
    const many = r.states.find((s) => s.values["records"] === "many");
    expect(many?.render.kind === "board" && many.render.records.length).toBe(1001);
    // varied records fill every column
    const statuses = new Set(many?.render.kind === "board" ? many.render.records.map((x) => x.values["status"]) : []);
    expect(statuses).toEqual(new Set(["todo", "doing", "done"]));
  });

  it("manyRecords overrides the size of the many state", () => {
    const r = viewStates(board, docs, { now: NOW, manyRecords: 5 });
    const many = r.states.find((s) => s.values["records"] === "many");
    expect(many?.render.kind === "board" && many.render.records.length).toBe(5);
  });

  it("a row action's bound fields become axes", () => {
    const t: TableView = { ...table(), rowAction: { open: "other", bind: [{ field: "owner", to: "x" }] } };
    const r = viewStates(t, [entity, t], { now: NOW });
    expect(labels(axis(r, "field:owner"))).toEqual(["owner empty", "owner set"]);
  });
});

describe("generated records validate", () => {
  it("every record in every state validates against the entity", () => {
    const views = [table(), table(eq("status", "done")), calendar, board, table({ op: "gt", field: "amount", value: 500 })];
    for (const view of views) {
      const r = viewStates(view, [entity, view], { now: NOW, limit: 60, manyRecords: 30 });
      expect(r.states.length).toBeGreaterThan(0);
      for (const state of r.states) {
        if (state.render.kind === "form" || state.render.kind === "dashboard") continue;
        for (const record of state.render.records) expect(validateRecord(entity, record.values)).toEqual([]);
      }
    }
  });

  it("a state that cannot be built is skipped with a reason", () => {
    const broken: EntityDocument = { ...entity, fields: [{ id: "kind", label: "Kind", type: "select", required: true, options: { source: "static", values: [] } }] };
    const t: TableView = { ...table(), columns: [{ field: "kind" }] };
    const r = viewStates(t, [broken, t], { now: NOW });
    const withRecords = r.states.filter((s) => s.values["records"] !== "none");
    expect(withRecords).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.skipped[0]?.reason).toMatch(/not valid/);
  });

  it("a missing entity gives no states and says why", () => {
    const r = viewStates(table(), [], { now: NOW });
    expect(r.states).toEqual([]);
    expect(r.skipped).toEqual([{ id: "view", reason: 'entity "task" is not among the documents' }]);
  });
});

describe("dashboard", () => {
  const dash: DashboardView = {
    ...base,
    kind: "dashboard",
    id: "home",
    tabs: [
      { id: "overview", title: "Overview", items: [{ id: "w1", x: 0, y: 0, w: 6, h: 4, widget: "view", view: "task-table" }, { id: "w2", x: 6, y: 0, w: 6, h: 4, widget: "view", view: "task-form" }] },
      { id: "plain", title: "Plain", items: [{ id: "c1", x: 0, y: 0, w: 4, h: 2, widget: "count", label: "All", view: "task-table" }] },
    ],
  };
  const all: Document[] = [entity, form(eq("status", "done")), table(), dash];

  it("each tab, combined with the states of the views it embeds, within the limit", () => {
    const r = viewStates(dash, all, { now: NOW, limit: 10, embeddedLimit: 3 });
    expect(r.states.length).toBeLessThanOrEqual(10);
    expect(new Set(r.states.map((s) => s.values["tab"]))).toEqual(new Set(["overview", "plain"]));
    const overview = r.states.filter((s) => s.values["tab"] === "overview");
    for (const s of overview) {
      expect(s.render.kind === "dashboard" && s.render.widgets.map((w) => w.item)).toEqual(["w1", "w2"]);
    }
    const plain = r.states.filter((s) => s.values["tab"] === "plain");
    expect(plain).toHaveLength(1);
    expect(plain[0]?.render.kind === "dashboard" && plain[0].render.widgets).toEqual([]);
    expect(overview[0]?.label).toMatch(/^tab Overview · task-table: /);
  });

  it("covers every pair of embedded states when it fits", () => {
    const r = viewStates(dash, all, { now: NOW, limit: 100, embeddedLimit: 3 });
    const pairs = new Set(r.states.filter((s) => s.values["tab"] === "overview").map((s) => `${s.values["widget:w1"]}|${s.values["widget:w2"]}`));
    expect(pairs.size).toBe(9);
  });

  it("skips widgets whose view is missing and embedded dashboards", () => {
    const d: DashboardView = { ...dash, tabs: [{ id: "t", title: "T", items: [{ id: "w", x: 0, y: 0, w: 4, h: 2, widget: "view", view: "nope" }, { id: "d", x: 0, y: 0, w: 4, h: 2, widget: "view", view: "home" }] }] };
    const r = viewStates(d, [...all, d], { now: NOW });
    expect(r.states).toHaveLength(1);
    expect(r.skipped.map((s) => s.id).sort()).toEqual(["view:home", "view:nope"]);
  });
});

describe("limit and determinism", () => {
  it("never returns more than limit states and reports an incomplete cover", () => {
    const wide = viewStates(calendar, docs, { now: NOW, limit: 3 });
    expect(wide.states.length).toBeLessThanOrEqual(3);
    expect(wide.complete).toBe(false);
    for (const limit of [1, 2, 5, 12]) expect(viewStates(board, docs, { now: NOW, limit }).states.length).toBeLessThanOrEqual(limit);
  });

  it("the default limit is 24", () => {
    const f = form({ op: "and", conditions: [eq("status", "done"), { op: "gte", field: "amount", value: 3 }, { op: "lt", field: "due", value: { daysFromToday: 0 } }] });
    const r = viewStates(f, [entity, f], { now: NOW });
    expect(r.states.length).toBeLessThanOrEqual(24);
    expect(r.strategy).toBe("pairwise");
  });

  it("rejects a limit below 1", () => {
    expect(() => viewStates(table(), docs, { now: NOW, limit: 0 })).toThrow(RangeError);
  });

  it("the same input gives the same states in the same order", () => {
    const f = form({ op: "and", conditions: [eq("status", "done"), { op: "gte", field: "amount", value: 3 }, { op: "lt", field: "due", value: { daysFromToday: 0 } }] });
    const run = () => viewStates(f, [entity, f], { now: NOW, limit: 12 }).states.map((s) => s.id);
    expect(run()).toEqual(run());
    expect(new Set(run()).size).toBe(run().length);
  });
});

describe("combineAxes", () => {
  const axisOf = (id: string, n: number): CombinableAxis => ({ id, values: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}` })) });

  it("gives no axes one empty selection and skips empty axes", () => {
    expect(combineAxes([], 5).selections).toEqual([{}]);
    expect(combineAxes([axisOf("a", 0), axisOf("b", 2)], 5).selections).toEqual([{ b: "b0" }, { b: "b1" }]);
  });

  it("returns the full product, first axis slowest, when it fits", () => {
    const r = combineAxes([axisOf("a", 2), axisOf("b", 2)], 4);
    expect(r).toMatchObject({ strategy: "full", complete: true });
    expect(r.selections).toEqual([
      { a: "a0", b: "b0" },
      { a: "a0", b: "b1" },
      { a: "a1", b: "b0" },
      { a: "a1", b: "b1" },
    ]);
  });

  it("covers every pair of values when the product does not fit", () => {
    const axes = [axisOf("a", 4), axisOf("b", 3), axisOf("c", 5), axisOf("d", 2), axisOf("e", 4)];
    const r = combineAxes(axes, 60);
    expect(r.strategy).toBe("pairwise");
    expect(r.complete).toBe(true);
    expect(r.selections.length).toBeLessThan(4 * 3 * 5 * 2 * 4);
    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        for (const x of axes[i]?.values ?? []) {
          for (const y of axes[j]?.values ?? []) {
            const hit = r.selections.some((s) => s[axes[i]?.id ?? ""] === x.id && s[axes[j]?.id ?? ""] === y.id);
            expect(hit).toBe(true);
          }
        }
      }
    }
  });

  it("is deterministic and respects the limit", () => {
    const axes = [axisOf("a", 4), axisOf("b", 3), axisOf("c", 5)];
    expect(combineAxes(axes, 20)).toEqual(combineAxes(axes, 20));
    const cut = combineAxes(axes, 4);
    expect(cut.selections).toHaveLength(4);
    expect(cut.complete).toBe(false);
  });
});

describe("combineAxes with one axis", () => {
  it("keeps the values in order, cut at the limit", () => {
    const one: CombinableAxis = { id: "a", values: [{ id: "x" }, { id: "y" }, { id: "z" }] };
    expect(combineAxes([one], 2)).toMatchObject({ selections: [{ a: "x" }, { a: "y" }], complete: false });
  });
});

// --- viewer axes (RFC 0006) ---

const viewerDoc: ViewerDocument = {
  kind: "viewer",
  specVersion: 5,
  id: "viewer",
  revision: 1,
  facts: [
    { id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor", "owner"] }, default: "viewer" },
    { id: "beta", label: "Beta", type: "boolean", default: false },
    { id: "region", label: "Region", type: "select", options: { source: "static", values: ["eu", "us"] }, default: "eu" },
  ],
};
const roleIn = (...values: string[]): ViewerCondition => ({ op: "viewerIn", fact: "role", values });
const withViewer: Document[] = [...docs, viewerDoc];
const factValues = (state: { viewer: { facts: readonly { fact: string; value: string | boolean }[] } }): Record<string, string | boolean> =>
  Object.fromEntries(state.viewer.facts.map((f) => [f.fact, f.value]));

describe("viewer axes", () => {
  it("views that read no fact and have no edit surface are unchanged, with an empty or default viewer", () => {
    const plain = viewStates(table(), withViewer, { now: NOW });
    expect(plain.axes.map((a) => a.id)).toEqual(["records", "paging"]); // paging is a table axis (RFC 0007); boards and calendars keep theirs
    expect(plain.states.some((s) => s.omitViewer)).toBe(false);
    expect(plain.states.every((s) => s.viewer.facts.length === 3)).toBe(true);
    expect(viewStates(table(), docs, { now: NOW }).states.every((s) => s.viewer.facts.length === 0)).toBe(true);
  });

  it("a form gets one axis per fact it reads: named select values plus one everyone-else value", () => {
    const f = form({ op: "and", conditions: [roleIn("owner"), { op: "viewerIn", fact: "beta", values: [true] }] });
    const r = viewStates(f, withViewer, { now: NOW });
    expect(r.axes.map((a) => a.id)).toEqual(["fill", "viewer:role", "viewer:beta"]);
    expect(labels(axis(r, "viewer:role"))).toEqual(["role = viewer", "role = owner"]); // 3 roles, 1 named: 2 values
    expect(ids(axis(r, "viewer:beta"))).toEqual(["true", "false"]);
    expect(r.axes.some((a) => a.id === "viewer:region")).toBe(false);
    expect(axis(r, "viewer:role").kind).toBe("viewer");
  });

  it("each state carries the viewer it picks; facts nothing reads take their default", () => {
    const r = viewStates(form(roleIn("owner")), withViewer, { now: NOW });
    const owner = r.states.find((s) => s.values["viewer:role"] === "owner");
    expect(owner && factValues(owner)).toEqual({ role: "owner", beta: false, region: "eu" });
    const other = r.states.find((s) => s.values["viewer:role"] === "viewer");
    expect(other && factValues(other)).toEqual({ role: "viewer", beta: false, region: "eu" });
  });

  it("the everyone-else value is the default when no leaf names it, else the first unnamed value", () => {
    expect(ids(axis(viewStates(form(roleIn("viewer")), withViewer, { now: NOW }), "viewer:role"))).toEqual(["viewer", "editor"]);
    expect(ids(axis(viewStates(form(roleIn("editor", "owner")), withViewer, { now: NOW }), "viewer:role"))).toEqual(["viewer", "editor", "owner"]);
    expect(ids(axis(viewStates(form(roleIn("viewer", "editor", "owner")), withViewer, { now: NOW }), "viewer:role"))).toEqual(["viewer", "editor", "owner"]);
  });

  it("adds exactly one 'viewer not provided' state, rendered with the viewer omitted, equal to the all-defaults state", () => {
    const r = viewStates(form(roleIn("owner")), withViewer, { now: NOW });
    const extra = r.states.filter((s) => s.omitViewer);
    expect(extra.map((s) => s.id)).toEqual(["viewer-not-provided"]);
    expect(extra[0]?.label).toBe("viewer not provided");
    expect(extra[0] && factValues(extra[0])).toEqual({ role: "viewer", beta: false, region: "eu" });
    // The same render as the state with the same other axes and every viewer axis at its default.
    const twin = r.states.find((s) => !s.omitViewer && s.values["viewer:role"] === "viewer" && s.values["fill"] === extra[0]?.values["fill"]);
    expect(twin?.render).toEqual(extra[0]?.render);
    expect(twin && factValues(twin)).toEqual(extra[0] && factValues(extra[0]));
  });

  it("no 'viewer not provided' state without a viewer document or without a fact read", () => {
    expect(viewStates(form(), withViewer, { now: NOW }).states.some((s) => s.omitViewer)).toBe(false);
    expect(viewStates(form(roleIn("owner")), docs, { now: NOW }).states.some((s) => s.omitViewer)).toBe(false);
  });

  it("the extra state counts towards the limit", () => {
    const r = viewStates(form(roleIn("owner")), withViewer, { now: NOW, limit: 3 });
    expect(r.states).toHaveLength(3);
    expect(r.states[2]?.id).toBe("viewer-not-provided");
    expect(r.complete).toBe(false);
  });
});

describe("permission axis", () => {
  const editableTable: TableView = { ...table(), columns: [{ field: "title", editable: true }, { field: "status" }] };
  const editableBoard: BoardView = { ...board, editable: true };

  it("forms and read-only views have none; editable tables, calendars and boards have it", () => {
    expect(viewStates(form(), withViewer, { now: NOW }).axes.some((a) => a.id === "permission")).toBe(false);
    expect(viewStates(table(), withViewer, { now: NOW }).axes.some((a) => a.id === "permission")).toBe(false);
    for (const v of [editableTable, editableBoard, { ...calendar, editable: true }]) {
      const a = axis(viewStates(v, [...withViewer, v], { now: NOW }), "permission");
      expect(ids(a)).toEqual(["unrestricted", "record-locked"]);
      expect(a.kind).toBe("permission");
    }
  });

  it("record-locked marks the first record only; the others state nothing", () => {
    const r = viewStates(editableTable, [...withViewer, editableTable], { now: NOW });
    const locked = r.states.filter((s) => s.values["permission"] === "record-locked" && s.render.kind === "table" && s.render.records.length > 1);
    expect(locked.length).toBeGreaterThan(0);
    for (const s of locked) {
      if (s.render.kind !== "table") continue;
      expect(s.render.records[0]?.can).toEqual({ update: false });
      expect(s.render.records.slice(1).every((rec) => rec.can === undefined)).toBe(true);
    }
    const open = r.states.filter((s) => s.values["permission"] === "unrestricted");
    expect(open.every((s) => s.render.kind === "table" && s.render.records.every((rec) => rec.can === undefined))).toBe(true);
  });

  it("combines with viewer axes, and the not-provided state is unrestricted", () => {
    const v: TableView = { ...editableTable, columns: [{ field: "title", editable: true, editableWhen: roleIn("editor", "owner") }] };
    const r = viewStates(v, [...withViewer, v], { now: NOW });
    expect(r.axes.map((a) => a.id)).toEqual(["records", "paging", "viewer:role", "permission"]);
    const extra = r.states.find((s) => s.omitViewer);
    expect(extra?.values["permission"]).toBe("unrestricted");
    expect(extra?.render.kind === "table" && extra.render.records.every((rec) => rec.can === undefined)).toBe(true);
  });
});

describe("action and paging axes (RFC 0007)", () => {
  const actionsEntity: EntityDocument = {
    ...entity,
    actions: [
      { id: "apply", label: "Apply" },
      { id: "archive", label: "Archive", confirm: { message: "Archive this task?" } },
      { id: "orphan", label: "Orphan" },
    ],
  };
  const actionsTable: TableView = { ...table(), recordActions: ["apply", "archive"] };
  const actionDocs: Document[] = [actionsEntity, actionsTable];

  it("one axis per offered action, in the view's order, with available and withheld values", () => {
    const r = viewStates(actionsTable, actionDocs, { now: NOW });
    expect(r.axes.map((a) => a.id)).toEqual(["records", "action:apply", "action:archive", "paging"]);
    expect(ids(axis(r, "action:apply"))).toEqual(["available", "withheld"]);
    expect(labels(axis(r, "action:apply"))).toEqual(["apply available", "apply withheld on 1 record"]);
    expect(axis(r, "action:archive").kind).toBe("action");
  });

  it("actions the view does not offer, and ids the entity does not declare, add no axis", () => {
    const r = viewStates(actionsTable, actionDocs, { now: NOW });
    expect(r.axes.some((a) => a.id === "action:orphan")).toBe(false);
    const unknown: TableView = { ...table(), recordActions: ["apply", "nope"] };
    const u = viewStates(unknown, [actionsEntity, unknown], { now: NOW });
    expect(u.axes.map((a) => a.id)).toEqual(["records", "action:apply", "paging"]);
  });

  it("withheld sets can.actions on the first record only; available states state nothing", () => {
    const r = viewStates(actionsTable, actionDocs, { now: NOW, limit: 64 }); // the full product fits
    const both = r.states.filter((s) => s.values["action:apply"] === "withheld" && s.values["action:archive"] === "withheld" && s.render.kind === "table" && s.render.records.length > 1);
    expect(both.length).toBeGreaterThan(0);
    for (const s of both) {
      if (s.render.kind !== "table") continue;
      expect(s.render.records[0]?.can).toEqual({ actions: { apply: false, archive: false } });
      expect(s.render.records.slice(1).every((rec) => rec.can === undefined)).toBe(true);
    }
    const open = r.states.filter((s) => s.values["action:apply"] === "available" && s.values["action:archive"] === "available");
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((s) => s.render.kind === "table" && s.render.records.every((rec) => rec.can === undefined))).toBe(true);
  });

  it("a withheld action next to no records is left out, and the state label names the withholding", () => {
    const r = viewStates(actionsTable, actionDocs, { now: NOW, limit: 64 });
    expect(r.states.some((s) => s.values["records"] === "none" && s.values["action:apply"] === "withheld")).toBe(false);
    const hit = r.states.find((s) => s.values["records"] === "one" && s.values["action:apply"] === "withheld");
    expect(hit?.label).toContain("apply withheld on 1 record");
  });

  it("withheld combines with a locked record: can carries update false and the action false", () => {
    const v: TableView = { ...actionsTable, columns: [{ field: "title", editable: true }] };
    // Only actionsEntity and this table: findEntity/findView take the first match, so the plain entity/table in docs must stay out.
    // 5 (records) x 2 x 2 (actions) x 3 (paging) x 2 (permission) = 120: under it the full product is taken.
    const r = viewStates(v, [actionsEntity, viewerDoc, v], { now: NOW, limit: 128 });
    const hit = r.states.find((s) => s.values["permission"] === "record-locked" && s.values["action:apply"] === "withheld" && s.render.kind === "table" && s.render.records.length > 1);
    expect(hit).toBeDefined();
    expect(hit?.render.kind === "table" && hit.render.records[0]?.can).toEqual({ update: false, actions: { apply: false } });
  });

  it("a table's paging axis carries total, cursor-more and cursor-end on the render", () => {
    const r = viewStates(actionsTable, actionDocs, { now: NOW, limit: 48 });
    const a = axis(r, "paging");
    expect(ids(a)).toEqual(["total", "cursor-more", "cursor-end"]);
    expect(a.kind).toBe("paging");
    const pick = (paging: string, records: string): Extract<ViewStateRender, { kind: "table" }> | undefined =>
      r.states.find((s) => s.values["paging"] === paging && s.values["records"] === records)?.render as Extract<ViewStateRender, { kind: "table" }> | undefined;
    expect(pick("total", "one")).toMatchObject({ total: 1 });
    expect(pick("total", "one")).not.toHaveProperty("next");
    // Card 45c: `next` comes from runQuery, so it says what the matched set
    // says. One record on a 25-size page has no next page — the fabricated
    // `encodeCursor(pageSize)` this test used to pin was the grid lying.
    expect(pick("cursor-more", "one")).toMatchObject({ next: null });
    expect(pick("cursor-more", "one")).not.toHaveProperty("total");
    const many = pick("cursor-more", "many"); // many is pageSize+1 by construction
    expect(many).toMatchObject({ next: expect.stringMatching(/^c0:/) });
    expect(many).not.toHaveProperty("total");
    expect(pick("cursor-end", "one")).toMatchObject({ next: null });
    expect(pick("cursor-end", "one")).not.toHaveProperty("total");
    expect(pick("cursor-end", "many")).toMatchObject({ next: null }); // the axis names the last page, whatever the records choice
  });

  it("the state grid's matching follows the view's sort, as any adapter's page would (card 45c)", () => {
    const sorted: TableView = { ...table(), sort: [{ field: "amount", dir: "desc" }] };
    const r = viewStates(sorted, [entity, sorted], { now: NOW, limit: 48, manyRecords: 6 });
    const state = r.states.find((s) => s.values["records"] === "many");
    expect(state).toBeDefined();
    const render = state?.render;
    if (render?.kind !== "table") throw new Error("expected a table render");
    const amounts = render.matching.map((id) => render.records.find((rec) => rec.id === id)?.values["amount"]);
    expect(amounts.length).toBe(6);
    expect([...amounts].sort((a, b) => Number(b) - Number(a))).toEqual(amounts); // descending, empty last
  });

  it("a table whose filter a real adapter would reject is skipped with the adapter's message (card 45c)", () => {
    const viewerFiltered: TableView = { ...table(), filter: { op: "viewerIn", fact: "role", values: ["owner"] } as unknown as Condition };
    const r = viewStates(viewerFiltered, [entity, viewerFiltered], { now: NOW, limit: 48 });
    expect(r.states.filter((s) => s.values["records"] === "one")).toEqual([]);
    expect(r.skipped.some((s) => /viewer/.test(s.reason))).toBe(true);
  });

  it("calendars and boards have no paging axis", () => {
    expect(viewStates(calendar, docs, { now: NOW }).axes.some((a) => a.kind === "paging")).toBe(false);
    expect(viewStates(board, docs, { now: NOW }).axes.some((a) => a.kind === "paging")).toBe(false);
  });

  it("a dashboard embeds the action states inside its widget states", () => {
    const dash: DashboardView = { ...base, kind: "dashboard", id: "dash-actions", tabs: [{ id: "t", title: "T", items: [{ id: "w", x: 0, y: 0, w: 12, h: 4, widget: "view", view: "task-table" }] }] };
    const r = viewStates(dash, [...actionDocs, dash], { now: NOW, limit: 24, embeddedLimit: 12 });
    const hit = r.states.flatMap((s) => (s.render.kind === "dashboard" ? s.render.widgets : [])).find((w) => w.state.values["action:apply"] === "withheld");
    expect(hit?.state.render.kind === "table" && hit.state.render.records[0]?.can).toEqual({ actions: { apply: false } });
  });

  it("an old document without actions and without actions on the entity gains neither axis", () => {
    const r = viewStates(table(), docs, { now: NOW });
    expect(r.axes.some((a) => a.kind === "action")).toBe(false);
    expect(r.states.every((s) => s.render.kind !== "table" || s.render.records.every((rec) => rec.can === undefined))).toBe(true);
  });
});

describe("generated datetime (RFC 0007)", () => {
  const timedEntity: EntityDocument = { ...entity, fields: [...entity.fields, { id: "started", label: "Started", type: "datetime" }] };
  const timedTable: TableView = { ...table(), columns: [...table().columns, { field: "started" }] };
  const timedForm: FormView = { ...form(), sections: [{ id: "main", items: [{ field: "title" }, { field: "started" }] }] };
  const timedDocs: Document[] = [timedEntity, timedTable, timedForm];

  it("generated records carry the fixed instant in the stored form, at 09:30 UTC by default", () => {
    const r = viewStates(timedTable, timedDocs, { now: NOW });
    const one = r.states.find((s) => s.values["records"] === "one");
    expect(one?.render.kind === "table" && one.render.records[0]?.values["started"]).toBe("2026-10-17T09:30:00.000Z");
    const many = r.states.find((s) => s.values["records"] === "many");
    expect(many?.render.kind === "table" && many.render.records.every((rec) => rec.values["started"] === "2026-10-17T09:30:00.000Z")).toBe(true);
  });

  it("the timeZone option pins the instant to that zone's wall clock", () => {
    const r = viewStates(timedTable, timedDocs, { now: NOW, timeZone: "Europe/Berlin" });
    // 2026-10-17 is Berlin summer time (UTC+2): 09:30 there is 07:30 UTC.
    const one = r.states.find((s) => s.values["records"] === "one")?.render;
    expect(one?.kind === "table" && one.records[0]?.values["started"]).toBe("2026-10-17T07:30:00.000Z");
  });

  it("a filled form draft carries the same instant, and runs are deterministic", () => {
    const r = viewStates(timedForm, timedDocs, { now: NOW });
    const filled = r.states.find((s) => s.values["fill"] === "filled");
    expect(filled?.render.kind === "form" && filled.render.values["started"]).toBe("2026-10-17T09:30:00.000Z");
    const again = viewStates(timedForm, timedDocs, { now: NOW });
    expect(again.states.map((s) => s.id)).toEqual(r.states.map((s) => s.id));
  });
});

describe("impossible viewer combinations", () => {
  const editableTable: TableView = { ...table(), columns: [{ field: "title", editable: true }, { field: "status" }] };

  it("never lists a locked record next to no records", () => {
    const r = viewStates(editableTable, [...withViewer, editableTable], { now: NOW });
    const locked = r.states.filter((s) => s.values["permission"] === "record-locked");
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((s) => s.render.kind === "table" && s.render.records.length > 0 && s.render.records[0]?.can?.update === false)).toBe(true);
    expect(r.states.some((s) => s.values["records"] === "none" && s.values["permission"] === "record-locked")).toBe(false);
  });

  const two: DashboardView = {
    ...base,
    kind: "dashboard",
    id: "dash2",
    tabs: [
      { id: "all", title: "All", items: [{ id: "tasks", x: 0, y: 0, w: 12, h: 4, widget: "view", view: "task-table" }] },
      { id: "owners", title: "Owners", visibleWhen: roleIn("owner"), items: [{ id: "tasks2", x: 0, y: 0, w: 12, h: 4, widget: "view", view: "task-table" }] },
    ],
  };

  it("never lists a dashboard tab for a viewer who cannot see it", () => {
    const r = viewStates(two, [...withViewer, editableTable, two], { now: NOW });
    const roles = r.states.filter((s) => s.values["tab"] === "owners").map((s) => factValues(s)["role"]);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((role) => role === "owner")).toBe(true);
  });

  it("gives a viewer who sees no tab one state, on the first tab", () => {
    const hidden: DashboardView = { ...two, tabs: two.tabs.map((t) => ({ ...t, visibleWhen: roleIn("owner") })) };
    const r = viewStates(hidden, [...withViewer, editableTable, hidden], { now: NOW });
    const asViewer = r.states.filter((s) => factValues(s)["role"] === "viewer" && !s.omitViewer);
    expect(asViewer.every((s) => s.values["tab"] === "all")).toBe(true);
    expect(r.states.filter((s) => s.omitViewer)).toHaveLength(1);
  });
});

describe("viewer axes on a dashboard", () => {
  const editable: TableView = { ...table(), columns: [{ field: "title", editable: true }, { field: "status", visibleWhen: roleIn("owner") }] };
  const dash: DashboardView = {
    ...base,
    kind: "dashboard",
    id: "dash",
    tabs: [
      { id: "main", title: "Main", visibleWhen: { op: "viewerIn", fact: "beta", values: [true] }, items: [{ id: "tasks", x: 0, y: 0, w: 12, h: 4, widget: "view", view: "task-table" }] },
    ],
  };
  const all: Document[] = [...withViewer, editable, dash].filter((d) => d.id !== "task-table" || d === editable);

  it("owns the viewer axes of the whole tree and applies them to every widget state", () => {
    const r = viewStates(dash, all, { now: NOW, embeddedLimit: 2 });
    expect(r.axes.map((a) => a.id)).toEqual(["tab", "widget:tasks", "viewer:role", "viewer:beta", "permission"]);
    for (const s of r.states) {
      for (const w of s.render.kind === "dashboard" ? s.render.widgets : []) {
        expect(w.state.viewer).toEqual(s.viewer);
        expect(w.state.values["viewer:role"]).toBeUndefined();
      }
    }
    const extra = r.states.filter((s) => s.omitViewer);
    expect(extra).toHaveLength(1);
    expect(extra[0] && factValues(extra[0])).toEqual({ role: "viewer", beta: false, region: "eu" });
  });

  it("embedded views contribute no viewer axes of their own", () => {
    const r = viewStates(dash, all, { now: NOW });
    expect(r.axes.filter((a) => a.kind === "viewer")).toHaveLength(2);
  });
});

describe("series widgets (RFC 0001 slice 2, card 43g)", () => {
  const seriesItem = { id: "s1", x: 0, y: 0, w: 6, h: 4, widget: "series" as const, label: "By status", view: "task-table", groupBy: { field: "status" }, measure: { op: "count" as const }, display: "bar" as const };
  const seriesDash = (items: DashboardView["tabs"][number]["items"]): DashboardView => ({ ...base, kind: "dashboard", id: "dash-series", tabs: [{ id: "t", title: "T", items }] });
  const seriesDocs = (d: DashboardView): Document[] => [entity, form(), table(), d];
  const seriesOf = (s: ViewState): readonly SeriesStateWidget[] => (s.render.kind === "dashboard" ? s.render.series ?? [] : []);

  it("a series widget adds a groups axis with none, one, many and partial", () => {
    const d = seriesDash([seriesItem]);
    const r = viewStates(d, seriesDocs(d), { now: NOW, limit: 200 });
    expect(ids(axis(r, "widget:s1"))).toEqual(["none", "one", "many", "partial"]);
    expect(labels(axis(r, "widget:s1"))).toEqual(["no groups", "1 group", "3 groups", "3 groups, partial read"]);
    const values = new Set(r.states.map((s) => s.values["widget:s1"]));
    expect(values).toEqual(new Set(["none", "one", "many", "partial"]));
  });

  it("state ids stay readable: the axis id is short, the value carries the group count", () => {
    const d = seriesDash([seriesItem]);
    const r = viewStates(d, seriesDocs(d), { now: NOW, limit: 200 });
    const many = r.states.find((s) => s.values["widget:s1"] === "many");
    expect(many?.id).toContain("widget:s1=many");
    expect(many?.label).toContain("3 groups");
  });

  it("the seeded records make exactly the picked number of groups", () => {
    const d = seriesDash([seriesItem]);
    const r = viewStates(d, seriesDocs(d), { now: NOW, limit: 200 });
    const distinct = (records: readonly DataRecord[]): number => new Set(records.map((rec) => rec.values["status"]).filter((v) => v !== null && v !== undefined && v !== "")).size;
    for (const pick of ["none", "one", "many"] as const) {
      const state = r.states.find((s) => s.values["widget:s1"] === pick);
      expect(state).toBeDefined();
      const widget = seriesOf(state!)[0];
      expect(widget?.item).toBe("s1");
      expect(widget?.view).toBe("task-table");
      expect(widget?.groupBy).toBe("status");
      expect(widget?.partial).toBe(false);
      expect(distinct(widget?.records ?? [])).toBe(pick === "none" ? 0 : pick === "one" ? 1 : 3);
    }
  });

  it("partial seeds a table over the aggregate cap and says so", () => {
    const d = seriesDash([seriesItem]);
    const r = viewStates(d, seriesDocs(d), { now: NOW, limit: 200 });
    const state = r.states.find((s) => s.values["widget:s1"] === "partial");
    const widget = seriesOf(state!)[0];
    expect(widget?.partial).toBe(true);
    expect(widget?.groups).toBe("many");
    expect(widget?.records.length).toBeGreaterThan(AGGREGATE_MAX_RECORDS);
  });

  it("a date series buckets by month when the widget asks for months", () => {
    const monthItem = { ...seriesItem, groupBy: { field: "due", bucket: "month" as const } };
    const d = seriesDash([monthItem]);
    const r = viewStates(d, seriesDocs(d), { now: NOW, limit: 200 });
    const state = r.states.find((s) => s.values["widget:s1"] === "many");
    const widget = seriesOf(state!)[0];
    const months = new Set((widget?.records ?? []).map((rec) => String(rec.values["due"]).slice(0, 7)));
    expect(months.size).toBe(3);
  });

  it("a select with fewer options than many gets only the achievable states", () => {
    const narrow: EntityDocument = { ...entity, fields: entity.fields.map((f) => (f.id === "status" ? { ...f, options: { source: "static", values: ["a", "b"] } } : f)) };
    const d = seriesDash([seriesItem]);
    const r = viewStates(d, [narrow, form(), table(), d], { now: NOW, limit: 200 });
    expect(ids(axis(r, "widget:s1"))).toEqual(["none", "one"]);
  });

  it("a series over a missing field or a non-table view is skipped, not blank", () => {
    const bad = seriesDash([{ ...seriesItem, id: "b1", groupBy: { field: "nope" } }, { ...seriesItem, id: "b2", view: "task-form" }]);
    const r = viewStates(bad, [entity, form(), table(), bad], { now: NOW, limit: 200 });
    expect(r.skipped.map((s) => s.id).sort()).toEqual(["series:b1", "series:b2"]);
    expect(r.axes.some((a) => a.id === "widget:b1" || a.id === "widget:b2")).toBe(false);
    expect(r.states.every((s) => seriesOf(s).length === 0)).toBe(true);
  });

  it("a series widget alone still produces a state per group value", () => {
    const d = seriesDash([{ id: "c1", x: 0, y: 0, w: 4, h: 2, widget: "count", label: "All", view: "task-table" }, seriesItem]);
    const r = viewStates(d, seriesDocs(d), { now: NOW, limit: 200 });
    const byGroup = new Set(r.states.map((s) => s.values["widget:s1"]));
    expect(byGroup).toEqual(new Set(["none", "one", "many", "partial"]));
  });
});

describe("saved filter and doneField axes (RFC 0008/0009)", () => {
  const saved: TableView = {
    ...table(),
    filters: [
      { id: "open", name: "Open", condition: eq("urgent", false) },
      { id: "urgent", name: "Urgent", condition: eq("urgent", true) },
    ],
  };

  it("a table with saved filters gets a filter axis: none, then one value per filter", () => {
    const r = viewStates(saved, [entity, saved], { now: NOW, limit: 500 });
    const a = r.axes.find((x) => x.id === "filter");
    expect(a?.kind).toBe("filter");
    expect(a?.values.map((v) => v.id)).toEqual(["none", "filter:open", "filter:urgent"]);
    expect(r.states.some((s) => s.values["filter"] === "none")).toBe(true);
  });

  it("a lit filter is on the render and narrows matching; none leaves it off", () => {
    const r = viewStates(saved, [entity, saved], { now: NOW, limit: 500 });
    const lit = r.states.filter((s) => s.render.kind === "table" && s.render.savedFilter === "urgent");
    expect(lit.length).toBeGreaterThan(0);
    for (const s of lit) {
      if (s.render.kind !== "table") continue;
      const urgent = s.render.records.filter((rec) => rec.values["urgent"] === true).map((rec) => rec.id);
      expect([...s.render.matching]).toEqual(urgent);
    }
    const none = r.states.filter((s) => s.values["filter"] === "none");
    expect(none.every((s) => s.render.kind === "table" && s.render.savedFilter === undefined)).toBe(true);
  });

  it("a table whose quick filter has a default gets a quick axis; the render says which state it is", () => {
    const q: TableView = { ...table(), quickFilters: [{ field: "urgent", default: true }] };
    const r = viewStates(q, [entity, q], { now: NOW, limit: 500 });
    const a = r.axes.find((x) => x.id === "quick");
    expect(a?.kind).toBe("quick");
    expect(a?.values.map((v) => v.id)).toEqual(["applied", "cleared"]);
    const seen = new Set(r.states.map((s) => (s.render.kind === "table" ? s.render.quickDefaults : undefined)));
    expect(seen).toEqual(new Set(["applied", "cleared"]));
    const plain: TableView = { ...table(), quickFilters: [{ field: "urgent" }] };
    expect(viewStates(plain, [entity, plain], { now: NOW }).axes.some((x) => x.id === "quick")).toBe(false);
  });

  it("a table without saved filters has no filter axis", () => {
    expect(viewStates(table(), docs, { now: NOW }).axes.some((a) => a.id === "filter")).toBe(false);
  });

  it("a board with a doneField varies done both ways and gains the permission axis that disables the toggle", () => {
    const b: BoardView = { ...board, doneField: "urgent" };
    const r = viewStates(b, [entity, b], { now: NOW, limit: 500 });
    expect(r.axes.find((a) => a.id === "done")?.values.map((v) => v.id)).toEqual(["done-true", "done-false"]);
    expect(r.axes.some((a) => a.id === "permission")).toBe(true);
    const locked = r.states.find((s) => s.values["permission"] === "record-locked");
    expect(locked?.render.kind === "board" && locked.render.records[0]?.can?.update).toBe(false);
  });
});

describe("stored records with a server-set field", () => {
  const logEntity: EntityDocument = {
    kind: "entity",
    specVersion: 4,
    id: "log",
    revision: 1,
    fields: [
      { id: "id", type: "reference", entity: "log", label: "Log id", required: true, readOnly: true },
      { id: "day", type: "date", label: "Day", required: true },
      { id: "title", type: "text", label: "Title", required: true },
      { id: "kind", type: "select", label: "Kind", options: { source: "static", values: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] } },
    ],
  };
  const logTable: TableView = { ...base, kind: "table", id: "log-table", entity: "log", columns: [{ field: "day" }, { field: "title" }, { field: "kind" }] };
  const logDash: DashboardView = {
    ...base,
    kind: "dashboard",
    id: "log-dash",
    tabs: [{ id: "t", title: "T", items: [{ id: "s1", x: 0, y: 0, w: 6, h: 4, widget: "series", label: "By kind", view: "log-table", groupBy: { field: "day", bucket: "week" }, measure: { op: "count" }, display: "bar" }] }],
  };
  const logDocs: Document[] = [logEntity, logTable, logDash];

  it("a table with a required readOnly id skips no state", () => {
    const r = viewStates(logTable, logDocs, { now: NOW, limit: 200 });
    expect(r.skipped).toEqual([]);
    expect(r.states.some((s) => s.render.kind === "table" && s.render.records.length > 0)).toBe(true);
    for (const s of r.states) if (s.render.kind === "table") for (const rec of s.render.records) expect(validateRecord(logEntity, rec.values, { mode: "stored" })).toEqual([]);
  });

  it("a dashboard with a series widget keeps its widget axis", () => {
    const r = viewStates(logDash, logDocs, { now: NOW, limit: 200 });
    expect(r.skipped).toEqual([]);
    expect(ids(axis(r, "widget:s1")).length).toBeGreaterThan(1);
  });

  it("validateRecord: write refuses a readOnly value, stored accepts it and requires it", () => {
    expect(validateRecord(logEntity, { id: "x", day: "2026-10-17", title: "T" })[0]?.message).toContain("set by the server");
    expect(validateRecord(logEntity, { id: "x", day: "2026-10-17", title: "T" }, { mode: "stored" })).toEqual([]);
    expect(validateRecord(logEntity, { day: "2026-10-17", title: "T" }, { mode: "stored" })[0]?.code).toBe("required");
    expect(validateRecord(logEntity, { day: "2026-10-17", title: "T" })).toEqual([]);
  });

  it("a filter on a readOnly field gets a field axis, with stored values", () => {
    const filtered: TableView = { ...logTable, id: "log-filtered", filter: eq("id", "rec-9") };
    const r = viewStates(filtered, [...logDocs, filtered], { now: NOW, limit: 200 });
    expect(r.skipped).toEqual([]);
    expect(ids(axis(r, "field:id")).length).toBeGreaterThan(1);
  });
});
