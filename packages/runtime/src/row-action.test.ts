import type { Condition, DataRecord, EntityDocument, RowBinding } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { bindFilter, bindingValues } from "./row-action.js";

const bind: readonly RowBinding[] = [{ field: "exercise", to: "exercise" }];

describe("bindFilter", () => {
  test("adds an eq per binding", () => {
    expect(bindFilter({ exercise: "Squat" }, bind)).toEqual({ op: "eq", field: "exercise", value: "Squat" });
  });

  test("ANDs onto the target's own filter, own filter first", () => {
    const own: Condition = { op: "eq", field: "warmup", value: false };
    expect(bindFilter({ exercise: "Squat" }, bind, own)).toEqual({
      op: "and",
      conditions: [own, { op: "eq", field: "exercise", value: "Squat" }],
    });
  });

  test("several bindings, with the target field named by `to`", () => {
    const row = { name: "Squat", n: 5 };
    expect(bindFilter(row, [{ field: "name", to: "exercise" }, { field: "n", to: "reps" }])).toEqual({
      op: "and",
      conditions: [{ op: "eq", field: "exercise", value: "Squat" }, { op: "eq", field: "reps", value: 5 }],
    });
  });

  test("an empty or missing row value becomes empty(to); false and 0 are real values", () => {
    expect(bindFilter({ exercise: null }, bind)).toEqual({ op: "empty", field: "exercise" });
    expect(bindFilter({ exercise: "  " }, bind)).toEqual({ op: "empty", field: "exercise" });
    expect(bindFilter({}, bind)).toEqual({ op: "empty", field: "exercise" });
    expect(bindFilter({ w: false }, [{ field: "w", to: "warmup" }])).toEqual({ op: "eq", field: "warmup", value: false });
    expect(bindFilter({ w: 0 }, [{ field: "w", to: "weight" }])).toEqual({ op: "eq", field: "weight", value: 0 });
  });

  test("no bindings returns the target's filter; nothing at all returns undefined", () => {
    const own: Condition = { op: "notEmpty", field: "notes" };
    expect(bindFilter({}, [], own)).toBe(own);
    expect(bindFilter({}, [])).toBeUndefined();
  });

  test("does not mutate its inputs", () => {
    const own: Condition = { op: "eq", field: "warmup", value: false };
    const row = Object.freeze({ exercise: "Squat" });
    const bindings = Object.freeze([Object.freeze({ field: "exercise", to: "exercise" })]);
    const snapshot = JSON.stringify(own);
    bindFilter(row, bindings, own);
    expect(JSON.stringify(own)).toBe(snapshot);
  });
});

describe("bindingValues", () => {
  const record = { id: "r1", values: { name: "x" } } as unknown as DataRecord;
  const entity = (ids: string[]) => ({ kind: "entity", specVersion: 9, id: "e", revision: 1, fields: ids.map((id) => ({ id, type: "text", label: id })) }) as EntityDocument;

  test("adds the record id as `id` when the entity declares no such field", () => {
    expect(bindFilter(bindingValues(record, entity(["name"])), [{ field: "id", to: "parent" }])).toEqual({ op: "eq", field: "parent", value: "r1" });
  });

  test("a declared `id` field wins over the record id", () => {
    expect(bindingValues(record, entity(["id", "name"]))).toBe(record.values);
  });
});
