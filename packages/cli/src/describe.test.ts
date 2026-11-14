import { describeContract, validateDocuments } from "@yadad/core";
import { expect, test } from "vitest";
import { run } from "./cli.js";
import { EXAMPLE_KINDS } from "./examples.js";

function ydcli(...args: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = run(args, { out: (t) => (out += t), err: (t) => (err += t), cwd: process.cwd() });
  return { code, out, err };
}

test("describe --json is describeContract() of the installed core", () => {
  const r = ydcli("describe", "--json");
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out)).toEqual(JSON.parse(JSON.stringify(describeContract())));
});

test("describe prints readable text wrapped at 120 columns", () => {
  const r = ydcli("describe");
  expect(r.out).toContain("yadad document contract (specVersion");
  for (const line of r.out.split("\n")) expect(line.length).toBeLessThanOrEqual(120);
});

test.each(EXAMPLE_KINDS)("describe --example %s prints documents that validate", (kind) => {
  const r = ydcli("describe", "--example", kind);
  expect(r.code).toBe(0);
  const result = validateDocuments(JSON.parse(r.out) as unknown[]);
  expect(result.ok).toBe(true);
});

test("describe --kind dashboard prints only that part", () => {
  const r = ydcli("describe", "--kind", "dashboard");
  expect(r.out).toContain("widgets (dashboard grid items):");
  expect(r.out).not.toContain("error codes");
});

test("describe with a bad kind or an unknown option is exit 2 and lists the kinds", () => {
  const bad = ydcli("describe", "--kind", "nonsense");
  expect(bad.code).toBe(2);
  expect(bad.err).toContain(EXAMPLE_KINDS.join(", "));
  expect(ydcli("describe", "--frob").code).toBe(2);
});
