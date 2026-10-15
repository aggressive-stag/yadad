import type { Condition, EntityDocument, FormView } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { applyFormRules, dateFromToday, evaluateCondition, evaluateFormRules, resolveRelativeDates } from "./condition.js";
import { createMemoryAdapter } from "./memory-adapter.js";

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

describe("relative dates", () => {
  // Local noon on 2026-10-14, so no timezone shifts the calendar day.
  const now = new Date(2026, 9, 14, 12, 0, 0);
  const ev = (c: Condition, v: Record<string, string | number | boolean | null>) => evaluateCondition(c, v, now);

  test("dateFromToday counts calendar days across month, year and leap boundaries", () => {
    expect(dateFromToday(0, now)).toBe("2026-10-14");
    expect(dateFromToday(-7, now)).toBe("2026-10-07");
    expect(dateFromToday(1, now)).toBe("2026-10-15");
    expect(dateFromToday(-14, now)).toBe("2026-09-30");
    expect(dateFromToday(79, new Date(2026, 9, 14))).toBe("2027-01-01");
    expect(dateFromToday(1, new Date(2028, 1, 28))).toBe("2028-02-29");
    expect(dateFromToday(1, new Date(2026, 2, 28, 23, 59))).toBe("2026-03-29");
  });

  test("evaluates against the injected clock", () => {
    expect(ev({ op: "eq", field: "day", value: { daysFromToday: 0 } }, { day: "2026-10-14" })).toBe(true);
    expect(ev({ op: "eq", field: "day", value: { daysFromToday: 0 } }, { day: "2026-10-13" })).toBe(false);
    expect(ev({ op: "gte", field: "day", value: { daysFromToday: -7 } }, { day: "2026-10-07" })).toBe(true);
    expect(ev({ op: "gte", field: "day", value: { daysFromToday: -7 } }, { day: "2026-10-06" })).toBe(false);
    expect(ev({ op: "lt", field: "day", value: { daysFromToday: 1 } }, { day: "2026-10-14" })).toBe(true);
    expect(ev({ op: "neq", field: "day", value: { daysFromToday: 0 } }, { day: "2026-10-14" })).toBe(false);
  });

  test("resolveRelativeDates leaves only fixed values, and untouched conditions as the same object", () => {
    const rel: Condition = {
      op: "and",
      conditions: [
        { op: "gte", field: "day", value: { daysFromToday: -7 } },
        { op: "not", condition: { op: "eq", field: "day", value: { daysFromToday: 0 } } },
        { op: "or", conditions: [{ op: "eq", field: "exercise", value: "Squat" }] },
      ],
    };
    expect(resolveRelativeDates(rel, now)).toEqual({
      op: "and",
      conditions: [
        { op: "gte", field: "day", value: "2026-10-07" },
        { op: "not", condition: { op: "eq", field: "day", value: "2026-10-14" } },
        { op: "or", conditions: [{ op: "eq", field: "exercise", value: "Squat" }] },
      ],
    });
    expect(JSON.stringify(resolveRelativeDates(rel, now))).not.toContain("daysFromToday");
    const fixed: Condition = { op: "eq", field: "day", value: "2026-10-04" };
    expect(resolveRelativeDates(fixed, now)).toBe(fixed);
    expect(resolveRelativeDates(undefined, now)).toBeUndefined();
  });

  test("the memory adapter filters on relative dates", async () => {
    const adapter = createMemoryAdapter();
    const day = dateFromToday(0);
    await adapter.create("e", { day }, { entityRevision: 1 });
    await adapter.create("e", { day: dateFromToday(-3) }, { entityRevision: 1 });
    const page = await adapter.find("e", { filter: { op: "eq", field: "day", value: { daysFromToday: 0 } } });
    expect(page.items.map((r) => r.values["day"])).toEqual([day]);
  });
});

describe("ordering comparisons and empty values", () => {
  test("a blank string matches none of gt, gte, lt, lte", () => {
    for (const op of ["gt", "gte", "lt", "lte"] as const) {
      expect(evaluateCondition({ op, field: "due", value: "2026-10-15" }, { due: "" })).toBe(false);
      expect(evaluateCondition({ op, field: "due", value: "2026-10-15" }, { due: null })).toBe(false);
      expect(evaluateCondition({ op, field: "due", value: "2026-10-15" }, {})).toBe(false);
    }
  });
});
