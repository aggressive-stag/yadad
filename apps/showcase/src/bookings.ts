import { AdapterError } from "@yadad/core";
import type { DataAdapter, EntityDocument } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";

/**
 * A generic booking demo for the showcase's calendar page: enough records
 * across two months to make a few days busy, a colour field and a
 * client to drill into. The dates are relative to the day the page loads,
 * so the month view is always busy near today; moving an entry onto a
 * past day is refused (400) by the adapter wrapper below.
 */

export const bookingEntity: EntityDocument = {
  kind: "entity",
  specVersion: 3,
  id: "booking",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "day", type: "date", label: "Day", required: true },
    { id: "client", type: "text", label: "Client" },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["Confirmed", "Pending", "Done"] } },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["Call", "Workshop", "Deadline", "Visit"] } },
  ],
};

/** "YYYY-MM-DD" of the local today; the seed is relative to this, so the demo is alive on any day. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  return `${y}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The day (a calendar date) that is `offset` days after `base`, as "YYYY-MM-DD". */
export function dayAfter(base: string, offset: number): string {
  const t = new Date(`${base}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + offset);
  return t.toISOString().slice(0, 10);
}

/** The bookings of the demo, around today: a few days carry several. */
export function bookingSeeds(now: Date = new Date()): readonly Record<string, string>[] {
  const today = todayISO(now);
  return [
    // This week: three days are busy (the 13th, the 15th and the 16th).
    { title: "Quarterly review", day: dayAfter(today, -2), client: "Nova", status: "Done", kind: "Call" },
    { title: "Onboard team A", day: dayAfter(today, -2), client: "Northwind", status: "Pending", kind: "Workshop" },
    { title: "Contract signing", day: dayAfter(today, -1), client: "Northwind", status: "Confirmed", kind: "Visit" },
    { title: "Sprint demo", day: today, client: "Nova", status: "Confirmed", kind: "Call" },
    { title: "Budget call", day: today, client: "Acme", status: "Pending", kind: "Call" },
    { title: "Design walkthrough", day: today, client: "Acme", status: "Confirmed", kind: "Call" },
    { title: "Release the beta", day: dayAfter(today, 1), client: "Nova", status: "Confirmed", kind: "Deadline" },
    { title: "Interview loop", day: dayAfter(today, 1), client: "Northwind", status: "Pending", kind: "Call" },
    { title: "Client visit", day: dayAfter(today, 3), client: "Acme", status: "Confirmed", kind: "Visit" },
    { title: "Roadmap session", day: dayAfter(today, 5), client: "Nova", status: "Pending", kind: "Workshop" },
    // The week after: one busy day and a couple of singles.
    { title: "Training day", day: dayAfter(today, 7), client: "Northwind", status: "Confirmed", kind: "Workshop" },
    { title: "Quarter close", day: dayAfter(today, 8), client: "Acme", status: "Confirmed", kind: "Deadline" },
    { title: "Site audit", day: dayAfter(today, 8), client: "Nova", status: "Pending", kind: "Visit" },
    { title: "Support review", day: dayAfter(today, 10), client: "Acme", status: "Pending", kind: "Call" },
    { title: "Vendor call", day: dayAfter(today, 12), client: "Northwind", status: "Confirmed", kind: "Call" },
    // A month ahead: the other month on screen, with its own busy day.
    { title: "Kick-off", day: dayAfter(today, 20), client: "Northwind", status: "Confirmed", kind: "Visit" },
    { title: "Sprint planning", day: dayAfter(today, 21), client: "Nova", status: "Pending", kind: "Call" },
    { title: "Security review", day: dayAfter(today, 22), client: "Acme", status: "Pending", kind: "Deadline" },
    { title: "Security follow-up", day: dayAfter(today, 22), client: "Acme", status: "Pending", kind: "Call" },
    { title: "Team off-site", day: dayAfter(today, 26), client: "Northwind", status: "Confirmed", kind: "Workshop" },
    // Far enough back to sit in the previous month: moving there is refused.
    { title: "Kick-off retrospective", day: dayAfter(today, -25), client: "Nova", status: "Done", kind: "Call" },
    { title: "Migration deadline", day: dayAfter(today, -30), client: "Acme", status: "Done", kind: "Deadline" },
  ];
}

/**
 * The adapter the showcase points the calendar at, seeded with the demo
 * bookings. It wraps the memory adapter with one data rule: a booking may
 * not be moved to a day before today. The adapter says so with a 400 and a
 * readable message, exactly as a server would; the calendar then reverts the
 * move and shows the message.
 */
export function bookingsAdapter(now: Date = new Date()): DataAdapter {
  const db = createMemoryAdapter();
  const today = todayISO(now);
  for (const values of bookingSeeds(now)) void db.create("booking", values, { entityRevision: 1 });
  return {
    ...db,
    update: (entity, id, patch, meta) => {
      const nextDay = patch["day"];
      if (typeof nextDay === "string" && nextDay < today) {
        return Promise.reject(new AdapterError("validation", `Bookings cannot be moved to a day before today (${today}); past days are kept read-only.`));
      }
      return db.update(entity, id, patch, meta);
    },
  };
}
