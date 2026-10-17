import { describe, expect, it } from "vitest";
import type { BoardView, CalendarView, Condition, DashboardView, Document, EntityDocument, FormView, TableView } from "@yadad/core";
import { combineAxes } from "./combine-axes.js";
import type { CombinableAxis } from "./combine-axes.js";
import { validateRecord } from "./record.js";
import { viewStates } from "./view-states.js";
import type { StateAxis, ViewStatesResult } from "./view-states.js";

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
    const state = r.states.find((s) => s.label === "status = done · 1 record");
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
