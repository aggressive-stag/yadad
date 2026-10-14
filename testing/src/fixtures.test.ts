import { readdirSync, readFileSync } from "node:fs";
import { SPEC_VERSION, migrate, validateDocument } from "@yadad/core";
import { expect, test } from "vitest";

const validDir = new URL("../../fixtures/valid/", import.meta.url);
const files = readdirSync(validDir).filter((f) => f.endsWith(".json"));

test("fixtures/valid is not empty", () => {
  expect(files.length).toBeGreaterThan(0);
});

test.each(files)("fixtures/valid/%s validates", (file) => {
  const doc: unknown = JSON.parse(readFileSync(new URL(file, validDir), "utf8"));
  const result = validateDocument(doc);
  expect(result.ok ? [] : result.errors).toEqual([]);
});

const migrateDir = new URL("../../fixtures/migrate/", import.meta.url);
const pairs = readdirSync(migrateDir)
  .filter((f) => f.endsWith(".before.json"))
  .map((f) => f.slice(0, -".before.json".length));

test("fixtures/migrate has at least one before/after pair", () => {
  expect(pairs.length).toBeGreaterThan(0);
});

test.each(pairs)("fixtures/migrate/%s: migrate(before) equals after, and both validate", (name) => {
  const read = (suffix: string): unknown => JSON.parse(readFileSync(new URL(`${name}.${suffix}.json`, migrateDir), "utf8"));
  const before = read("before");
  const after = read("after");
  expect(validateDocument(before).ok).toBe(true);
  expect(validateDocument(after).ok).toBe(true);
  expect(migrate(before)).toEqual(after);
  expect((after as { specVersion: number }).specVersion).toBe(SPEC_VERSION);
  expect(migrate(after)).toEqual(after);
});
