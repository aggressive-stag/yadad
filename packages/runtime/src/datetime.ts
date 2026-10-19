// Pure datetime helpers for the `datetime` field type (RFC 0007): display an
// instant in the viewer's zone, and convert between the stored form and the
// viewer's local zone for form inputs and quick filters. Intl only, no
// dependency. The stored form is the one canonical instant string
// "YYYY-MM-DDTHH:MM:SS.sssZ" (what Date.prototype.toISOString prints), which
// core checks with isIsoDatetime.

import { isIsoDatetime } from "@yadad/core";

export interface DateTimeOptions {
  /** Absent: the environment's locale. */
  readonly locale?: string;
  /** A time zone name such as "Europe/Berlin". Absent: the environment's zone. */
  readonly timeZone?: string;
  /** "minute" (default): date and time to the minute. */
  readonly style?: "minute";
}

/** The `datetime-local` form a local picker shows: "YYYY-MM-DDTHH:MM". */
export const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The zone's wall clock at the instant `t` (exact: the fields read at `t` are the zone's own clock). */
function wallParts(t: number, timeZone: string): Map<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(t));
  const map = new Map<string, string>();
  for (const part of parts) map.set(part.type, part.value);
  return map;
}

/** The wall clock at `t` in the zone as "YYYY-MM-DDTHH:MM". */
function wallAt(t: number, timeZone: string): string {
  const w = wallParts(t, timeZone);
  return `${w.get("year")}-${w.get("month")}-${w.get("day")}T${w.get("hour")}:${w.get("minute")}`;
}

/** The zone's UTC offset in whole minutes at the instant `t`: the wall clock read at `t`, interpreted as UTC, differs from `t` by exactly the offset. */
function offsetMinutes(t: number, timeZone: string): number {
  const w = wallParts(t, timeZone);
  const wall = Date.UTC(
    Number(w.get("year")),
    Number(w.get("month")) - 1,
    Number(w.get("day")),
    Number(w.get("hour")),
    Number(w.get("minute")),
    Number(w.get("second")),
  );
  return Math.round((wall - t) / 60_000);
}

/**
 * Formats the stored value in the viewer's zone and locale. The default
 * style is date and time to the minute; absent options use the environment's
 * locale and zone. With an explicit locale and zone the output is the same
 * on every machine.
 */
export function formatDateTime(value: string, options: DateTimeOptions = {}): string {
  if (!isIsoDatetime(value)) {
    throw new Error(`formatDateTime: not an instant like "2026-10-17T09:30:00.000Z": ${JSON.stringify(value)}`);
  }
  const style = options.style ?? "minute";
  if (style !== "minute") throw new Error(`formatDateTime: unknown style ${JSON.stringify(style)}`);
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** The stored instant as the local form "YYYY-MM-DDTHH:MM" a picker shows, in `timeZone`. */
export function instantToLocal(instant: string, timeZone: string): string {
  if (!isIsoDatetime(instant)) {
    throw new Error(`instantToLocal: not an instant like "2026-10-17T09:30:00.000Z": ${JSON.stringify(instant)}`);
  }
  return wallAt(new Date(instant).getTime(), timeZone);
}

/**
 * The local time "YYYY-MM-DDTHH:MM" in `timeZone` as the stored instant.
 * DST-safe, per the RFC: a local time that occurs twice (the fall overlap)
 * resolves to the earlier valid instant; a local time that does not exist
 * (the spring gap) resolves to the earlier of the two instants the typed
 * wall clock names around the gap (the standard-time reading), whose own
 * wall clock is one hour before the typed time, which the picker then shows.
 */
export function localToInstant(local: string, timeZone: string): string {
  if (!LOCAL_DATETIME_PATTERN.test(local)) {
    throw new Error(`localToInstant: not a local time like "2026-10-17T09:30": ${JSON.stringify(local)}`);
  }
  const y = Number(local.slice(0, 4));
  const mo = Number(local.slice(5, 7));
  const da = Number(local.slice(8, 10));
  const h = Number(local.slice(11, 13));
  const mi = Number(local.slice(14, 16));
  // Date.UTC normalizes out-of-range fields (hour 24, day 32, February 30),
  // so a valid local time reads its own fields back from the UTC wall clock.
  const t0 = Date.UTC(y, mo - 1, da, h, mi, 0);
  if (wallAt(t0, "UTC") !== local) {
    throw new Error(`localToInstant: not a real local date and time: ${JSON.stringify(local)}`);
  }
  // The zone's offset is read six hours either side of the local time, so
  // both offsets in play around the local time are sampled (a zone changes
  // its offset at most once a day, and a DST change lies within a day of the
  // local time it affects).
  const offsets = [offsetMinutes(t0 - 6 * 3_600_000, timeZone), offsetMinutes(t0, timeZone), offsetMinutes(t0 + 6 * 3_600_000, timeZone)];
  const candidates = new Set<number>();
  for (const offset of offsets) candidates.add(t0 - offset * 60_000);
  let result: number | undefined;
  for (const candidate of candidates) {
    if (wallAt(candidate, timeZone) !== local) continue;
    result = result === undefined ? candidate : Math.min(result, candidate);
  }
  if (result === undefined) {
    // The spring gap: no instant shows the local time. Take the earlier of
    // the candidate instants, the standard-time reading.
    result = Math.min(...candidates);
  }
  return new Date(result).toISOString();
}

/**
 * The bounds of a from/to quick filter given in the viewer's zone: "from" is
 * the instant at the start of its minute, "to" the last millisecond of its
 * minute, so 10:00 to 10:30 includes 10:30:59.999.
 */
export function instantRangeBounds(
  fromLocal: string,
  toLocal: string,
  timeZone: string,
): { readonly from: string; readonly to: string } {
  const from = localToInstant(fromLocal, timeZone);
  const to = localToInstant(toLocal, timeZone);
  return { from, to: new Date(new Date(to).getTime() + 59_999).toISOString() };
}
