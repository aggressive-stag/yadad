// @vitest-environment jsdom
// Card 40d: this file IS the testing README's `checkViewStates` example — keep
// the two in step. It exists so the README recipes type-check against the
// current packages (pnpm typecheck covers it) and actually pass, the way the
// showcase's own states page does. The only README liberties here: the five
// fixture files stand in for the sample's ./docs, and the id list matches them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDocuments } from "@yadad/core";
import { BoardRenderer, CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer, documentSet } from "@yadad/renderer";
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, problems } from "@yadad/testing/state-checks";
import type { CheckViewStatesOptions } from "@yadad/testing/state-checks";
import { expect, test } from "vitest";

// This page's slice: its entity, its views, at most one viewer — the same documents the real page loads.
const slice = ["entity-task.json", "form-task-viewer.json", "table-task-viewer.json", "board-task-viewer.json", "dashboard-task-viewer.json", "viewer-full.json", "table-task-history.json"];
const raw: unknown[] = slice.map((f) => JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", f), "utf8")) as unknown);
const checked = validateDocuments(raw); // validate each page's slice, not just the whole pile at boot
if (!checked.ok) throw new Error(checked.errors.map((e) => `${e.document ?? "?"}: ${e.message}`).join("\n"));
const documents = checked.value;
const set = documentSet(documents); // entities + views + viewer by id — what tables, boards, dashboards and row actions need

const render: CheckViewStatesOptions["render"] = (state, { view, entity, registry, dataSources, drafts, now, viewer, omitViewer }) => {
  const who = omitViewer ? {} : { viewer }; // a view that reads viewer facts: pass the state's viewer, or none on the "viewer not provided" state
  switch (view.kind) {
    // A form state's values arrive through the draft store — pass `drafts` or the form renders empty.
    case "form":
      return <FormRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...(drafts ? { drafts } : {})} {...who} />;
    case "table":
      return <TableRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...who} />;
    // The state names the mode and the day the calendar opens on; key remounts it per state so the seed applies.
    case "calendar":
      return state.render.kind === "calendar" ? <CalendarRenderer key={state.id} entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} now={now} initialMode={state.render.mode} initialAnchor={state.render.anchor} {...who} /> : null;
    // The state names the grouping; the viewer can still switch after the state seeds it.
    case "board":
      return state.render.kind === "board" ? <BoardRenderer key={state.id} entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} initialGroupBy={state.render.groupBy} {...who} /> : null;
    case "dashboard":
      return state.render.kind === "dashboard" ? <DashboardRenderer key={state.id} dashboard={view} documents={set} registry={registry} dataSources={dataSources} initialTab={state.render.tab} {...who} /> : null;
  }
};

// A board or dashboard state grid needs more than the default 5 s per test.
test.each(["task_viewer_form", "task_viewer_table", "task_viewer_board", "task_viewer_dashboard"])("%s, in every state", async (id) => {
  const results = await checkViewStates({ view: id, documents, registry: mockRegistry, now: new Date(2026, 9, 15), render });
  expect(results.length).toBeGreaterThan(0);
  expect(problems(results)).toEqual([]);
}, 60_000);
