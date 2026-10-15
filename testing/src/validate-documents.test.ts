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
    { path: "/quickFilters/0/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
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
  "dashboard-stat-unknown-view.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_table"] },
  ],
  "dashboard-stat-unknown-field.json": [
    { path: "/tabs/0/items/0/measure/field", code: "unknown-reference", document: "board", allowed: ["name", "qty", "price", "day", "done"] },
    { path: "/tabs/0/items/1/measure/product/1", code: "unknown-reference", document: "board", allowed: ["name", "qty", "price", "day", "done"] },
    { path: "/tabs/0/items/2/filter/field", code: "unknown-reference", document: "board", allowed: ["name", "qty", "price", "day", "done"] },
  ],
  "dashboard-stat-wrong-field-type.json": [
    { path: "/tabs/0/items/0/measure/field", code: "invalid-value", document: "board", allowed: ["qty", "price"] },
    { path: "/tabs/0/items/1/measure/field", code: "invalid-value", document: "board", allowed: ["qty", "price"] },
    { path: "/tabs/0/items/2/measure/field", code: "invalid-value", document: "board", allowed: ["qty", "price", "day"] },
    { path: "/tabs/0/items/3/measure/product/1", code: "invalid-value", document: "board", allowed: ["qty", "price"] },
  ],
  "dashboard-stat-bad-measure.json": [
    { path: "/tabs/0/items/0/measure/op", code: "invalid-value", document: "board", allowed: ["count", "sum", "countDistinct", "min", "max", "avg"] },
    { path: "/tabs/0/items/1/measure/product", code: "invalid-value", document: "board" },
    { path: "/tabs/0/items/2/measure/product", code: "invalid-value", document: "board" },
    { path: "/tabs/0/items/3/measure/field", code: "unknown-property", document: "board", allowed: ["op"] },
    { path: "/tabs/0/items/4/measure/field", code: "required", document: "board" },
    { path: "/tabs/0/items/5/measure/product", code: "unknown-property", document: "board", allowed: ["op", "field"] },
  ],
  "relative-date-on-number-field.json": [{ path: "/filter/value", code: "invalid-value", document: "thing_table" }],
  "relative-date-not-integer.json": [{ path: "/filter/value/daysFromToday", code: "type", document: "thing_table" }],
  "reference-unknown-entity.json": [{ path: "/fields/0/entity", code: "unknown-reference", document: "entry", allowed: ["exercise", "entry"] }],
  "reference-unknown-display.json": [{ path: "/fields/0/display", code: "unknown-reference", document: "entry", allowed: ["name"] }],
  "reference-display-not-text.json": [{ path: "/fields/0/display", code: "invalid-value", document: "entry" }],
  "reference-missing-entity.json": [{ path: "/fields/0/entity", code: "required", document: "entry" }],
  "reference-unsupported-use.json": [
    { path: "/sort/0/field", code: "invalid-value", document: "entries" },
    { path: "/quickFilters/0/field", code: "invalid-value", document: "entries" },
    { path: "/filter/op", code: "invalid-value", document: "entries" },
  ],
  "row-action-unknown-view.json": [{ path: "/rowAction/open", code: "unknown-reference", document: "a", allowed: ["a"] }],
  "row-action-field-mismatch.json": [
    { path: "/rowAction/bind/0/field", code: "unknown-reference", document: "a", allowed: ["name", "qty"] },
    { path: "/rowAction/bind/0/to", code: "unknown-reference", document: "a", allowed: ["name", "qty"] },
  ],
  "row-action-type-mismatch.json": [{ path: "/rowAction/bind/0", code: "invalid-value", document: "a" }],
  "row-action-cycle.json": [{ path: "/rowAction/open", code: "invalid-value", document: "b" }],
  "row-action-too-deep.json": [{ path: "/rowAction/open", code: "invalid-value", document: "a" }],
  "row-action-form-target.json": [{ path: "/rowAction/open", code: "invalid-value", document: "a", allowed: ["a"] }],
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
