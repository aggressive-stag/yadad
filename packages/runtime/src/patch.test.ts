import { describe, expect, test } from "vitest";
import { applyPatch, parsePointer } from "./patch";
import type { PatchOperation } from "./patch";

const doc = { a: 1, list: [{ id: "x" }, { id: "y" }], "a/b": { "c~d": true } };
const run = (...ops: PatchOperation[]) => applyPatch(doc, ops);

describe("applyPatch", () => {
  test("add, remove and replace, including array positions and '-'", () => {
    expect(run({ op: "add", path: "/list/1", value: { id: "z" } })).toEqual({ ok: true, value: { ...doc, list: [{ id: "x" }, { id: "z" }, { id: "y" }] } });
    expect(run({ op: "add", path: "/list/-", value: { id: "z" } }).ok && run({ op: "add", path: "/list/-", value: { id: "z" } })).toMatchObject({ value: { list: [{}, {}, { id: "z" }] } });
    expect(run({ op: "remove", path: "/list/0" })).toEqual({ ok: true, value: { ...doc, list: [{ id: "y" }] } });
    expect(run({ op: "replace", path: "/list/1/id", value: "w" })).toMatchObject({ value: { list: [{ id: "x" }, { id: "w" }] } });
    expect(run({ op: "remove", path: "/a" })).toEqual({ ok: true, value: { list: doc.list, "a/b": doc["a/b"] } });
  });

  test("move, copy and test", () => {
    expect(run({ op: "move", from: "/list/0", path: "/list/1" })).toMatchObject({ value: { list: [{ id: "y" }, { id: "x" }] } });
    expect(run({ op: "copy", from: "/a", path: "/b" })).toMatchObject({ value: { a: 1, b: 1 } });
    expect(run({ op: "test", path: "/list/0/id", value: "x" }).ok).toBe(true);
    expect(run({ op: "test", path: "/list/0/id", value: "y" })).toEqual({ ok: false, error: 'Test failed at "/list/0/id".', index: 0 });
  });

  test("escaped pointers", () => {
    expect(parsePointer("/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
    expect(run({ op: "replace", path: "/a~1b/c~0d", value: false })).toMatchObject({ value: { "a/b": { "c~d": false } } });
  });

  test("is atomic and never mutates the input", () => {
    const before = JSON.stringify(doc);
    const result = run({ op: "replace", path: "/a", value: 2 }, { op: "remove", path: "/missing" });
    expect(result).toMatchObject({ ok: false, index: 1 });
    expect(JSON.stringify(doc)).toBe(before);
  });

  test("rejects bad paths", () => {
    expect(run({ op: "replace", path: "/list/7", value: 1 }).ok).toBe(false);
    expect(run({ op: "add", path: "/list/01", value: 1 }).ok).toBe(false);
    expect(run({ op: "move", from: "/list", path: "/list/0" }).ok).toBe(false);
    expect(run({ op: "add", path: "nope", value: 1 }).ok).toBe(false);
  });
});
