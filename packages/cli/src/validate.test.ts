import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPEC_VERSION } from "@yadad/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { run } from "./cli.js";
import { examples } from "./examples.js";
import type { ValidateReport } from "./validate.js";

const SPEC = SPEC_VERSION;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ydcli-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Runs ydcli in `root` and collects what it wrote. */
function ydcli(...args: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = run(args, { out: (t) => (out += t), err: (t) => (err += t), cwd: root });
  return { code, out, err };
}

function write(dir: string, name: string, value: unknown): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

/** A valid entity and form, as files. */
function validSet(dir: string): void {
  const [entity, form] = examples(SPEC).form as [object, object];
  write(dir, "workout_set.json", entity);
  write(dir, "log_set.json", form);
}

describe("exit 0", () => {
  test("every document valid", () => {
    validSet("ok");
    const r = ydcli("validate", "ok");
    expect(r.code).toBe(0);
    expect(r.out).toBe("OK: 2 files valid.\n");
    expect(r.err).toBe("");
  });

  test("a warning does not fail the run, and is printed", () => {
    validSet("warn");
    const entity = JSON.parse(JSON.stringify((examples(SPEC).form as object[])[0]));
    entity.fields.push({ id: "mood", type: "select", label: "Mood", options: { source: "static", values: [{ value: "a", label: "A", color: "#123456" }] } });
    write("warn", "workout_set.json", entity);
    const r = ydcli("validate", "warn");
    expect(r.code).toBe(0);
    expect(r.err).toContain("warning: warn/workout_set.json: ");
    expect(r.out).toContain("1 warning");
  });

  test("a file path works, and so do several paths", () => {
    validSet("two");
    expect(ydcli("validate", "two/workout_set.json", "two/log_set.json").code).toBe(0);
  });
});

describe("exit 1", () => {
  test("one invalid document among valid ones: only it fails, others are ok, and the text names file, pointer and code", () => {
    validSet("mixed");
    const entity = JSON.parse(JSON.stringify((examples(SPEC).form as object[])[0]));
    entity.fields[0].type = "money";
    write("mixed", "workout_set.json", entity);
    write("mixed", "other_entity.json", { ...(examples(SPEC).entity[0] as object), id: "other_entity" });
    const r = ydcli("validate", "mixed");
    expect(r.code).toBe(1);
    expect(r.err).toContain("mixed/workout_set.json: /fields/0/type [unknown-field-type]");
    expect(r.err).toContain("    hint: ");
    expect(r.err).toMatch(/FAIL: \d+ errors? in \d of 3 files\.\n$/);
    expect(r.out).toBe("");
    const j = JSON.parse(ydcli("validate", "mixed", "--json").out) as ValidateReport;
    expect(j.files.find((f) => f.file === "mixed/other_entity.json")?.ok).toBe(true);
    expect(j.files.find((f) => f.file === "mixed/workout_set.json")?.ok).toBe(false);
  });

  test("a document that refers to the invalid one gets its own unknown-reference error, on its own file", () => {
    validSet("ref");
    write("ref", "workout_set.json", { ...JSON.parse(JSON.stringify((examples(SPEC).form as object[])[0])), kind: "nonsense" });
    const j = JSON.parse(ydcli("validate", "ref", "--json").out) as ValidateReport;
    expect(j.errors.map((e) => `${e.file} ${e.code}`)).toContain("ref/log_set.json unknown-reference");
  });

  test("a file that is not JSON is reported as invalid-json with its name, and the rest are still validated", () => {
    validSet("nonjson");
    write("nonjson", "broken.json", "{ not json");
    const j = JSON.parse(ydcli("validate", "nonjson", "--json").out) as ValidateReport;
    expect(j.ok).toBe(false);
    const bad = j.errors.find((e) => e.code === "invalid-json");
    expect(bad).toMatchObject({ file: "nonjson/broken.json", path: "" });
    expect(bad).not.toHaveProperty("document");
    expect(j.files.map((f) => [f.file, f.ok])).toEqual([
      ["nonjson/broken.json", false],
      ["nonjson/log_set.json", true],
      ["nonjson/workout_set.json", true],
    ]);
    const text = ydcli("validate", "nonjson");
    expect(text.code).toBe(1);
    expect(text.err).toContain("nonjson/broken.json: / [invalid-json] Not valid JSON");
  });

  test("two files with the same id: the duplicate is named", () => {
    validSet("dup");
    write("dup", "zzz_copy.json", (examples(SPEC).form as object[])[0]);
    const j = JSON.parse(ydcli("validate", "dup", "--json").out) as ValidateReport;
    expect(j.ok).toBe(false);
    expect(j.errors.every((e) => e.file === "dup/zzz_copy.json" || e.file === "dup/workout_set.json")).toBe(true);
  });

  test("--strict makes a warning fail the run", () => {
    validSet("strict");
    const entity = JSON.parse(JSON.stringify((examples(SPEC).form as object[])[0]));
    entity.fields.push({ id: "mood", type: "select", label: "Mood", options: { source: "static", values: [{ value: "a", label: "A", color: "#123456" }] } });
    write("strict", "workout_set.json", entity);
    expect(ydcli("validate", "strict").code).toBe(0);
    const r = ydcli("validate", "strict", "--strict");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/FAIL: 0 errors and 1 warning in 1 of 2 files \(--strict\)\.\n$/);
    expect((JSON.parse(ydcli("validate", "strict", "--strict", "--json").out) as ValidateReport).ok).toBe(false);
    expect((JSON.parse(ydcli("validate", "strict", "--json").out) as ValidateReport).ok).toBe(true);
  });

  test("a document of an older specVersion is migrated before it is validated, and the file is left alone", () => {
    const before = readFileSync(new URL("../../../fixtures/migrate/table-sets-v0.before.json", import.meta.url), "utf8");
    write("old", "recent_sets.json", before);
    write("old", "workout_set.json", {
      kind: "entity",
      specVersion: SPEC,
      id: "workout_set",
      revision: 1,
      fields: [
        { id: "day", type: "date", label: "Day" },
        { id: "exercise", type: "text", label: "Exercise" },
        { id: "weight", type: "number", label: "Weight" },
      ],
    });
    const r = ydcli("validate", "old");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(readFileSync(join(root, "old", "recent_sets.json"), "utf8")).toBe(before);
  });
});

