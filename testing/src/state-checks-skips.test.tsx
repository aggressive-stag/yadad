// @vitest-environment jsdom
import type { DashboardView, Document, EntityDocument, TableView } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { checkViewStatesReport, problems } from "./state-checks.js";

const NOW = new Date(2026, 9, 17, 12, 0, 0);
const base = { specVersion: 4 as const, revision: 1, dataSource: "default", entity: "task" };
const good: EntityDocument = { kind: "entity", specVersion: 4, id: "task", revision: 1, fields: [{ id: "title", type: "text", label: "Title", required: true }] };
// A required select with no options: the grid cannot generate a valid record for it.
const broken: EntityDocument = { ...good, fields: [{ id: "kind", type: "select", label: "Kind", required: true, options: { source: "static", values: [] } }] };
const table: TableView = { ...base, kind: "table", id: "task_table", columns: [{ field: "title" }] };
const brokenTable: TableView = { ...table, columns: [{ field: "kind" }] };
const render = (): null => null;
// The stub render shows nothing, so only the grid-level checks are meaningful here.
const gridProblems = (report: { results: Parameters<typeof problems>[0] }): string[] => problems(report.results).filter((p) => /: (grid-fault|too-many-skipped|axis-missing): /.test(p));

describe("loud skips", () => {
  test("an entity whose generated record is invalid fails with grid-fault", async () => {
    const documents: Document[] = [broken, brokenTable];
    const report = await checkViewStatesReport({ view: brokenTable, documents, now: NOW, render });
    expect(problems(report.results).some((p) => p.includes("grid-fault") && /not valid/.test(p))).toBe(true);
    expect(report.skippedStates.some((s) => s.kind === "fault")).toBe(true);
    expect(report.skipped).toBe(report.skippedStates.length);
    const quiet = await checkViewStatesReport({ view: brokenTable, documents, now: NOW, render, skip: ["grid-fault"] });
    expect(problems(quiet.results).filter((p) => p.includes("grid-fault"))).toEqual([]);
  });

  const nested: DashboardView = { ...base, kind: "dashboard", id: "home", tabs: [{ id: "t", title: "T", items: [{ id: "d", x: 0, y: 0, w: 4, h: 2, widget: "view", view: "inner" }] }] };
  const inner: DashboardView = { ...nested, id: "inner", tabs: [{ id: "t", title: "T", items: [{ id: "c", x: 0, y: 0, w: 4, h: 2, widget: "count", label: "All", view: "task_table" }] }] };
  const documents: Document[] = [good, table, nested, inner];

  test("a dashboard embedding a dashboard is a plain limit skip", async () => {
    const report = await checkViewStatesReport({ view: nested, documents, now: NOW, render });
    expect(report.skippedStates).toEqual([expect.objectContaining({ id: "view:inner", kind: "limit" })]);
    expect(gridProblems(report)).toEqual([]);
  });

  test("maxSkipped: 0 fails a view with one limit skip", async () => {
    const report = await checkViewStatesReport({ view: nested, documents, now: NOW, render, maxSkipped: 0 });
    expect(gridProblems(report)).toEqual([expect.stringContaining("too-many-skipped")]);
    const roomy = await checkViewStatesReport({ view: nested, documents, now: NOW, render, maxSkipped: 1 });
    expect(gridProblems(roomy)).toEqual([]);
  });
});
