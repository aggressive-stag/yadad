import { describe, expect, test } from "vitest";
import type { DashboardView, Document, FormView, ResolvedViewer, TableView, ViewerCondition, ViewerDocument } from "@yadad/core";
import {
  canUpdate,
  columnEditable,
  findViewerDocument,
  resolveViewer,
  rowActionVisible,
  viewEditable,
  viewerFactsRead,
  viewerLeavesRead,
  visibleColumns,
  visibleItems,
  visibleTabs,
} from "./viewer.js";

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

const asRole = (role: string, beta = false): ResolvedViewer => resolveViewer(viewerDoc, [{ fact: "role", value: role }, { fact: "beta", value: beta }]).viewer;
const role = (...values: string[]): ViewerCondition => ({ op: "viewerIn", fact: "role", values });

describe("resolveViewer", () => {
  test("no input gives every declared fact its default, in declaration order", () => {
    const { viewer, issues } = resolveViewer(viewerDoc);
    expect(viewer.facts).toEqual([
      { fact: "role", value: "viewer" },
      { fact: "beta", value: false },
      { fact: "region", value: "eu" },
    ]);
    expect(issues).toEqual([]);
  });

  test("valid input wins, in declaration order whatever the input order", () => {
    const { viewer, issues } = resolveViewer(viewerDoc, [{ fact: "region", value: "us" }, { fact: "role", value: "owner" }]);
    expect(viewer.facts.map((f) => [f.fact, f.value])).toEqual([["role", "owner"], ["beta", false], ["region", "us"]]);
    expect(issues).toEqual([]);
  });

  test("an unknown fact is ignored and reported with the declared ids", () => {
    const { viewer, issues } = resolveViewer(viewerDoc, [{ fact: "plan", value: "pro" }]);
    expect(viewer.facts).toHaveLength(3);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: "/0/fact", code: "unknown-reference", allowed: ["role", "beta", "region"] });
  });

  test("a duplicate entry is reported and the first wins", () => {
    const { viewer, issues } = resolveViewer(viewerDoc, [{ fact: "role", value: "editor" }, { fact: "role", value: "owner" }]);
    expect(viewer.facts[0]).toEqual({ fact: "role", value: "editor" });
    expect(issues.map((i) => [i.path, i.code])).toEqual([["/1/fact", "invalid-value"]]);
  });

  test("a value of the wrong type or outside the list falls back to the default, others unaffected", () => {
    const { viewer, issues } = resolveViewer(viewerDoc, [
      { fact: "role", value: true },
      { fact: "beta", value: "yes" },
      { fact: "region", value: "asia" },
    ]);
    expect(viewer.facts.map((f) => f.value)).toEqual(["viewer", false, "eu"]);
    expect(issues.map((i) => [i.path, i.code])).toEqual([["/0/value", "type"], ["/1/value", "type"], ["/2/value", "invalid-value"]]);
    expect(issues[2]?.allowed).toEqual(["eu", "us"]);
    const mixed = resolveViewer(viewerDoc, [{ fact: "role", value: "stale" }, { fact: "beta", value: true }]);
    expect(mixed.viewer.facts.map((f) => f.value)).toEqual(["viewer", true, "eu"]);
  });

  test("with no document the viewer has no facts; it never throws on garbage", () => {
    expect(resolveViewer(undefined).viewer).toEqual({ facts: [] });
    expect(resolveViewer(undefined, [{ fact: "role", value: "x" }]).issues[0]?.code).toBe("unknown-reference");
    const garbage = [null, 3, "x", { fact: 4 }, { value: 1 }] as unknown as readonly { fact: string; value: string }[];
    expect(() => resolveViewer(viewerDoc, garbage)).not.toThrow();
    expect(resolveViewer(viewerDoc, garbage).viewer.facts).toHaveLength(3);
    expect(resolveViewer(viewerDoc, "nope" as unknown as readonly []).issues).toEqual([]);
  });
});

test("findViewerDocument returns the viewer document of a set", () => {
  const table = { kind: "entity", specVersion: 5, id: "e", revision: 1, fields: [] } as const;
  expect(findViewerDocument([table, viewerDoc])).toBe(viewerDoc);
  expect(findViewerDocument([table])).toBeUndefined();
});

const table: TableView = {
  kind: "table",
  specVersion: 5,
  id: "tasks",
  revision: 1,
  entity: "task",
  dataSource: "tasks",
  columns: [
    { field: "title", editable: true },
    { field: "cost", visibleWhen: role("owner") },
    { field: "status", editable: true, editableWhen: role("editor", "owner") },
    { field: "note", editable: false, editableWhen: role("owner") },
  ],
  rowAction: { open: "detail", bind: [{ field: "title", to: "title" }], visibleWhen: { op: "not", condition: role("viewer") } },
};

