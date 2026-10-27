import type { Condition, EntityDocument, FormView, ResolvedViewer } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { applyFormRules, dateFromToday, evaluateCondition, evaluateFormRules, evaluateViewerCondition, instantFromNow, resolveRelativeDates } from "./condition.js";
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

const owner: ResolvedViewer = { facts: [{ fact: "role", value: "owner" }, { fact: "beta", value: false }] };
const ownerIn: Condition = { op: "viewerIn", fact: "role", values: ["editor", "owner"] };

describe("viewerIn", () => {
  test("is true when the viewer's value is listed, false otherwise", () => {
    expect(evaluateCondition(ownerIn, values, undefined, owner)).toBe(true);
    expect(evaluateCondition({ op: "viewerIn", fact: "role", values: ["viewer"] }, values, undefined, owner)).toBe(false);
    expect(evaluateCondition({ op: "viewerIn", fact: "beta", values: [false] }, values, undefined, owner)).toBe(true);
    expect(evaluateCondition({ op: "viewerIn", fact: "beta", values: [true] }, values, undefined, owner)).toBe(false);
  });

  test("with no viewer, or a fact the viewer lacks, it is false (and not flips it)", () => {
    expect(evaluateCondition(ownerIn, values)).toBe(false);
    expect(evaluateCondition(ownerIn, values, undefined, { facts: [] })).toBe(false);
    expect(evaluateCondition({ op: "not", condition: ownerIn }, values)).toBe(true);
  });

  test("mixes with record leaves", () => {
    const both: Condition = { op: "and", conditions: [{ op: "eq", field: "exercise", value: "Squat" }, ownerIn] };
    expect(evaluateCondition(both, values, undefined, owner)).toBe(true);
    expect(evaluateCondition(both, { exercise: "Bench" }, undefined, owner)).toBe(false);
    expect(evaluateCondition({ op: "or", conditions: [{ op: "eq", field: "exercise", value: "Bench" }, ownerIn] }, values, undefined, owner)).toBe(true);
  });

  test("evaluateViewerCondition handles viewerIn, and, or, not", () => {
    expect(evaluateViewerCondition({ op: "viewerIn", fact: "role", values: ["owner"] }, owner)).toBe(true);
    expect(evaluateViewerCondition({ op: "not", condition: { op: "viewerIn", fact: "role", values: ["owner"] } }, owner)).toBe(false);
    expect(evaluateViewerCondition({ op: "and", conditions: [] }, owner)).toBe(true);
    expect(evaluateViewerCondition({ op: "or", conditions: [] }, owner)).toBe(false);
    expect(
      evaluateViewerCondition({ op: "or", conditions: [{ op: "viewerIn", fact: "beta", values: [true] }, { op: "viewerIn", fact: "role", values: ["owner"] }] }, owner),
    ).toBe(true);
    expect(evaluateViewerCondition({ op: "viewerIn", fact: "missing", values: ["x"] }, owner)).toBe(false);
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

  test("a viewer leaf hides or requires an item, mixed with record leaves", () => {
    const viewerView: FormView = {
      ...view,
      sections: [
        {
          id: "s",
          items: [
            { field: "felt" },
            { field: "why", visibleWhen: ownerIn },
            { field: "keep", visibleWhen: { op: "and", conditions: [hard, ownerIn] }, requiredWhen: ownerIn },
          ],
        },
      ],
    };
    expect([...evaluateFormRules(viewerView, { felt: "Hard" }, owner).hidden]).toEqual([]);
    expect([...evaluateFormRules(viewerView, { felt: "Hard" }, owner).required]).toEqual(["keep"]);
    expect([...evaluateFormRules(viewerView, { felt: "Easy" }, owner).hidden]).toEqual(["keep"]);
    // No viewer: the leaves are false, so the items are hidden and nothing is required.
    const none = evaluateFormRules(viewerView, { felt: "Hard" });
    expect([...none.hidden]).toEqual(["why", "keep"]);
    expect([...none.required]).toEqual([]);
    const applied = applyFormRules(entity, viewerView, { felt: "Hard" }, owner);
    expect(applied.entity.fields.find((f) => f.id === "keep")?.required).toBe(true);
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

describe("time comparisons (RFC 0008 item 14, card 47d)", () => {
  const at = evaluateCondition;
  // "HH:MM" zero-padded 24h sorts lexicographically the way it sorts
  // chronologically. The ordering path takes the string branch of `order`,
  // and THIS test is the pin: if a future change makes time values compare
  // numerically, parses Date objects, or trims the padding, it breaks here.
  test("lexicographic comparison is chronological for zero-padded 24h times", () => {
    expect(at({ op: "gt", field: "start", value: "09:00" }, { start: "09:30" })).toBe(true);
    expect(at({ op: "lt", field: "start", value: "09:00" }, { start: "08:59" })).toBe(true);
    expect(at({ op: "lte", field: "start", value: "09:00" }, { start: "09:00" })).toBe(true);
    expect(at({ op: "gte", field: "start", value: "9:00" }, { start: "09:00" })).toBe(false); // a missing leading zero is a different string — core's isHhMm refuses to store it
    expect(at({ op: "lt", field: "start", value: "24:00" }, { start: "00:01" })).toBe(true); // midnight is the start of the day, not after 23:59
    expect(at({ op: "gt", field: "start", value: "09:00" }, { start: "" })).toBe(false); // an empty record value orders against nothing
    expect(at({ op: "lte", field: "start", value: "09:00" }, {})).toBe(false);
  });
});

describe("tags conditions (RFC 0008 item 15, card 47d)", () => {
  const at = evaluateCondition; // the module `is` helper closes over fixed values
  test("contains is element membership, never a substring of one tag", () => {
    expect(at({ op: "contains", field: "tags", value: "urgent" }, { tags: ["urgent", "home"] })).toBe(true);
    expect(at({ op: "contains", field: "tags", value: "ur" }, { tags: ["urgent"] })).toBe(false);
    expect(at({ op: "contains", field: "tags", value: "urgent" }, { tags: [] })).toBe(false);
    expect(at({ op: "contains", field: "tags", value: "urgent" }, { tags: null })).toBe(false);
    expect(at({ op: "contains", field: "tags", value: "urgent" }, {})).toBe(false);
    // notContains is the same membership negated, so an absent value is not "contained"
    expect(at({ op: "not", condition: { op: "contains", field: "tags", value: "urgent" } }, {})).toBe(true);
  });
  test("in matches when ANY element is listed", () => {
    expect(at({ op: "in", field: "tags", values: ["urgent", "someday"] }, { tags: ["home", "urgent"] })).toBe(true);
    expect(at({ op: "in", field: "tags", values: ["someday"] }, { tags: ["home"] })).toBe(false);
    expect(at({ op: "in", field: "tags", values: [] }, { tags: ["home"] })).toBe(false);
    expect(at({ op: "in", field: "tags", values: ["home"] }, { tags: null })).toBe(false);
  });
  test("a string value keeps the substring semantics contains had before tags existed", () => {
    expect(at({ op: "contains", field: "note", value: "UR" }, { note: "the urgent thing" })).toBe(true);
  });
  test("the memory adapter filters tags through the same evaluation", async () => {
    const adapter = createMemoryAdapter();
    await adapter.create("e", { tags: ["urgent", "home"] }, { entityRevision: 1 });
    await adapter.create("e", { tags: ["home"] }, { entityRevision: 1 });
    await adapter.create("e", {}, { entityRevision: 1 });
    const page = await adapter.find("e", {
      filter: { op: "or", conditions: [{ op: "contains", field: "tags", value: "urgent" }, { op: "contains", field: "tags", value: "someday" }] },
    });
    expect(page.items.map((r) => r.values["tags"])).toEqual([["urgent", "home"]]);
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

describe("viewerIn (stub until the viewer runtime lands)", () => {
  test("is false without a viewer, the RFC 0006 answer for no viewer", () => {
    expect(is({ op: "viewerIn", fact: "role", values: ["owner"] })).toBe(false);
    expect(is({ op: "not", condition: { op: "viewerIn", fact: "role", values: ["owner"] } })).toBe(true);
  });
  test("resolveRelativeDates leaves a viewer leaf alone", () => {
    const c: Condition = { op: "viewerIn", fact: "beta", values: [true] };
    expect(resolveRelativeDates(c)).toBe(c);
  });
});

describe("relative instants", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  test("instantFromNow returns the stored UTC instant, negative hours in the past", () => {
    expect(instantFromNow(0, now)).toBe("2026-10-27T12:00:00.000Z");
    expect(instantFromNow(-24, now)).toBe("2026-10-26T12:00:00.000Z");
    expect(instantFromNow(2, now)).toBe("2026-10-27T14:00:00.000Z");
  });

  test("resolveRelativeDates turns hoursFromNow into a concrete instant, through and/not", () => {
    const filter: Condition = { op: "and", conditions: [{ op: "gte", field: "at", value: { hoursFromNow: -24 } }, { op: "not", condition: { op: "lt", field: "at", value: { hoursFromNow: 2 } } }] };
    expect(resolveRelativeDates(filter, now)).toEqual({
      op: "and",
      conditions: [{ op: "gte", field: "at", value: "2026-10-26T12:00:00.000Z" }, { op: "not", condition: { op: "lt", field: "at", value: "2026-10-27T14:00:00.000Z" } }],
    });
  });

  test("evaluateCondition compares a stored instant with the window", () => {
    const within: Condition = { op: "gte", field: "at", value: { hoursFromNow: -24 } };
    expect(evaluateCondition(within, { at: "2026-10-26T12:00:00.000Z" }, now)).toBe(true);
    expect(evaluateCondition(within, { at: "2026-10-26T11:59:59.999Z" }, now)).toBe(false);
  });
});
