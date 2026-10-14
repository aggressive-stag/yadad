import type { Condition, FieldType } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { buildGroup, compareToCondition, describeRelativeDate, operatorsFor, parseGroup, roundTrips, valueFits } from "./conditions.js";
import { describeCondition } from "./ui.js";
import type { Comparison, Group } from "./conditions.js";

const group = (combine: "all" | "any", ...cs: Comparison[]): Group => ({ combine, comparisons: cs });
const cmp = (op: Comparison["op"], field: string, extra?: { value?: string | number | boolean; values?: readonly (string | number | boolean)[]; not?: boolean }): Comparison => ({
  not: extra?.not ?? false,
  op,
  field,
  ...(extra?.value !== undefined ? { value: extra.value } : {}),
  ...(extra?.values !== undefined ? { values: extra.values } : {}),
});

describe("operatorsFor", () => {
  test("offers ordering only for numbers and dates", () => {
    expect(operatorsFor("number")).toEqual(["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"]);
    expect(operatorsFor("date")).toEqual(["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"]);
  });
  test("offers contains only for text", () => {
    expect(operatorsFor("text")).toContain("contains");
    expect(operatorsFor("number")).not.toContain("contains");
    expect(operatorsFor("select")).not.toContain("contains");
    expect(operatorsFor("boolean")).not.toContain("contains");
  });
  test("offers is-one-of only for choice lists", () => {
    expect(operatorsFor("select")).toContain("in");
    expect(operatorsFor("text")).not.toContain("in");
  });
  test("offers empty/filled-in for every type", () => {
    for (const t of ["text", "number", "boolean", "select", "date"] as FieldType[]) {
      expect(operatorsFor(t)).toContain("empty");
      expect(operatorsFor(t)).toContain("notEmpty");
    }
  });
});

describe("parseGroup / buildGroup round-trip", () => {
  const cases: [Condition, Group][] = [
    [{ op: "eq", field: "done", value: true }, { combine: "all", comparisons: [cmp("eq", "done", { value: true })] }],
    [{ op: "in", field: "felt", values: ["hard", "brutal"] }, { combine: "all", comparisons: [cmp("in", "felt", { values: ["hard", "brutal"] })] }],
    [{ op: "contains", field: "notes", value: "pride" }, { combine: "all", comparisons: [cmp("contains", "notes", { value: "pride" })] }],
    [{ op: "empty", field: "notes" }, { combine: "all", comparisons: [cmp("empty", "notes")] }],
    [
      { op: "and", conditions: [{ op: "eq", field: "a", value: 1 }, { op: "not", condition: { op: "empty", field: "b" } }] },
      { combine: "all", comparisons: [cmp("eq", "a", { value: 1 }), cmp("empty", "b", { not: true })] },
    ],
  ];
  for (const [cond, parsed] of cases) {
    test(`round-trips ${cond.op}`, () => {
      expect(parseGroup(cond)).toEqual(parsed);
      expect(buildGroup(parsed)).toEqual(cond);
      expect(roundTrips(cond)).toBe(true);
    });
  }
});

test("a not-of-not stays deeper than the builder edits", () => {
  const deep: Condition = { op: "not", condition: { op: "not", condition: { op: "eq", field: "a", value: 1 } } };
  expect(parseGroup(deep)).toBeUndefined();
  expect(roundTrips(deep)).toBe(false);
});

test("a combining nested in a combining stays deeper than the builder edits", () => {
  const deep: Condition = { op: "and", conditions: [{ op: "or", conditions: [{ op: "eq", field: "a", value: 1 }] }, { op: "eq", field: "b", value: 2 }] };
  expect(parseGroup(deep)).toBeUndefined();
  expect(roundTrips(deep)).toBe(false);
});

test("an empty and/or (always/never) is not a builder draft", () => {
  expect(parseGroup({ op: "and", conditions: [] })).toBeUndefined();
  expect(parseGroup({ op: "or", conditions: [] })).toBeUndefined();
});

test("undefined parses to undefined and round-trips", () => {
  expect(parseGroup(undefined)).toBeUndefined();
  expect(roundTrips(undefined)).toBe(true);
});

describe("compareToCondition", () => {
  test("refuses a value op without a value and an in without a list", () => {
    expect(compareToCondition({ not: false, op: "eq", field: "a" })).toBeUndefined();
    expect(compareToCondition({ not: false, op: "in", field: "a", values: [] })).toBeUndefined();
  });
  test("builds an empty op without a value", () => {
    expect(compareToCondition({ not: false, op: "empty", field: "a" })).toEqual({ op: "empty", field: "a" });
  });
});

