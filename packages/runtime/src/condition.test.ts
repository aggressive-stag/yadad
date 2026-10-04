import type { Condition, EntityDocument, FormView } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { applyFormRules, evaluateCondition, evaluateFormRules } from "./condition";
import { createMemoryAdapter } from "./memory-adapter";

const values = { exercise: "Squat", weight: 100, day: "2026-10-04", warmup: false, notes: "Left Knee pain", empty: "  " };
const is = (c: Condition) => evaluateCondition(c, values);

describe("evaluateCondition", () => {
  test("comparisons", () => {
    expect(is({ op: "eq", field: "exercise", value: "Squat" })).toBe(true);
    expect(is({ op: "neq", field: "warmup", value: true })).toBe(true);
    expect(is({ op: "gte", field: "weight", value: 100 })).toBe(true);
    expect(is({ op: "lt", field: "day", value: "2026-10-05" })).toBe(true);
    expect(is({ op: "gt", field: "weight", value: "50" })).toBe(false); // different types never order
    expect(is({ op: "in", field: "exercise", values: ["Bench", "Squat"] })).toBe(true);
    expect(is({ op: "contains", field: "notes", value: "KNEE" })).toBe(true);
    expect(is({ op: "contains", field: "weight", value: "1" })).toBe(false);
  });

  test("emptiness treats blank text and missing fields as empty", () => {
    expect(is({ op: "empty", field: "empty" })).toBe(true);
    expect(is({ op: "empty", field: "missing" })).toBe(true);
    expect(is({ op: "notEmpty", field: "warmup" })).toBe(true);
  });

  test("and, or, not", () => {
    expect(is({ op: "and", conditions: [] })).toBe(true);
    expect(is({ op: "or", conditions: [] })).toBe(false);
    expect(is({ op: "not", condition: { op: "or", conditions: [{ op: "eq", field: "exercise", value: "Bench" }, { op: "empty", field: "notes" }] } })).toBe(true);
  });
});

describe("form rules", () => {
  const entity: EntityDocument = {
    kind: "entity",
    specVersion: 0,
    id: "set",
    revision: 1,
    fields: [
      { id: "felt", type: "select", label: "Felt", options: { source: "static", values: ["Easy", "Hard"] } },
      { id: "why", type: "text", label: "Why was it hard?" },
      { id: "keep", type: "text", label: "Kept" },
    ],
  };
  const hard: Condition = { op: "eq", field: "felt", value: "Hard" };
  const view: FormView = {
    kind: "form",
    specVersion: 0,
    id: "log",
    entity: "set",
    revision: 1,
    dataSource: "default",
    sections: [{ id: "s", items: [{ field: "felt" }, { field: "why", visibleWhen: hard, requiredWhen: hard, clearWhenHidden: true }, { field: "keep", visibleWhen: hard }] }],
  };

  test("hidden and conditionally required fields follow the values", () => {
    const easy = evaluateFormRules(view, { felt: "Easy" });
    expect([...easy.hidden]).toEqual(["why", "keep"]);
    expect([...easy.required]).toEqual([]);
    expect([...evaluateFormRules(view, { felt: "Hard" }).required]).toEqual(["why"]);
  });

  test("applyFormRules clears only clearWhenHidden fields and tightens required", () => {
    const easy = applyFormRules(entity, view, { felt: "Easy", why: "old", keep: "old" });
    expect(easy.values).toEqual({ felt: "Easy", keep: "old" });
    const hardRules = applyFormRules(entity, view, { felt: "Hard" });
    expect(hardRules.entity.fields.find((f) => f.id === "why")?.required).toBe(true);
    expect(entity.fields.find((f) => f.id === "why")?.required).toBeUndefined();
  });
});

test("the memory adapter filters before sorting and paging", async () => {
  const db = createMemoryAdapter();
  for (const [exercise, weight] of [["Squat", 100], ["Bench", 80], ["Squat", 120]] as const) await db.create("s", { exercise, weight }, { entityRevision: 1 });
  const page = await db.find("s", { filter: { op: "eq", field: "exercise", value: "Squat" }, sort: [{ field: "weight", dir: "desc" }], page: { offset: 0, limit: 1 } });
  expect(page.total).toBe(2);
  expect(page.items.map((r) => r.values["weight"])).toEqual([120]);
});