describe("exit 2", () => {
  test("an empty directory", () => {
    mkdirSync(join(root, "empty"), { recursive: true });
    write("empty", "notes.txt", "not a document");
    const r = ydcli("validate", "empty");
    expect(r.code).toBe(2);
    expect(r.err).toContain("empty: no documents found");
    expect(r.out).toBe("");
  });

  test("a path that does not exist", () => {
    const r = ydcli("validate", "nowhere");
    expect(r.code).toBe(2);
    expect(r.err).toContain("nowhere: no such file or directory");
  });

  test("an unknown option, no path, an unknown command", () => {
    expect(ydcli("validate", "ok", "--fast").code).toBe(2);
    expect(ydcli("validate").code).toBe(2);
    expect(ydcli("frobnicate").code).toBe(2);
    expect(ydcli().code).toBe(2);
  });

  test("--json prints nothing on standard output when the command cannot run", () => {
    const r = ydcli("validate", "nowhere", "--json");
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
  });
});

describe("--json", () => {
  test("is one object with ok, files, errors and warnings, and nothing else", () => {
    validSet("shape");
    const entity = JSON.parse(JSON.stringify((examples(SPEC).form as object[])[0]));
    entity.fields[0].type = "money";
    write("shape", "workout_set.json", entity);
    const r = ydcli("validate", "shape", "--json");
    expect(r.err).toBe("");
    expect(r.out.endsWith("\n")).toBe(true);
    const j = JSON.parse(r.out) as ValidateReport;
    expect(Object.keys(j)).toEqual(["ok", "files", "errors", "warnings"]);
    expect(j.ok).toBe(false);
    expect(j.files).toEqual([
      { file: "shape/log_set.json", document: "log_set", ok: false }, // refers to the invalid entity
      { file: "shape/workout_set.json", document: "workout_set", ok: false },
    ]);
    const first = j.errors.find((e) => e.code === "unknown-field-type");
    expect(first).toMatchObject({ file: "shape/workout_set.json", document: "workout_set", path: "/fields/0/type", code: "unknown-field-type" });
    expect(Object.keys(first ?? {})).toEqual(expect.arrayContaining(["file", "document", "path", "code", "message", "hint"]));
    expect(j.warnings).toEqual([]);
  });

  test("a valid set is ok with empty errors", () => {
    validSet("jsonok");
    const j = JSON.parse(ydcli("validate", "jsonok", "--json").out) as ValidateReport;
    expect(j).toEqual({
      ok: true,
      files: [
        { file: "jsonok/log_set.json", document: "log_set", ok: true },
        { file: "jsonok/workout_set.json", document: "workout_set", ok: true },
      ],
      errors: [],
      warnings: [],
    });
  });
});

describe("help and version", () => {
  test("--help prints usage and exits 0; --version prints the package version", () => {
    expect(ydcli("--help").code).toBe(0);
    expect(ydcli("--help").out).toContain("ydcli validate");
    expect(ydcli("--version").out).toMatch(/^\d+\.\d+\.\d+/);
  });
});