describe("buildGroup edge cases", () => {
  test("an empty group is no condition", () => {
    expect(buildGroup({ combine: "all", comparisons: [] })).toBeUndefined();
  });
  test("a group with only incomplete comparisons is no condition", () => {
    expect(buildGroup({ combine: "all", comparisons: [cmp("eq", "a")] })).toBeUndefined();
  });
  test("any incomplete comparison makes the whole group no condition", () => {
    const done = cmp("eq", "a", { value: 1 });
    expect(buildGroup(group("all", done, cmp("eq", "b")))).toBeUndefined();
    expect(buildGroup(group("any", done, cmp("in", "c")))).toBeUndefined();
    expect(buildGroup(group("any", done, cmp("in", "c", { values: [] })))).toBeUndefined();
    expect(buildGroup(group("all", done, cmp("contains", "d", { value: 5 })))).toBeUndefined();
  });
  test("a complete multi-row group still builds", () => {
    expect(buildGroup(group("all", cmp("eq", "a", { value: 1 }), cmp("in", "c", { values: ["x"] })))).toEqual({
      op: "and",
      conditions: [
        { op: "eq", field: "a", value: 1 },
        { op: "in", field: "c", values: ["x"] },
      ],
    });
  });
  test("a single comparison is not wrapped in and", () => {
    expect(buildGroup(group("all", cmp("eq", "a", { value: 1 })))).toEqual({ op: "eq", field: "a", value: 1 });
  });
});

describe("valueFits", () => {
  test("numbers want numbers", () => {
    expect(valueFits("number", 3)).toBe(true);
    expect(valueFits("number", "3")).toBe(false);
  });
  test("dates want ISO strings", () => {
    expect(valueFits("date", "2026-10-09")).toBe(true);
    expect(valueFits("date", "2026-10-9")).toBe(false);
  });
  test("booleans want booleans", () => {
    expect(valueFits("boolean", true)).toBe(true);
    expect(valueFits("boolean", "yes")).toBe(false);
  });
  test("text and select accept anything scalar", () => {
    expect(valueFits("text", "x")).toBe(true);
    expect(valueFits("select", "x")).toBe(true);
  });
  test("undefined always fits", () => {
    expect(valueFits("number", undefined)).toBe(true);
  });
  test("a list must all fit", () => {
    expect(valueFits("number", [1, 2])).toBe(true);
    expect(valueFits("number", [1, "2"])).toBe(false);
  });
});

describe("relative dates", () => {
  const rel = (n: number) => ({ daysFromToday: n });
  const label = (id: string) => (id === "day" ? "Date" : id);

  test("round-trip through parseGroup, buildGroup and roundTrips, also under not and and", () => {
    const conditions: Condition[] = [
      { op: "gte", field: "day", value: rel(-7) },
      { op: "not", condition: { op: "eq", field: "day", value: rel(0) } },
      { op: "and", conditions: [{ op: "gte", field: "day", value: rel(-7) }, { op: "lte", field: "day", value: rel(1) }] },
    ];
    for (const c of conditions) {
      expect(roundTrips(c)).toBe(true);
      const g = parseGroup(c);
      expect(g && buildGroup(g)).toEqual(c);
    }
  });

  test("compareToCondition builds a relative value and refuses one with no whole number yet", () => {
    expect(compareToCondition({ not: false, op: "gte", field: "day", value: rel(-3) })).toEqual({ op: "gte", field: "day", value: rel(-3) });
    expect(compareToCondition({ not: false, op: "gte", field: "day", value: { daysFromToday: Number.NaN } })).toBeUndefined();
  });

  test("valueFits accepts a relative date on a date field only", () => {
    expect(valueFits("date", rel(0))).toBe(true);
    expect(valueFits("number", rel(0))).toBe(false);
  });

  test("describeCondition reads in plain words", () => {
    expect(describeCondition({ op: "gte", field: "day", value: rel(-7) }, label)).toBe("Date is at least 7 days ago");
    expect(describeCondition({ op: "eq", field: "day", value: rel(0) }, label)).toBe("Date is today");
    expect(describeCondition({ op: "lt", field: "day", value: rel(-1) }, label)).toBe("Date is less than yesterday");
    expect(describeCondition({ op: "lte", field: "day", value: rel(3) }, label)).toBe("Date is at most in 3 days");
    expect(describeRelativeDate(1)).toBe("tomorrow");
  });
});
