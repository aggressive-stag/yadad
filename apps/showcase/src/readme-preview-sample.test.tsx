// Card 41f: this file IS the editor README's "Rendering previews" sample — keep
// the two in step. It exists so the README's host wiring type-checks against
// the current packages (pnpm typecheck covers it) and actually renders, the
// way the showcase's own states page does. README liberties: the fixture files
// stand in for the sample's ./docs, and mockRegistry stands in for the host's.
import { validateDocuments } from "@yadad/core";
import type { DataAdapter, Document, Registry, ViewDocument } from "@yadad/core";
import { StatesPreview } from "@yadad/editor";
import { BoardRenderer, CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer, documentSet } from "@yadad/renderer";
import { createDraftStore } from "@yadad/runtime";
import type { DraftStore, ViewState } from "@yadad/runtime";
import { createStateAdapter, mockRegistry } from "@yadad/testing";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import boardTask from "../../../fixtures/valid/board-task-viewer.json?raw";
import calendarTask from "../../../fixtures/valid/calendar-task-viewer.json?raw";
import dashboardTask from "../../../fixtures/valid/dashboard-task-viewer.json?raw";
import entityTask from "../../../fixtures/valid/entity-task.json?raw";
import formTask from "../../../fixtures/valid/form-task-viewer.json?raw";
import tableHistory from "../../../fixtures/valid/table-task-history.json?raw";
import tableTask from "../../../fixtures/valid/table-task-viewer.json?raw";
import viewerFull from "../../../fixtures/valid/viewer-full.json?raw";

// The wiring from the README, verbatim.
function renderPreviewState(state: ViewState, documents: readonly Document[], registry: Registry<ReactNode>, now: Date): ReactNode {
  const set = documentSet(documents); // entities + views + viewer by id
  const view = set.views.get(state.render.view);
  if (!view) return null;
  const entity = "entity" in view ? set.entities.get(view.entity) : undefined;
  // One fresh adapter per state, mapped under every data-source key the set
  // names — dashboard widgets name keys too, so dashboards are included.
  const adapter = createStateAdapter(state);
  const keys = new Set(documents.flatMap((d) => (d.kind !== "entity" && d.kind !== "viewer" && "dataSource" in d ? [d.dataSource] : [])));
  const dataSources = new Map<string, DataAdapter>([...keys].map((k) => [k, adapter]));
  // The state's viewer goes to the renderer; the "viewer not provided" state omits the prop.
  const viewer = state.omitViewer ? {} : { viewer: state.viewer };
  switch (view.kind) {
    case "form": {
      // A form state's values arrive through the draft store, or the form renders blank.
      let drafts: { readonly store: DraftStore } | undefined;
      if (state.render.kind === "form" && entity && Object.keys(state.render.values).length > 0) {
        const data = new Map<string, string>();
        const store = createDraftStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) });
        store.save(state.render.view, undefined, { values: state.render.values, entityRevision: entity.revision, savedAt: now.getTime() });
        drafts = { store };
      }
      return entity ? <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} {...(drafts ? { drafts } : {})} {...viewer} /> : null;
    }
    case "table":
      return entity ? <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...viewer} /> : null;
    case "calendar":
      // The state names the mode and the day it opens on; key remounts it per state so the seed applies.
      return entity && state.render.kind === "calendar" ? <CalendarRenderer key={state.id} initialMode={state.render.mode} initialAnchor={state.render.anchor} entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} now={now} {...viewer} /> : null;
    case "board":
      // The state names the field the board is grouped by; the viewer may still switch after.
      return entity && state.render.kind === "board" ? <BoardRenderer key={state.id} initialGroupBy={state.render.groupBy} entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...viewer} /> : null;
    case "dashboard":
      // The state names the tab it sits on; initialTab opens it on mount.
      return state.render.kind === "dashboard" ? <DashboardRenderer key={state.id} dashboard={view} documents={set} registry={registry} dataSources={dataSources} initialTab={state.render.tab} {...viewer} /> : null;
  }
}

const raw: unknown[] = [entityTask, formTask, tableTask, tableHistory, calendarTask, boardTask, dashboardTask, viewerFull].map((s) => JSON.parse(s) as unknown);
const checked = validateDocuments(raw);
if (!checked.ok) throw new Error(checked.errors.map((e) => `${e.document ?? "?"}: ${e.message}`).join("\n"));
const documents = checked.value;
const board = documents.find((d): d is ViewDocument => d.kind === "board");

const NOW = new Date(2026, 9, 15);

test("the README's host wiring previews the board in every state", () => {
  if (!board) throw new Error("board fixture missing");
  const html = renderToStaticMarkup(
    <StatesPreview view={board} saved={board} documents={documents} now={NOW} renderState={(state, all) => renderPreviewState(state, all, mockRegistry, NOW)} />,
  );
  expect(html).toContain('aria-label="States"'); // the grid was built…
  expect(html).toContain("data-yadad-state-preview"); // …and each tile rendered its state through the host's function
});
