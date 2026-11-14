import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocuments } from "@yadad/core";
import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = (...args: string[]): string => execFileSync("node", ["tools/describe-registry.ts", ...args], { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });

// The text output is what people and agents read before writing a document, so
// it has to show the shape of every value form the JSON output describes.
test("the text output shows the shape of a relative date and of a relative instant", () => {
  const text = run();
  for (const word of ["daysFromToday", "hoursFromNow"]) {
    expect(text, `the describe-registry text output never mentions ${word}`).toContain(word);
  }
  expect(text).toContain('{ "op": "gte", "field": "at", "value": { "hoursFromNow": -24 } }');
});

const KINDS = ["entity", "form", "table", "calendar", "board", "dashboard", "viewer", "conditions"];

test.each(KINDS)("--example %s prints documents that pass validateDocuments", (kind) => {
  const documents: unknown = JSON.parse(run("--example", kind));
  expect(Array.isArray(documents)).toBe(true);
  const result = validateDocuments(documents as unknown[]);
  expect(result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([]);
  if (result.ok) expect(result.warnings ?? []).toEqual([]);
});

test("--kind dashboard prints the dashboard and its widgets, not the rest, and says what the grid numbers are in", () => {
  const text = run("--kind", "dashboard");
  expect(text).toContain("dashboard --");
  expect(text).toContain("widgets (dashboard grid items):");
  expect(text).toContain("stackBelow");
  expect(text).not.toContain("calendar view:");
  expect(text).not.toContain("error codes");
  expect(text).not.toContain("field types (entity fields):");
});

test("--kind with an unknown kind exits non-zero and lists the valid kinds", () => {
  let failure: { status?: number; stderr?: Buffer | string } | undefined;
  try {
    run("--kind", "nonsense");
  } catch (error) {
    failure = error as { status?: number; stderr?: Buffer | string };
  }
  expect(failure?.status).toBe(2);
  expect(String(failure?.stderr)).toContain("entity, form, table, calendar, board, dashboard, viewer, conditions");
});

test("the plain-text output is wrapped at 120 columns; --json is not wrapped", () => {
  for (const line of run().split("\n")) expect(line.length).toBeLessThanOrEqual(120);
  expect(run("--json").split("\n").some((line) => line.length > 120)).toBe(true);
});
