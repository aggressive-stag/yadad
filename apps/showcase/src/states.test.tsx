// @vitest-environment jsdom
import type { DocumentSet } from "@yadad/renderer";
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, problems } from "@yadad/testing/state-checks";
import { expect, test } from "vitest";
import { loadDocumentSet } from "./documents";
import { reviewDocuments } from "./review";
import { renderState, STATES_NOW } from "./states";

const sources = [
  { kind: "entity", specVersion: 4, id: "task", revision: 1, fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["Todo", "Done"] } },
    { id: "owner", type: "select", label: "Owner", options: { source: "static", values: ["Ann", "Bo"] } },
    { id: "due", type: "date", label: "Due" },
  ] },
  { kind: "calendar", specVersion: 4, id: "task_calendar", revision: 1, entity: "task", dataSource: "default", dateField: "due", titleField: "title" },
  { kind: "board", specVersion: 4, id: "task_board", revision: 1, entity: "task", dataSource: "default", titleField: "title", groupBy: [{ field: "status" }, { field: "owner" }] },
].map((d) => JSON.stringify(d));

test("every review view renders each of its states without a problem", async () => {
  const { documents, errors } = loadDocumentSet([]);
  expect(errors).toEqual([]);
  const entities = new Map(documents.entities);
  const views = new Map(documents.views);
  for (const doc of reviewDocuments) {
    if (doc.kind === "entity") entities.set(doc.id, doc);
    else if (doc.kind !== "viewer") views.set(doc.id, doc);
  }
  const set: DocumentSet = { ...documents, entities, views };
  const all = [...set.entities.values(), ...set.views.values()];
  for (const view of [...set.views.values()].filter((v) => v.id.startsWith("review_"))) {
    const results = await checkViewStates({ view, documents: all, registry: mockRegistry, now: STATES_NOW, timeZone: "UTC", render: (state, context) => renderState(state, context, set) });
    expect(results.length, `${view.id} has states`).toBeGreaterThan(0);
    expect(problems(results), `${view.id} renders every state cleanly`).toEqual([]);
  }
}, 60000);

test("a board state grouped by another field renders grouped by it", async () => {
  const { documents, errors } = loadDocumentSet(sources);
  expect(errors).toEqual([]);
  const view = documents.views.get("task_board")!;
  const all = [...documents.entities.values(), ...documents.views.values()];
  const results = await checkViewStates({ view, documents: all, registry: mockRegistry, now: new Date(2026, 9, 17, 12), render: (state, context) => renderState(state, context, documents) });
  expect(results.some((r) => r.label.includes("grouped by owner"))).toBe(true);
  expect(problems(results)).toEqual([]);
}, 30000);

test("a calendar state in week mode renders in week mode", async () => {
  const { documents, errors } = loadDocumentSet(sources);
  expect(errors).toEqual([]);
  const view = documents.views.get("task_calendar")!;
  const all = [...documents.entities.values(), ...documents.views.values()];
  const results = await checkViewStates({ view, documents: all, registry: mockRegistry, now: new Date(2026, 9, 17, 12), render: (state, context) => renderState(state, context, documents) });
  expect(results.some((r) => r.label.includes("week view"))).toBe(true);
  expect(problems(results)).toEqual([]);
}, 30000);
