import { readdirSync, readFileSync } from "node:fs";
import { validateDocument } from "@yadad/core";
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
