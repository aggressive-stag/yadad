// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Document, EntityDocument, ViewDocument, ViewerDocument } from "@yadad/core";
import { validateDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, problems } from "@yadad/testing/state-checks";
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
        return <TableRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entityMap} documents={documentSet} {...v} />;
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
}
