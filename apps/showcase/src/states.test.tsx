// @vitest-environment jsdom
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, problems } from "@yadad/testing/state-checks";
import { expect, test } from "vitest";
import { loadDocumentSet } from "./documents";
import { renderState } from "./states";

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
