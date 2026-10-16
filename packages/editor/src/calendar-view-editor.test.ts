import type { CalendarView, EntityDocument, TableView } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { describe, expect, test } from "vitest";
import { blankCalendar } from "./blank.js";
import { edit, startSession } from "./session.js";
import type { EditSession } from "./session.js";
import {
  addCalendarDetailField,
  calendarRowActionTargets,
  dateFieldsOf,
  fieldsNotInCalendarDetails,
  moveCalendarDetailField,
  removeCalendarDetailField,
  setCalendarColorField,
  setCalendarDateField,
  setCalendarDefaultMode,
  setCalendarEditable,
  setCalendarFilter,
  setCalendarRowAction,
  setCalendarSort,
  setCalendarTitle,
  setCalendarTitleField,
  setCalendarWeekStartsOn,
  toggleCalendarMode,
} from "./views.js";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "booking",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "done"] } },
    { id: "when", type: "date", label: "When" },
    { id: "notes", type: "text", label: "Notes" },
    { id: "owner", type: "text", label: "Owner" },
  ],
};

const view: CalendarView = { kind: "calendar", specVersion: 0, id: "bookings", entity: "booking", revision: 1, dataSource: "default", dateField: "when" };

/** Applies a helper's result through a session, failing the test if the helper or validation refused it. */
function apply(s: EditSession<CalendarView>, result: PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: { message: string } }): EditSession<CalendarView> {
  if (!Array.isArray(result) && !result.ok) throw new Error(`helper refused the edit: ${result.error.message}`);
  const next = edit(s, Array.isArray(result) ? result : result.patch);
  expect(next.rejected).toEqual([]);
  return next;
}

describe("blankCalendar", () => {
  test("defaults to the entity's first date field", () => {
    const blank = blankCalendar(entity, "bookings", "default");
    expect(blank).toMatchObject({ kind: "calendar", entity: "booking", dateField: "when" });
  });

  test("is null for an entity with no date field", () => {
    const noDates: EntityDocument = { ...entity, fields: entity.fields.filter((f) => f.type !== "date") };
    expect(blankCalendar(noDates, "x", "default")).toBeNull();
  });
});

describe("calendar settings", () => {
  test("sets the title, date, title and colour fields", () => {
    let s = startSession(view);
    s = apply(s, setCalendarTitle(s.current, "Bookings"));
    expect(s.current.title).toBe("Bookings");
    s = apply(s, setCalendarTitleField(s.current, "title"));
    expect(s.current.titleField).toBe("title");
    s = apply(s, setCalendarColorField(s.current, "status"));
    expect(s.current.colorField).toBe("status");
    expect(dateFieldsOf(entity)).toEqual(["when"]);
  });

  test("sets week start and editable, and clears them", () => {
    let s = startSession(view);
    s = apply(s, setCalendarWeekStartsOn(s.current, 0));
    expect(s.current.weekStartsOn).toBe(0);
    s = apply(s, setCalendarEditable(s.current, true));
    expect(s.current.editable).toBe(true);
    s = apply(s, setCalendarEditable(s.current, false));
    expect(s.current.editable).toBeUndefined();
  });

  test("replacing the date field with the same value is a no-op patch", () => {
    expect(setCalendarDateField(view, "when")).toEqual([]);
  });

  test("sets and clears the sort key", () => {
    let s = startSession(view);
    s = apply(s, setCalendarSort(s.current, { field: "title", dir: "desc" }));
    expect(s.current.sort).toEqual([{ field: "title", dir: "desc" }]);
    s = apply(s, setCalendarSort(s.current, undefined));
    expect(s.current.sort).toBeUndefined();
  });

  test("sets and clears the fixed filter", () => {
    let s = startSession(view);
    s = apply(s, setCalendarFilter(s.current, { op: "eq", field: "status", value: "open" }));
    expect(s.current.filter).toEqual({ op: "eq", field: "status", value: "open" });
    s = apply(s, setCalendarFilter(s.current, undefined));
    expect(s.current.filter).toBeUndefined();
  });
});

describe("calendar detail fields", () => {
  test("lists fields not yet used as date, title or detail", () => {
    const withTitle: CalendarView = { ...view, titleField: "title" };
    expect(fieldsNotInCalendarDetails(entity, withTitle)).toEqual(["status", "notes", "owner"]);
  });

  test("adds, reorders and removes detail fields, up to the limit", () => {
    let s = startSession(view);
    s = apply(s, addCalendarDetailField(s.current, "status"));
    s = apply(s, addCalendarDetailField(s.current, "notes"));
    s = apply(s, addCalendarDetailField(s.current, "owner"));
    expect(s.current.detailFields).toEqual(["status", "notes", "owner"]);
    const full = addCalendarDetailField(s.current, "title");
    expect(full.ok).toBe(false);
    s = apply(s, moveCalendarDetailField(s.current, "owner", -1));
    expect(s.current.detailFields).toEqual(["status", "owner", "notes"]);
    s = apply(s, removeCalendarDetailField(s.current, "owner"));
    s = apply(s, removeCalendarDetailField(s.current, "notes"));
    s = apply(s, removeCalendarDetailField(s.current, "status"));
    expect(s.current.detailFields).toBeUndefined();
  });

  test("moving or removing a field that is not in the list is refused", () => {
    expect(moveCalendarDetailField(view, "status", -1).ok).toBe(false);
    expect(removeCalendarDetailField(view, "status").ok).toBe(false);
  });
});

describe("calendar modes", () => {
  test("turns a mode on and off, but refuses to turn off the last one", () => {
    let s = startSession(view);
    const off = toggleCalendarMode(s.current, "week", false);
    expect(off.ok).toBe(true);
    if (off.ok) s = apply(s, off);
    expect(s.current.modes).toEqual(["month"]);
    const refused = toggleCalendarMode(s.current, "month", false);
    expect(refused.ok).toBe(false);
  });

  test("makes a mode the default, keeping relative order of the rest", () => {
    let s = startSession(view);
    const defaulted = setCalendarDefaultMode(s.current, "week");
    expect(defaulted.ok).toBe(true);
    if (defaulted.ok) s = apply(s, defaulted);
    expect(s.current.modes).toEqual(["week", "month"]);
  });
});

describe("calendar row action", () => {
  const table: TableView = { kind: "table", specVersion: 0, id: "booking_history", title: "Booking history", entity: "booking", revision: 1, dataSource: "default", columns: [{ field: "title" }] };
  const context = { tables: [table], entities: [entity] };

  test("lists the tables a calendar's row action may open", () => {
    expect(calendarRowActionTargets(context)).toEqual([table]);
  });

  test("sets and clears a valid row action", () => {
    let s = startSession(view);
    const result = setCalendarRowAction(s.current, entity, context, { open: "booking_history", bind: [{ field: "title", to: "title" }], mode: "replace" });
    expect(result.ok).toBe(true);
    s = apply(s, result);
    expect(s.current.rowAction).toEqual({ open: "booking_history", bind: [{ field: "title", to: "title" }], mode: "replace" });
    s = apply(s, setCalendarRowAction(s.current, entity, context, undefined));
    expect(s.current.rowAction).toBeUndefined();
  });

  test("refuses an action naming an unknown table", () => {
    const result = setCalendarRowAction(view, entity, context, { open: "no_such_table", bind: [{ field: "title", to: "title" }], mode: "replace" });
    expect(result.ok).toBe(false);
  });
});
