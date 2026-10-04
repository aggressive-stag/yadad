import { describe, expect, test } from "vitest";
import { conditionFields } from "./condition.js";
import { validateDocument } from "./validate.js";

const form = (visibleWhen: unknown) => ({
  kind: "form",
  specVersion: 0,
  id: "f",
  entity: "e",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "main", items: [{ field: "a", visibleWhen, requiredWhen: visibleWhen, clearWhenHidden: true }] }],
});

const problems = (doc: unknown): [string, string][] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
};
const P = "/sections/0/items/0/visibleWhen";

describe("condition validation", () => {
  test("every op validates in its proper shape", () => {
    const valid = {
      op: "and",
      conditions: [
        { op: "eq", field: "a", value: "x" },
        { op: "gte", field: "w", value: 100 },
        { op: "in", field: "a", values: ["x", "y"] },
        { op: "contains", field: "notes", value: "pain" },
        { op: "or", conditions: [{ op: "empty", field: "b" }, { op: "not", condition: { op: "notEmpty", field: "c" } }] },
        { op: "or", conditions: [] },
      ],
    };
    expect(problems(form(valid))).toEqual([]);
  });

  test("shape errors point into the condition", () => {
    expect(problems(form({ op: "like", field: "a", value: "x" })).slice(0, 1)).toEqual([[`${P}/op`, "invalid-value"]]);
    expect(problems(form({ field: "a" })).slice(0, 1)).toEqual([[`${P}/op`, "required"]]);
    expect(problems(form({ op: "eq", field: "a", value: { nested: 1 } })).slice(0, 1)).toEqual([[`${P}/value`, "type"]]);
    expect(problems(form({ op: "contains", field: "a", value: 3 })).slice(0, 1)).toEqual([[`${P}/value`, "type"]]);
    expect(problems(form({ op: "in", field: "a", values: ["x", null] })).slice(0, 1)).toEqual([[`${P}/values/1`, "type"]]);
    expect(problems(form({ op: "and", conditions: [{ op: "eq", field: "a" }] })).slice(0, 1)).toEqual([[`${P}/conditions/0/value`, "required"]]);
    expect(problems(form({ op: "not", condition: "a" })).slice(0, 1)).toEqual([[`${P}/condition`, "type"]]);
  });

  test("nesting is capped", () => {
    let deep: unknown = { op: "empty", field: "a" };
    for (let i = 0; i < 20; i++) deep = { op: "not", condition: deep };
    expect(problems(form(deep)).some(([, code]) => code === "invalid-value")).toBe(true);
  });

  test("table filter and quick filters", () => {
    const table = {
      kind: "table",
      specVersion: 0,
      id: "t",
      entity: "e",
      revision: 1,
      dataSource: "default",
      columns: [{ field: "a" }],
      filter: { op: "eq", field: "done", value: false },
      filters: [{ field: "a" }, { field: "a" }],
    };
    expect(problems(table)).toEqual([["/filters/1/field", "duplicate-id"]]);
  });
});

test("conditionFields lists every referenced field", () => {
  expect(
    conditionFields({
      op: "and",
      conditions: [
        { op: "eq", field: "a", value: 1 },
        { op: "not", condition: { op: "in", field: "b", values: [] } },
      ],
    }),
  ).toEqual(["a", "b"]);
});
