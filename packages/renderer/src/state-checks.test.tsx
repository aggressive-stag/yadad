// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Document, EntityDocument, ViewDocument, ViewerDocument } from "@yadad/core";
import { validateDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, checkViewStatesReport, problems } from "@yadad/testing/state-checks";
import type { CheckViewStatesOptions } from "@yadad/testing/state-checks";
import { describe, expect, test } from "vitest";
import { BoardRenderer } from "./board-renderer.js";
import { CalendarRenderer } from "./calendar-renderer.js";
import { DashboardRenderer } from "./dashboard-renderer.js";
import type { DocumentSet } from "./document-set.js";
import { FormRenderer } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

const NOW = new Date(2026, 9, 15, 10, 0, 0);

const dir = join(import.meta.dirname, "../../../fixtures/valid");
const documents: Document[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const doc: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const result = validateDocument(doc);
    if (!result.ok) throw new Error(`${f} is invalid`);
    return result.value;
  });

const entities = new Map(documents.filter((d): d is EntityDocument => d.kind === "entity").map((d) => [d.id, d]));
const views = new Map(documents.filter((d): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer").map((d) => [d.id, d]));
const viewerDocument = documents.find((d): d is ViewerDocument => d.kind === "viewer");
const set: DocumentSet = { entities, views, ...(viewerDocument ? { viewer: viewerDocument } : {}) };

/**
 * The one-line wiring per view kind: this is what a host app writes. A set of
 * documents (loose fixtures or one JSON set) picks which entity map and which
 * whole-set bundle the renderers get; everything else is identical.
 */
const renderFor = (entityMap: Map<string, EntityDocument>, documentSet: DocumentSet): CheckViewStatesOptions["render"] =>
  (state, { view, entity, registry, dataSources, drafts, now, viewer, omitViewer }) => {
    const v = omitViewer ? {} : { viewer };
    switch (view.kind) {
      case "form":
        return <FormRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entityMap} documents={documentSet} {...(drafts ? { drafts } : {})} {...v} />;
      case "table":
        return <TableRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entityMap} documents={documentSet} {...(state.render.kind === "table" && state.render.savedFilter !== undefined ? { savedFilter: state.render.savedFilter } : {})} {...v} />;
      case "calendar":
        return <CalendarRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entityMap} documents={documentSet} now={now} {...(state.render.kind === "calendar" ? { initialMode: state.render.mode, initialAnchor: state.render.anchor } : {})} {...v} />;
      case "board":
        return <BoardRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entityMap} documents={documentSet} {...(state.render.kind === "board" ? { groupBy: state.render.groupBy } : {})} {...v} />;
      case "dashboard":
        return <DashboardRenderer dashboard={view} documents={documentSet} registry={registry} dataSources={dataSources} {...v} />;
    }
  };

const render = renderFor(entities, set);

describe("every state of every fixture view", () => {
  test.each([...views.values()].map((v) => [v.id, v] as const))("%s", async (_id, view) => {
    const results = await checkViewStates({ view, documents, registry: mockRegistry, now: NOW, manyRecords: 40, render });
    expect(results.length).toBeGreaterThan(0);
    expect(problems(results)).toEqual([]);
  }, 60_000);
});

