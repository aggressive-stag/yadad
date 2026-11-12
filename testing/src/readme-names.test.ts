import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCE_STATES } from "./state-adapter.js";

const here = (file: string): string => readFileSync(new URL(file, import.meta.url), "utf8");
const readme = here("../README.md");

/** The names in the `StateCheck` union, read from the source because the type has no runtime list. */
export function stateCheckNames(source: string): string[] {
  const body = /export type StateCheck =([\s\S]*?);/.exec(source)?.[1] ?? "";
  return [...body.matchAll(/"([a-z-]+)"/g)].map((m) => m[1] as string);
}

/** Names that do not appear in backticks in the README. */
export function missingFrom(text: string, names: readonly string[]): string[] {
  return names.filter((n) => !text.includes(`\`${n}\``) && !text.includes(`"${n}"`));
}

describe("README names every check and source state", () => {
  it("reads StateCheck names from the source", () => {
    expect(stateCheckNames(here("./state-checks.tsx")).length).toBeGreaterThan(25);
  });

  it("documents every StateCheck name", () => {
    const missing = missingFrom(readme, stateCheckNames(here("./state-checks.tsx")));
    expect(missing, `README.md lacks a line for the check(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("documents every source state", () => {
    const missing = missingFrom(readme, SOURCE_STATES);
    expect(missing, `README.md lacks the source state(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("fails and names a check that has no README line", () => {
    expect(missingFrom(readme, ["a-brand-new-check"])).toEqual(["a-brand-new-check"]);
  });
});
