import { readFileSync } from "node:fs";
import * as core from "@yadad/core";
import * as runtime from "@yadad/runtime";
import { describe, expect, it } from "vitest";
import * as stateChecks from "./state-checks.js";
import * as testing from "./index.js";

const guide = readFileSync(new URL("../../packages/core/AGENTS.consumer.md", import.meta.url), "utf8");
const corePackage = JSON.parse(readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8")) as { files: string[] };

describe("packages/core/AGENTS.consumer.md", () => {
  it("ships in the core tarball and stays short", () => {
    expect(corePackage.files).toContain("AGENTS.consumer.md");
    expect(guide.split("\n").length).toBeLessThanOrEqual(150);
  });

  it("names only exports that exist", () => {
    const exported: Record<string, object> = { core, runtime, testing, stateChecks };
    const have = new Set(Object.values(exported).flatMap((m) => Object.keys(m)));
    // testing may not import theme (dependency rules), so read its source.
    if (readFileSync(new URL("../../packages/theme/src/tokens.ts", import.meta.url), "utf8").includes("export function themeToCss")) have.add("themeToCss");
    const named = ["migrate", "validateDocument", "validateDocuments", "describeContract", "recordJsonSchema", "themeToCss", "createMemoryAdapter", "createHttpAdapter", "createDraftStore", "clearDrafts", "checkViewStates", "mockRegistry"];
    for (const name of named) {
      expect(guide.includes(name), `${name} is not mentioned any more`).toBe(true);
      expect(have.has(name), `${name} is not exported`).toBe(true);
    }
  });

  it("quotes only error codes the validator has", () => {
    const codes = new Set(core.describeContract().errorCodes.map((c) => (typeof c === "string" ? c : c.code)));
    for (const m of guide.matchAll(/`(unknown-[a-z-]+|invalid-value|type)`/g)) expect(codes.has(m[1] as string), `${m[1]} is not an error code`).toBe(true);
  });
});