// RFC 0007 (card 35j): the sets are where the review fixtures live — a set is
// one JSON array, so its views need the set's own entity map, not the loose
// files'. Every view in every set sweeps like the loose fixtures above.
const setDir = join(import.meta.dirname, "../../../fixtures/valid-sets");
for (const file of readdirSync(setDir).filter((f) => f.endsWith(".json"))) {
  const setDocs: unknown[] = JSON.parse(readFileSync(join(setDir, file), "utf8"));
  const parsed: Document[] = setDocs.map((doc, i) => {
    const result = validateDocument(doc);
    if (!result.ok) throw new Error(`${file}[${i}] is invalid`);
    return result.value;
  });
  const setEntities = new Map(parsed.filter((d): d is EntityDocument => d.kind === "entity").map((d) => [d.id, d]));
  const setViewer = parsed.find((d): d is ViewerDocument => d.kind === "viewer");
  const setSet: DocumentSet = { entities: setEntities, views: new Map(parsed.filter((d): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer").map((d) => [d.id, d])), ...(setViewer ? { viewer: setViewer } : {}) };
  const setRender = renderFor(setEntities, setSet);
  describe(`fixtures/valid-sets/${file}`, () => {
    test.each([...setSet.views.values()].map((v) => [v.id, v] as const))("%s", async (_id, view) => {
      const results = await checkViewStates({ view, documents: parsed, registry: mockRegistry, now: NOW, manyRecords: 40, render: setRender });
      expect(results.length).toBeGreaterThan(0);
      expect(problems(results)).toEqual([]);
    }, 60_000);
  });

  // Card 40c, the real trigger: the review set's decision_records table has a
  // reference column at "record_version". Wired like the set above it checks
  // green; with the target entity missing from the renderer's `entities` — the
  // mistake a host makes — the renderer's yadad: warning is now a problem.
  if (file === "review.json") {
    test("a reference column whose target entity is not passed is a yadad-warning", async () => {
      const view = setSet.views.get("decision_records")!;
      const wired = await checkViewStates({ view, documents: parsed, registry: mockRegistry, now: NOW, manyRecords: 40, render: setRender });
      expect(problems(wired).filter((p) => p.includes("yadad-warning"))).toEqual([]);

      const missingTarget = new Map([...setEntities].filter(([id]) => id !== "record_version"));
      const unwiredRender = renderFor(missingTarget, setSet);
      const unwired = await checkViewStates({ view, documents: parsed, registry: mockRegistry, now: NOW, manyRecords: 40, render: unwiredRender });
      const flagged = unwired.filter((r) => r.problems.some((p) => p.check === "yadad-warning"));
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged[0]!.problems[0]!.message).toContain('points at entity "record_version"');
    }, 60_000);
  }
}

// RFC 0010 (card 48m): the quick filter default axis, the "not offered" sort and the notice source state, on the
// whole-set fixture. A host that draws what the renderer hands it passes; one that breaks each surface is named.
describe("RFC 0010 states on fixtures/valid-sets/rfc-0010-v9.json", () => {
  const docs: Document[] = (JSON.parse(readFileSync(join(setDir, "rfc-0010-v9.json"), "utf8")) as unknown[]).map((doc) => {
    const result = validateDocument(doc);
    if (!result.ok) throw new Error("rfc-0010-v9.json is invalid");
    return result.value;
  });
  const ents = new Map(docs.filter((d): d is EntityDocument => d.kind === "entity").map((d) => [d.id, d]));
  const docSet: DocumentSet = { entities: ents, views: new Map(docs.filter((d): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer").map((d) => [d.id, d])) };
  const draw = renderFor(ents, docSet);
  const tickets = docSet.views.get("tickets")!;
  const run = (view: ViewDocument, registry = mockRegistry) => checkViewStatesReport({ view, documents: docs, registry, now: NOW, manyRecords: 40, render: draw });

  test("the tickets table has the quick axis and both notice tones, and is green", async () => {
    const report = await run(tickets);
    expect(report.axes).toContain("quick");
    expect(problems(report.results)).toEqual([]);
    const ids = report.results.map((r) => r.id);
    expect(ids.some((id) => id.includes("quick=cleared"))).toBe(true);
    expect(ids.some((id) => id.endsWith("source=notice-info"))).toBe(true);
    expect(ids.some((id) => id.endsWith("source=notice-warning"))).toBe(true);
  }, 60_000);

  test("a table that never shows the server's notice is reported on the notice states only", async () => {
    const Section = mockRegistry.layout.Section;
    const registry = { ...mockRegistry, layout: { ...mockRegistry.layout, Section: (p: Parameters<typeof Section>[0]) => (p.id.endsWith("-notice") ? null : Section(p)) } };
    const failing = (await run(tickets, registry)).results.filter((r) => r.problems.length > 0);
    expect(failing.map((r) => r.id).every((id) => id.includes("source=notice-"))).toBe(true);
    expect(failing.flatMap((r) => r.problems.map((p) => p.check))).toContain("notice-missing");
  }, 60_000);

  test("a quick filter that ignores its default is reported", async () => {
    const Input = mockRegistry.fields.text.Input;
    const registry = { ...mockRegistry, fields: { ...mockRegistry.fields, text: { ...mockRegistry.fields.text, Input: (p: Parameters<typeof Input>[0]) => Input(p.field.id === "title" ? { ...p, value: "" } : p) } } };
    const checks = (await run(tickets, registry)).results.flatMap((r) => r.problems.map((p) => p.check));
    expect(checks).toContain("quick-default");
  }, 60_000);
});