describe("view predicates", () => {
  test("visibleColumns hides columns whose condition is false", () => {
    expect(visibleColumns(table, asRole("viewer")).map((c) => c.field)).toEqual(["title", "status", "note"]);
    expect(visibleColumns(table, asRole("owner")).map((c) => c.field)).toEqual(["title", "cost", "status", "note"]);
  });

  test("columnEditable needs editable and, when set, editableWhen; it never grants", () => {
    const [title, , status, note] = table.columns;
    if (!title || !status || !note) throw new Error("fixture");
    expect(columnEditable(title, asRole("viewer"))).toBe(true);
    expect(columnEditable(status, asRole("viewer"))).toBe(false);
    expect(columnEditable(status, asRole("editor"))).toBe(true);
    expect(columnEditable(note, asRole("owner"))).toBe(false);
  });

  test("viewEditable and rowActionVisible", () => {
    const calendar = { editable: true, editableWhen: role("owner") } as const;
    expect(viewEditable({ ...calendar, kind: "calendar" } as never, asRole("owner"))).toBe(true);
    expect(viewEditable({ ...calendar, kind: "board" } as never, asRole("editor"))).toBe(false);
    expect(viewEditable({ kind: "board", editable: true } as never, asRole("viewer"))).toBe(true);
    expect(viewEditable({ kind: "board", editableWhen: role("owner", "editor", "viewer") } as never, asRole("owner"))).toBe(false);
    if (!table.rowAction) throw new Error("fixture");
    expect(rowActionVisible(table.rowAction, asRole("viewer"))).toBe(false);
    expect(rowActionVisible(table.rowAction, asRole("editor"))).toBe(true);
    expect(rowActionVisible({ open: "x", bind: [] }, asRole("viewer"))).toBe(true);
  });

  const dashboard: DashboardView = {
    kind: "dashboard",
    specVersion: 5,
    id: "dash",
    revision: 1,
    tabs: [
      { id: "a", title: "A", items: [{ id: "i1", x: 0, y: 0, w: 6, h: 2, widget: "view", view: "tasks" }, { id: "i2", x: 6, y: 0, w: 6, h: 2, widget: "view", view: "tasks", visibleWhen: role("owner") }] },
      { id: "b", title: "B", visibleWhen: role("owner"), items: [] },
    ],
  };

  test("visibleTabs and visibleItems keep order and positions", () => {
    expect(visibleTabs(dashboard, asRole("viewer")).map((t) => t.id)).toEqual(["a"]);
    expect(visibleTabs(dashboard, asRole("owner")).map((t) => t.id)).toEqual(["a", "b"]);
    const tab = dashboard.tabs[0];
    if (!tab) throw new Error("fixture");
    expect(visibleItems(tab, asRole("viewer")).map((i) => i.id)).toEqual(["i1"]);
    expect(visibleItems(tab, asRole("viewer"))[0]).toMatchObject({ x: 0, y: 0 });
    expect(visibleItems(tab, asRole("owner")).map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  test("canUpdate is false only for an explicit can.update: false", () => {
    const record = { id: "1", entityId: "e", entityRevision: 1, version: "1", values: {} };
    expect(canUpdate(record)).toBe(true);
    expect(canUpdate({ ...record, can: {} })).toBe(true);
    expect(canUpdate({ ...record, can: { update: true } })).toBe(true);
    expect(canUpdate({ ...record, can: { delete: false } })).toBe(true);
    expect(canUpdate({ ...record, can: { update: false } })).toBe(false);
  });
});

describe("viewerFactsRead", () => {
  const form: FormView = {
    kind: "form",
    specVersion: 5,
    id: "f",
    revision: 1,
    entity: "task",
    dataSource: "tasks",
    sections: [{ id: "s", items: [{ field: "a", visibleWhen: { op: "and", conditions: [{ op: "empty", field: "b" }, { op: "viewerIn", fact: "region", values: ["us"] }] } }] }],
  };
  const { rowAction: _unused, ...tableNoAction } = table;
  const detail: TableView = { ...tableNoAction, id: "detail", columns: [{ field: "x", visibleWhen: { op: "viewerIn", fact: "beta", values: [true] } }] };
  const docs: Document[] = [viewerDoc, form, table, detail];

  test("a form reads the facts in its conditions", () => {
    expect(viewerFactsRead(form, docs)).toEqual(["region"]);
    expect(viewerLeavesRead(form, docs)).toEqual([{ fact: "region", values: ["us"] }]);
  });

  test("a table reads its columns and the view its row action opens, declared facts in declaration order", () => {
    expect(viewerFactsRead(table, docs)).toEqual(["role", "beta"]);
  });

  test("a dashboard reads tabs, items and embedded views; cycles are safe", () => {
    const dash: DashboardView = {
      kind: "dashboard",
      specVersion: 5,
      id: "dash",
      revision: 1,
      tabs: [{ id: "a", title: "A", visibleWhen: { op: "viewerIn", fact: "region", values: ["us"] }, items: [{ id: "i", x: 0, y: 0, w: 1, h: 1, widget: "view", view: "tasks" }] }],
    };
    expect(viewerFactsRead(dash, [...docs, dash])).toEqual(["role", "beta", "region"]);
    const loopA: TableView = { ...detail, id: "a", rowAction: { open: "b", bind: [] } };
    const loopB: TableView = { ...detail, id: "b", rowAction: { open: "a", bind: [] } };
    expect(viewerFactsRead(loopA, [viewerDoc, loopA, loopB])).toEqual(["beta"]);
  });

  test("a view that reads nothing reads no facts", () => {
    expect(viewerFactsRead({ ...detail, columns: [{ field: "x" }] }, docs)).toEqual([]);
  });
});
