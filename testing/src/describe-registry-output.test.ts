import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
