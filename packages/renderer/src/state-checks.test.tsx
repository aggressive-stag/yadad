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

/** The one-line wiring per view kind: this is what a host app writes. */
const render: CheckViewStatesOptions["render"] = (state, { view, entity, registry, dataSources, drafts, now, viewer, omitViewer }) => {
  const v = omitViewer ? {} : { viewer };
  switch (view.kind) {
    case "form":
      return <FormRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entities} documents={set} {...(drafts ? { drafts } : {})} {...v} />;
    case "table":
      return <TableRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entities} documents={set} {...v} />;
    case "calendar":
      return <CalendarRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entities} documents={set} now={now} {...(state.render.kind === "calendar" ? { initialMode: state.render.mode, initialAnchor: state.render.anchor } : {})} {...v} />;
    case "board":
      return <BoardRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={entities} documents={set} {...(state.render.kind === "board" ? { groupBy: state.render.groupBy } : {})} {...v} />;
    case "dashboard":
      return <DashboardRenderer dashboard={view} documents={set} registry={registry} dataSources={dataSources} {...v} />;
  }
};

describe("every state of every fixture view", () => {
  test.each([...views.values()].map((v) => [v.id, v] as const))("%s", async (_id, view) => {
    const results = await checkViewStates({ view, documents, registry: mockRegistry, now: NOW, manyRecords: 40, render });
    expect(results.length).toBeGreaterThan(0);
    expect(problems(results)).toEqual([]);
  }, 60_000);
});
