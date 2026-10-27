// @vitest-environment jsdom
import type { Document } from "@yadad/core";
import type { DocumentSet } from "@yadad/renderer";
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, problems } from "@yadad/testing/state-checks";
import { expect, test } from "vitest";
import setJson from "../../../fixtures/valid-sets/rfc-0011-v10.json?raw";
import { loadDocumentSet } from "./documents";
import { renderState, STATES_NOW } from "./states";

const fixture = JSON.parse(setJson) as Document[];

test("a table with a reference quick filter that has a default passes every state, applied and cleared", async () => {
  const { documents, errors } = loadDocumentSet(fixture.map((d) => JSON.stringify(d)));
  expect(errors).toEqual([]);
  const view = documents.views.get("notes")!;
  const set: DocumentSet = documents;
  const all = [...set.entities.values(), ...set.views.values()];
  const results = await checkViewStates({ view, documents: all, registry: mockRegistry, now: STATES_NOW, timeZone: "UTC", render: (state, context) => renderState(state, context, set) });
  expect(results.some((r) => r.id.includes("quick=applied"))).toBe(true);
  expect(results.some((r) => r.id.includes("quick=cleared"))).toBe(true);
  expect(problems(results)).toEqual([]);
}, 60000);
