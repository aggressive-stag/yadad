import { describe, expect, test } from "vitest";
import type { CalendarView, DataRecord, EntityDocument } from "@yadad/core";
import { SPEC_VERSION } from "@yadad/core";
import { createMemoryAdapter } from "./memory-adapter.js";
import {
  CALENDAR_MAX_RECORDS,
  CALENDAR_PAGE_SIZE,
  calendarQuery,
  calendarToday,
  colorSlot,
  dayLabel,
  groupByDay,
  loadCalendarRange,
  moveDay,
  periodTitle,
  rangeCondition,
  shiftAnchor,
  visibleDays,
  visibleRange,
  weekdayLabels,
} from "./calendar.js";
import type { DateRange } from "./calendar.js";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "task",
  revision: 4,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "due", type: "date", label: "Due", min: "2026-01-01", max: "2026-12-31" },
    { id: "list", type: "select", label: "List", options: { source: "static", values: ["a", "b"] } },
  ],
} as EntityDocument;

const view: CalendarView = { kind: "calendar", specVersion: SPEC_VERSION, id: "cal", entity: "task", revision: 1, dataSource: "main", dateField: "due" };

const dates = (days: { date: string }[]): string[] => days.map((d) => d.date);

describe("visibleDays and visibleRange", () => {
  test("month grids are always 42 days and start on weekStartsOn", () => {
    for (const wso of [0, 1, 6]) {
      for (const anchor of ["2026-02-10", "2026-10-15", "2024-02-29", "2026-03-01"]) {
        const days = visibleDays(anchor, "month", wso, "2026-10-15");
        expect(days).toHaveLength(42);
        expect(days[0]?.weekday).toBe(wso);
      }
    }
  });

  test("October 2026, Monday start: leading days from September, trailing days from November", () => {
    const days = visibleDays("2026-10-15", "month", 1, "2026-10-15");
    expect(days[0]).toMatchObject({ date: "2026-09-28", dayOfMonth: 28, weekday: 1, inMonth: false });
    expect(days[3]).toMatchObject({ date: "2026-10-01", inMonth: true });
    expect(days[41]).toMatchObject({ date: "2026-11-08", inMonth: false });
    expect(days.filter((d) => d.inMonth)).toHaveLength(31);
    expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-10-15"]);
  });

  test("Sunday start", () => {
    const range = visibleRange("2026-10-15", "month", 0);
    expect(range).toEqual({ first: "2026-09-27", last: "2026-11-07" });
  });

  test("a month whose 1st is the first column needs no leading days", () => {
    // 2026-06-01 is a Monday
    const days = visibleDays("2026-06-20", "month", 1, "2026-01-01");
    expect(days[0]?.date).toBe("2026-06-01");
    expect(days[0]?.inMonth).toBe(true);
    expect(days[41]?.date).toBe("2026-07-12");
  });

  test("a month that needs 6 rows has the 1st late in the first row", () => {
    // 2026-08-01 is a Saturday; with a Monday start, 31 days + 5 leading = 36 days -> 6 rows
    const days = visibleDays("2026-08-15", "month", 1, "2026-01-01");
    expect(days[0]?.date).toBe("2026-07-27");
    expect(days.findIndex((d) => d.inMonth)).toBe(5);
    expect(days.filter((d) => d.inMonth && d.date > "2026-08-29").map((d) => d.date)).toEqual(["2026-08-30", "2026-08-31"]);
    expect(days[35]?.date).toBe("2026-08-31");
  });

  test("February in a leap year and a non-leap year", () => {
    const leap = visibleDays("2024-02-10", "month", 1, "2026-01-01").filter((d) => d.inMonth);
    const plain = visibleDays("2026-02-10", "month", 1, "2026-01-01").filter((d) => d.inMonth);
    expect(leap).toHaveLength(29);
    expect(leap.at(-1)?.date).toBe("2024-02-29");
    expect(plain).toHaveLength(28);
    expect(plain.at(-1)?.date).toBe("2026-02-28");
  });

  test("century leap rules: 2000 is a leap year, 2100 is not, 1900 is not", () => {
    expect(visibleDays("2000-02-01", "month", 1, "2000-01-01").filter((d) => d.inMonth)).toHaveLength(29);
    expect(visibleDays("2100-02-01", "month", 1, "2100-01-01").filter((d) => d.inMonth)).toHaveLength(28);
    expect(visibleDays("1900-02-01", "month", 1, "1900-01-01").filter((d) => d.inMonth)).toHaveLength(28);
    expect(shiftAnchor("2100-01-15", "month", 1)).toBe("2100-02-01");
    expect(visibleRange("2100-02-01", "week", 1).last).toBe("2100-02-07");
    // the day after 2100-02-28 is March 1st
    expect(dates(visibleDays("2100-02-28", "week", 0, "2100-01-01"))).toContain("2100-03-01");
    expect(dates(visibleDays("2100-02-28", "week", 0, "2100-01-01"))).not.toContain("2100-02-29");
    expect(dates(visibleDays("2000-02-28", "week", 1, "2000-01-01"))).toContain("2000-02-29");
  });

  test("week mode: 7 days, all inMonth, from the weekStartsOn day on or before the anchor", () => {
    const days = visibleDays("2026-10-15", "week", 1, "2026-10-15"); // a Thursday
    expect(dates(days)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(days.every((d) => d.inMonth)).toBe(true);
    expect(dates(visibleDays("2026-10-15", "week", 0, "2026-10-15"))[0]).toBe("2026-10-11");
    expect(dates(visibleDays("2026-10-11", "week", 1, "2026-10-15"))[0]).toBe("2026-10-05"); // a Sunday belongs to the week before
  });

  test("week mode across a month boundary and a year boundary", () => {
    expect(visibleRange("2026-10-30", "week", 1)).toEqual({ first: "2026-10-26", last: "2026-11-01" });
    expect(visibleRange("2026-12-31", "week", 1)).toEqual({ first: "2026-12-28", last: "2027-01-03" });
    expect(visibleRange("2027-01-01", "week", 0)).toEqual({ first: "2026-12-27", last: "2027-01-02" });
    expect(dates(visibleDays("2026-12-31", "week", 1, "2027-01-01"))).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });

  test("a month grid crosses the year boundary", () => {
    expect(visibleRange("2026-12-10", "month", 1)).toEqual({ first: "2026-11-30", last: "2027-01-10" });
    expect(visibleRange("2027-01-10", "month", 1)).toEqual({ first: "2026-12-28", last: "2027-02-07" });
  });

  test("invalid input throws RangeError", () => {
    expect(() => visibleDays("2026-02-30", "month", 1, "2026-01-01")).toThrow(RangeError);
    expect(() => visibleDays("2026-2-3", "month", 1, "2026-01-01")).toThrow(RangeError);
    expect(() => visibleDays("2026-10-15", "month", 7, "2026-01-01")).toThrow(RangeError);
    expect(() => visibleRange("2026-10-15", "week", -1)).toThrow(RangeError);
    expect(() => visibleRange("2026-10-15", "week", 1.5)).toThrow(RangeError);
    expect(() => shiftAnchor("nope", "week", 1)).toThrow(RangeError);
  });
});

describe("shiftAnchor", () => {
  test("month goes to the 1st of the previous or next month", () => {
    expect(shiftAnchor("2026-10-15", "month", 1)).toBe("2026-11-01");
    expect(shiftAnchor("2026-10-15", "month", -1)).toBe("2026-09-01");
    expect(shiftAnchor("2026-12-31", "month", 1)).toBe("2027-01-01");
    expect(shiftAnchor("2026-01-31", "month", -1)).toBe("2025-12-01");
    expect(shiftAnchor("2026-03-31", "month", -1)).toBe("2026-02-01");
  });
  test("week moves by 7 days across month and year ends", () => {
    expect(shiftAnchor("2026-10-15", "week", 1)).toBe("2026-10-22");
    expect(shiftAnchor("2026-12-30", "week", 1)).toBe("2027-01-06");
    expect(shiftAnchor("2024-03-03", "week", -1)).toBe("2024-02-25");
  });
});

describe("today, titles and labels", () => {
  test("calendarToday is the local date of the injected now", () => {
    expect(calendarToday(new Date(2026, 9, 15, 23, 59))).toBe("2026-10-15");
    expect(calendarToday(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
  test("periodTitle", () => {
    expect(periodTitle("2026-10-15", "month", 1, "en-GB")).toBe("October 2026");
    expect(periodTitle("2026-10-07", "week", 1, "en-GB")).toBe("5 to 11 October 2026");
    expect(periodTitle("2026-10-30", "week", 1, "en-GB")).toBe("26 October to 1 November 2026");
    expect(periodTitle("2026-12-31", "week", 1, "en-GB")).toBe("28 December 2026 to 3 January 2027");
  });
  test("weekdayLabels start at weekStartsOn", () => {
    expect(weekdayLabels(1, "en-GB").map((d) => d.short)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayLabels(0, "en-GB")[0]).toEqual({ short: "Sun", long: "Sunday" });
  });
  test("dayLabel", () => {
    expect(dayLabel("2026-10-15", "en-GB")).toBe("Thursday 15 October 2026");
    expect(dayLabel("2024-02-29", "en-GB")).toBe("Thursday 29 February 2024");
    expect(() => dayLabel("2026-13-01")).toThrow(RangeError);
  });
});

describe("rangeCondition and calendarQuery", () => {
  const range: DateRange = { first: "2026-09-28", last: "2026-11-08" };
  test("just the two bounds without a filter", () => {
    expect(rangeCondition("due", range)).toEqual({
      op: "and",
      conditions: [
        { op: "gte", field: "due", value: "2026-09-28" },
        { op: "lte", field: "due", value: "2026-11-08" },
      ],
    });
  });
  test("the view's filter comes first and relative dates are resolved", () => {
    const filter = { op: "gte", field: "due", value: { daysFromToday: -1 } } as const;
    const condition = rangeCondition("due", range, filter, new Date(2026, 9, 15));
    expect(condition).toMatchObject({ op: "and", conditions: [{ op: "gte", field: "due", value: "2026-10-14" }, { op: "gte" }, { op: "lte" }] });
  });
  test("sorts by date, then the view's sort or the default title field", () => {
    expect(calendarQuery(view, range, { entity }).sort).toEqual([{ field: "due", dir: "asc" }, { field: "title", dir: "asc" }]);
    expect(calendarQuery({ ...view, titleField: "list" }, range).sort).toEqual([{ field: "due", dir: "asc" }, { field: "list", dir: "asc" }]);
    expect(calendarQuery({ ...view, sort: [{ field: "list", dir: "desc" }] }, range, { entity }).sort).toEqual([{ field: "due", dir: "asc" }, { field: "list", dir: "desc" }]);
    expect(calendarQuery(view, range).sort).toEqual([{ field: "due", dir: "asc" }]);
  });
  test("pages 500 from offset 0 by default", () => {
    expect(calendarQuery(view, range).page).toEqual({ offset: 0, limit: CALENDAR_PAGE_SIZE });
    expect(CALENDAR_PAGE_SIZE).toBe(500);
    expect(CALENDAR_MAX_RECORDS).toBe(2000);
  });
});

describe("loadCalendarRange", () => {
  const range: DateRange = { first: "2026-10-01", last: "2026-10-31" };
  const seed = async (count: number, extra?: { undated?: number; outside?: number }) => {
    const db = createMemoryAdapter({ fields: { task: ["title", "due", "list"] } });
    const meta = { entityRevision: 4 };
    const create = (values: Record<string, string>) => db.create("task", values, meta);
    for (let i = 0; i < count; i++) await create({ title: `t${String(i).padStart(5, "0")}`, due: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` });
    for (let i = 0; i < (extra?.undated ?? 0); i++) await create({ title: `undated${i}` });
    for (let i = 0; i < (extra?.outside ?? 0); i++) await create({ title: `out${i}`, due: "2026-11-02" });
    return db;
  };

  test("loads only dated records inside the range, in date order", async () => {
    const db = await seed(10, { undated: 3, outside: 2 });
    const load = await loadCalendarRange(db, view, range, { entity });
    expect(load.total).toBe(10);
    expect(load.truncated).toBe(false);
    expect(load.records).toHaveLength(10);
    const days = load.records.map((r) => r.values["due"] as string);
    expect(days).toEqual([...days].sort());
  });

  test("the view filter narrows the range", async () => {
    const db = await seed(10);
    const load = await loadCalendarRange(db, { ...view, filter: { op: "lte", field: "due", value: "2026-10-03" } }, range);
    expect(load.records.map((r) => r.values["due"])).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  test("pages through a range larger than one page, de-duplicated, no truncation", async () => {
    const db = await seed(1200);
    const calls: { offset: number; limit: number }[] = [];
    const spy = { ...db, find: (e: string, q: Parameters<typeof db.find>[1]) => (q.page && calls.push(q.page), db.find(e, q)) };
    const load = await loadCalendarRange(spy, view, range, { entity });
    expect(load.records).toHaveLength(1200);
    expect(new Set(load.records.map((r) => r.id)).size).toBe(1200);
    expect(load.truncated).toBe(false);
    expect(calls).toEqual([{ offset: 0, limit: 500 }, { offset: 500, limit: 500 }, { offset: 1000, limit: 500 }]);
  });

  test("past the cap: reads 2000 in at most 4 requests and reports truncated", async () => {
    const db = await seed(2100);
    let requests = 0;
    const spy = { ...db, find: (e: string, q: Parameters<typeof db.find>[1]) => (requests++, db.find(e, q)) };
    const load = await loadCalendarRange(spy, view, range, { entity });
    expect(load.records).toHaveLength(2000);
    expect(load.total).toBe(2100);
    expect(load.truncated).toBe(true);
    expect(requests).toBe(4);
    // the cap cuts the latest days, not a random subset
    const lastDay = load.records.at(-1)?.values["due"] as string;
    expect(load.records.every((r) => (r.values["due"] as string) <= lastDay)).toBe(true);
  });

  test("an adapter that returns fewer than asked is stepped through by what it gave", async () => {
    const db = await seed(25);
    const small = { ...db, find: (e: string, q: Parameters<typeof db.find>[1]) => db.find(e, q.page ? { ...q, page: { offset: q.page.offset, limit: Math.min(q.page.limit, 10) } } : q) };
    const load = await loadCalendarRange(small, view, range, { entity });
    expect(load.records).toHaveLength(25);
    expect(load.truncated).toBe(false);
  });

  test("an empty range", async () => {
    const db = await seed(0);
    expect(await loadCalendarRange(db, view, range)).toEqual({ records: [], total: 0, truncated: false });
  });
});

describe("groupByDay", () => {
  const record = (id: string, due: unknown): DataRecord => ({ id, entityId: "task", entityRevision: 4, version: "1", values: { due } as DataRecord["values"] });
  test("groups by day in input order and skips records with no date", () => {
    const map = groupByDay([record("a", "2026-10-02"), record("b", "2026-10-01"), record("c", "2026-10-02"), record("d", null), record("e", ""), record("f", undefined)], "due");
    expect([...map.keys()]).toEqual(["2026-10-02", "2026-10-01"]);
    expect(map.get("2026-10-02")?.map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("moveDay", () => {
  const record: DataRecord = { id: "r1", entityId: "task", entityRevision: 3, version: "v7", values: { title: "Pay rent", due: "2026-10-15" } };
  const editable: CalendarView = { ...view, editable: true };
  test("plans a date-only update with the entity revision and base version", () => {
    expect(moveDay(editable, entity, record, "2026-11-03")).toEqual({
      kind: "update",
      entity: "task",
      id: "r1",
      patch: { due: "2026-11-03" },
      meta: { entityRevision: 4, baseVersion: "v7" },
    });
  });
  test("moving to the current day, or on a view that is not editable, sends nothing", () => {
    expect(moveDay(editable, entity, record, "2026-10-15")).toEqual({ kind: "none", reason: "same-day" });
    expect(moveDay(view, entity, record, "2026-11-03")).toEqual({ kind: "none", reason: "not-editable" });
  });
  test("a day outside the field's min or max is blocked", () => {
    expect(moveDay(editable, entity, record, "2025-12-31")).toMatchObject({ kind: "blocked", reason: "before-min" });
    expect(moveDay(editable, entity, record, "2027-01-01")).toMatchObject({ kind: "blocked", reason: "after-max" });
    expect(moveDay(editable, entity, record, "2026-12-31").kind).toBe("update");
  });
  test("a day that is not a real date throws", () => {
    expect(() => moveDay(editable, entity, record, "2026-02-30")).toThrow(RangeError);
  });
});

describe("colorSlot", () => {
  test("select: index in the option list modulo 8", () => {
    const options = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(colorSlot("a", "select", { options })).toBe(0);
    expect(colorSlot("h", "select", { options })).toBe(7);
    expect(colorSlot("i", "select", { options })).toBe(0);
    expect(colorSlot("j", "select", { options })).toBe(1);
    expect(colorSlot("zzz", "select", { options })).toBeUndefined();
  });
  test("reference: stable FNV-1a 32-bit hash of the id modulo 8", () => {
    // FNV-1a 32 of "a" is 0xe40c292c, of "" is 0x811c9dc5
    expect(colorSlot("a", "reference")).toBe(0xe40c292c % 8);
    expect(colorSlot("a", "reference")).toBe(colorSlot("a", "reference"));
    for (const id of ["x1", "record-42", "ü"]) expect(colorSlot(id, "reference")).toBeGreaterThanOrEqual(0);
  });
  test("an empty value has no colour", () => {
    for (const v of [undefined, null, "", 3, true] as const) expect(colorSlot(v, "select", { options: ["a"] })).toBeUndefined();
    expect(colorSlot(null, "reference")).toBeUndefined();
  });
});
