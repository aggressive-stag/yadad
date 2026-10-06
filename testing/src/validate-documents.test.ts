import { readdirSync, readFileSync } from "node:fs";
import { validateDocuments } from "@yadad/core";
import { expect, test } from "vitest";

const validDir = new URL("../../fixtures/valid/", import.meta.url);
const invalidDir = new URL("../../fixtures/invalid/", import.meta.url);

type Picked = { path: string; code: string; document?: string | undefined; allowed?: readonly string[] | undefined };

/** The exact errors (in order) each invalid fixture must yield. */
const expected: Record<string, Picked[]> = {
  "unknown-entity.json": [{ path: "/entity", code: "unknown-reference", document: "thing_form", allowed: ["thing"] }],
  "unknown-form-field.json": [
    { path: "/sections/0/items/1/field", code: "unknown-reference", document: "thing_form", allowed: ["name"] },
  ],
  "unknown-form-condition-field.json": [
    { path: "/sections/0/items/0/visibleWhen/field", code: "unknown-reference", document: "thing_form", allowed: ["name", "mood"] },
  ],
  "unknown-table-field.json": [
    { path: "/columns/1/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
    { path: "/sort/0/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
    { path: "/filters/0/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
    { path: "/filter/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
  ],
  "dashboard-unknown-view.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_form"] },
  ],
  "dashboard-count-non-table.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_table"] },
  ],
  "dashboard-count-unknown-field.json": [
    { path: "/tabs/0/items/0/filter/field", code: "unknown-reference", document: "board", allowed: ["name"] },
  ],
  "duplicate-id.json": [{ path: "/id", code: "duplicate-id", document: "thing" }],
  "structural-unknown-kind.json": [
    { path: "/kind", code: "unknown-kind", document: "w", allowed: ["entity", "form", "table", "dashboard"] },
  ],
};

const validFiles = readdirSync(validDir).filter((f) => f.endsWith(".json")).sort();
const invalidFiles = readdirSync(invalidDir).filter((f) => f.endsWith(".json")).sort();

/** Normalizes a set's errors to the fields the fixtures assert on. */
function problems(set: readonly unknown[]): Picked[] {
  const result = validateDocuments(set);
  if (result.ok) throw new Error("expected the set to be invalid");
  return result.errors.map((e) => ({ path: e.path, code: e.code, document: e.document, allowed: e.allowed }));
}

test("fixtures/valid validate together as one set with zero errors", () => {
  const set = validFiles.map((f) => JSON.parse(readFileSync(new URL(f, validDir), "utf8")));
  const result = validateDocuments(set);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.length).toBe(set.length);
});

test("fixtures/invalid contains exactly the expected files", () => {
  expect(invalidFiles).toEqual(Object.keys(expected).sort());
});

test.each(invalidFiles)("fixtures/invalid/%s yields exactly its expected errors", (file) => {
  const set = JSON.parse(readFileSync(new URL(file, invalidDir), "utf8"));
  expect(problems(set)).toEqual(expected[file]);
});
