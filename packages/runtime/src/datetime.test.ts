import { describe, expect, test } from "vitest";
import {
  formatDateTime,
  instantToLocal,
  instantRangeBounds,
  localToInstant,
} from "./datetime.js";

// Berlin 2026: the spring gap is 2026-03-29 at 01:00 UTC (wall 02:00 jumps to
// 03:00); the fall overlap is 2026-10-25 at 01:00 UTC (wall 03:00 goes back to
// 02:00). New York 2026: the gap is 2026-03-08 at 07:00 UTC, the overlap is
// 2026-11-01 at 06:00 UTC.

describe("localToInstant", () => {
  test("is exact in UTC and in zones without DST in play", () => {
    expect(localToInstant("2026-01-15T09:00", "UTC")).toBe("2026-01-15T09:00:00.000Z");
    expect(localToInstant("2026-07-04T18:30", "Europe/Berlin")).toBe("2026-07-04T16:30:00.000Z");
    expect(localToInstant("2026-01-05T12:00", "America/New_York")).toBe("2026-01-05T17:00:00.000Z");
  });

  test("the fall overlap resolves to the earlier valid instant", () => {
    // 02:30 Berlin on 2026-10-25 happens twice: 00:30Z (CEST, the first) and
    // 01:30Z (CET). The first wins.
    expect(localToInstant("2026-10-25T02:30", "Europe/Berlin")).toBe("2026-10-25T00:30:00.000Z");
    // The same wall time the next day is unambiguous (CET).
    expect(localToInstant("2026-10-26T02:30", "Europe/Berlin")).toBe("2026-10-26T01:30:00.000Z");
    // New York: 01:30 on 2026-11-01 happens twice; the EDT reading (06:30Z)
    // is the earlier instant.
    expect(localToInstant("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  test("a time in the spring gap resolves to the standard-time reading", () => {
    // 02:30 Berlin on 2026-03-29 does not exist (02:59:59.999 jumps to 03:00).
    // It resolves to 00:30Z, whose wall clock is 01:30 CET, the standard-time
    // reading the earlier instant carries.
    expect(localToInstant("2026-03-29T02:30", "Europe/Berlin")).toBe("2026-03-29T00:30:00.000Z");
    // The times around the gap are exact.
    expect(localToInstant("2026-03-29T01:30", "Europe/Berlin")).toBe("2026-03-29T00:30:00.000Z");
    expect(localToInstant("2026-03-29T03:30", "Europe/Berlin")).toBe("2026-03-29T01:30:00.000Z");
    // New York: 02:30 on 2026-03-08 does not exist (01:59:59.999 EDT jumps to
    // 03:00 EST); 06:30Z is the standard-time reading.
    expect(localToInstant("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T06:30:00.000Z");
  });
});

describe("instantToLocal", () => {
  test("reads the zone's own clock", () => {
    expect(instantToLocal("2026-07-04T16:30:00.000Z", "Europe/Berlin")).toBe("2026-07-04T18:30");
    expect(instantToLocal("2026-01-05T17:00:00.000Z", "America/New_York")).toBe("2026-01-05T12:00");
    expect(instantToLocal("2026-03-29T01:00:00.000Z", "Europe/Berlin")).toBe("2026-03-29T03:00"); // the jump
  });

  test("round trips with localToInstant", () => {
    const zones = ["UTC", "Europe/Berlin", "America/New_York"];
    for (const timeZone of zones) {
      const locals = [
        "2026-01-15T09:00",
        "2026-06-15T23:59",
        "2026-10-25T02:30",
        "2026-10-26T02:30",
        "2026-03-29T01:30",
        "2026-03-29T03:30",
        "2026-03-08T01:30",
        "2026-03-08T03:30",
        "2026-11-01T01:30",
      ];
      for (const local of locals) {
        expect(instantToLocal(localToInstant(local, timeZone), timeZone)).toBe(local);
      }
    }
  });
});

describe("instantRangeBounds", () => {
  test("from is the start of its minute, to the last millisecond", () => {
    const { from, to } = instantRangeBounds("2026-05-20T10:00", "2026-05-20T10:30", "Europe/Berlin");
    expect(from).toBe("2026-05-20T08:00:00.000Z");
    expect(to).toBe("2026-05-20T08:30:59.999Z");
    // A value inside the last minute is in the range; one past it is not.
    expect("2026-05-20T08:30:59.999Z" >= from && "2026-05-20T08:30:59.999Z" <= to).toBe(true);
    expect("2026-05-20T08:31:00.000Z" > to).toBe(true);
  });

  test("keeps the minute across the fall overlap (the earlier instant wins)", () => {
    // 10:00 to 10:30 on 2026-10-25 in Berlin; the minutes are after the
    // overlap, so each has one instant (CET, +1).
    const { from, to } = instantRangeBounds("2026-10-25T10:00", "2026-10-25T10:30", "Europe/Berlin");
    expect(from).toBe("2026-10-25T09:00:00.000Z");
    expect(to).toBe("2026-10-25T09:30:59.999Z");
  });

  test("crosses midnight and dates", () => {
    const { from, to } = instantRangeBounds("2026-12-31T23:58", "2027-01-01T00:02", "UTC");
    expect(from).toBe("2026-12-31T23:58:00.000Z");
    expect(to).toBe("2027-01-01T00:02:59.999Z");
  });
});

describe("formatDateTime", () => {
  test("uses the given locale and zone, to the minute", () => {
    // en-US, medium date and short time: the same string on every machine.
    expect(formatDateTime("2026-10-17T09:30:00.000Z", { locale: "en-US", timeZone: "UTC" })).toBe("Oct 17, 2026, 9:30 AM");
    expect(formatDateTime("2026-10-17T09:30:00.000Z", { locale: "en-US", timeZone: "Europe/Berlin" })).toBe("Oct 17, 2026, 11:30 AM");
    expect(formatDateTime("2026-01-05T17:00:00.000Z", { locale: "en-US", timeZone: "America/New_York" })).toBe("Jan 5, 2026, 12:00 PM");
    expect(formatDateTime("2026-07-04T16:30:00.000Z", { locale: "de-DE", timeZone: "Europe/Berlin" })).toBe("04.07.2026, 18:30");
  });

  test("the default style is date and time to the minute", () => {
    expect(formatDateTime("2026-10-17T09:30:45.678Z", { locale: "en-US", timeZone: "UTC" })).toBe("Oct 17, 2026, 9:30 AM");
    expect(formatDateTime("2026-10-17T09:30:45.678Z", { locale: "en-US", timeZone: "UTC", style: "minute" })).toBe("Oct 17, 2026, 9:30 AM");
  });

  test("rejects a value that is not the canonical form", () => {
    expect(() => formatDateTime("2026-10-17T09:30:00Z")).toThrow();
    expect(() => formatDateTime("2026-10-17T09:30:00.000+02:00")).toThrow();
    expect(() => formatDateTime("2026-13-17T09:30:00.000Z")).toThrow();
  });
});

describe("localToInstant input checks", () => {
  test("rejects a form that is not YYYY-MM-DDTHH:MM or a calendar-invalid date", () => {
    expect(() => localToInstant("2026-10-17 09:30", "UTC")).toThrow();
    expect(() => localToInstant("2026-10-17T25:30", "UTC")).toThrow();
    expect(() => localToInstant("2026-02-30T09:30", "UTC")).toThrow();
  });
});
