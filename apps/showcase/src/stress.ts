import type { DataAdapter, EntityDocument, FieldValue } from "@yadad/core";
import type { BoardView, CalendarView, DashboardView, FormView, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";

/**
 * The stress demo for the visual audit (UI-polish plan §1 V11): a 120-character
 * title, a 40-character unbroken word, a 300-row table, a board column with no
 * cards, a calendar day past its per-day cap, a form with many fields and a
 * select with many options. The showcase shows these documents when the URL
 * carries `?stress=1`; with `?empty=1` every demo data source holds zero rows
 * instead, so the same screens show their 0-item lists.
 *
 * The names are fictional and generic (the repo is public): a depot, a route, a
 * parcel — nothing that names an app, a person or a host.
 */

/** 120 characters exactly — the plan's long-title figure. */
export const LONG_TITLE =
  "Parcel routing regression in the north depot queue when a route is rebuilt after a late manifest keeps requeuing every parcel twice";

/** 40 characters with nowhere to break — the plan's unbroken-word figure. */
export const LONG_WORD = "supercalifragilisticexpialidociousdeliveryx7";

/** Every tag at once on one record (the tags quick filter and the card chips). */
export const MANY_TAGS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];

/** 300 rows — the plan's long-list figure. */
export const ROW_COUNT = 300;

export const stressEntity: EntityDocument = {
  kind: "entity",
  specVersion: 9,
  id: "parcel",
  revision: 1,
  fields: [
    { id: "ref", type: "text", label: "Ref", required: true },
    { id: "title", type: "text", label: "Title", required: true },
    { id: "slug", type: "text", label: "Route slug" },
    { id: "notes", type: "text", label: "Notes" },
    { id: "status", type: "select", label: "Status", required: true, options: { source: "static", values: ["Queued", "Sorting", "On route", "Delivered"] } },
    { id: "priority", type: "select", label: "Priority", options: { source: "static", values: ["Low", "Normal", "High"] } },
    {
      // A select with many options: the option list scrolls inside its own box.
      id: "depot",
      type: "select",
      label: "Depot",
      options: { source: "static", values: Array.from({ length: 25 }, (_, i) => `Depot ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ""}`) },
    },
    { id: "tags", type: "tags", label: "Tags" },
    { id: "owner", type: "reference", label: "Driver", entity: "person", display: "name" },
    { id: "weight", type: "number", label: "Weight (kg)", min: 0, step: 0.1 },
    { id: "due", type: "date", label: "Due" },
    { id: "delivered", type: "boolean", label: "Delivered" },
  ],
  actions: [
    { id: "flag", label: "Flag…", confirm: { title: "Flag this parcel", message: "Flag this parcel for the depot desk?", confirmLabel: "Flag" } },
  ],
};

/** One parcel, deliberately the worst case; the rest are numbered filler. */
function parcelSeeds(): readonly Record<string, FieldValue>[] {
  const rows: Record<string, FieldValue>[] = [];
  for (let i = 0; i < ROW_COUNT; i++) {
    const first = i === 0;
    const second = i === 1;
    rows.push({
      ref: `PCL-${String(i + 1).padStart(4, "0")}`,
      title: first ? LONG_TITLE : second ? `${LONG_WORD} intake` : `Parcel ${String(i + 1).padStart(3, "0")} on the north loop`,
      slug: first ? LONG_WORD : `north-loop-${i + 1}`,
      notes: first ? `Notes that run on: ${LONG_WORD} ${LONG_WORD} ${LONG_WORD}` : null,
      status: (["Queued", "Sorting", "On route", "Delivered"] as const)[i % 4 === 3 ? 3 : i % 3]!,
      priority: (["Low", "Normal", "High"] as const)[i % 3]!,
      depot: `Depot ${String.fromCharCode(65 + (i % 26))}`,
      tags: first ? [...MANY_TAGS] : i % 5 === 0 ? ["alpha", "bravo"] : [],
      owner: String((i % 4) + 1),
      weight: Number(((i % 40) * 0.5).toFixed(1)),
      due: null,
      delivered: i % 4 === 3,
    });
  }
  return rows;
}

/** A day a few days out — always inside the calendar's first month view. */
function soonISO(now: Date = new Date()): string {
  const t = new Date(now);
  t.setDate(t.getDate() + 3);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** The adapter behind the stress demo: 300 parcels, 12 due the same day, people for the owner reference. */
export function stressAdapter(now: Date = new Date()): DataAdapter {
  const db = createMemoryAdapter({
    actions: { "parcel.flag": (record) => ({ values: { priority: record.values["priority"] === "High" ? "Low" : "High" } }) },
  });
  ["Ada", "Grace", "Linus", "Margaret"].forEach((name) => void db.create("person", { name }, { entityRevision: 1 }));
  for (const values of parcelSeeds()) void db.create("parcel", values, { entityRevision: 1 });
  // Twelve parcels on one day: past the calendar's per-day cap, so the day shows its "+N more" affordance.
  const day = soonISO(now);
  for (let i = 0; i < 12; i++) {
    void db.create("parcel", {
      ref: `PCL-D${String(i + 1).padStart(3, "0")}`,
      title: i === 0 ? LONG_TITLE : `Day drop ${String(i + 1).padStart(2, "0")}`,
      status: "Queued",
      priority: "Normal",
      due: day,
      delivered: false,
      tags: i === 0 ? [...MANY_TAGS] : [],
    }, { entityRevision: 1 });
  }
  return db;
}

export const stressTable: TableView = {
  kind: "table",
  specVersion: 9,
  id: "stress_table",
  title: "All parcels (stress)",
  entity: "parcel",
  revision: 1,
  dataSource: "stress",
  columns: [
    { field: "ref" },
    { field: "title" },
    { field: "slug" },
    { field: "status" },
    { field: "priority" },
    { field: "depot" },
    { field: "tags", sortable: false },
    { field: "weight" },
    { field: "due" },
    { field: "delivered" },
  ],
  quickFilters: [{ field: "title" }, { field: "status" }, { field: "tags" }, { field: "priority" }, { field: "depot" }],
  sort: [{ field: "ref", dir: "asc" }],
};

/** No "Delivered" rows sit in this board's data when grouped, so one column is the 0-item list. */
export const stressBoard: BoardView = {
  kind: "board",
  specVersion: 9,
  id: "stress_board",
  title: "Parcels by status (stress)",
  entity: "parcel",
  revision: 1,
  dataSource: "stress",
  groupBy: [{ field: "status" }],
  titleField: "title",
  cardFields: ["priority", "depot", "tags"],
  sort: [{ field: "ref", dir: "asc" }],
  editable: true,
  doneField: "delivered",
  recordActions: ["flag"],
};

export const stressCalendar: CalendarView = {
  kind: "calendar",
  specVersion: 9,
  id: "stress_calendar",
  title: "Deliveries (stress)",
  entity: "parcel",
  revision: 1,
  dataSource: "stress",
  dateField: "due",
  titleField: "title",
  detailFields: ["depot", "priority"],
  colorField: "status",
  doneField: "delivered",
  maxEntriesPerDay: 4,
  sort: [{ field: "ref", dir: "asc" }],
  modes: ["month", "week", "3day"],
  weekStartsOn: 1,
  editable: true,
  recordActions: ["flag"],
};

/** Every field of the stress entity on one form: many fields, long labels, a 25-option select. */
export const stressForm: FormView = {
  kind: "form",
  specVersion: 9,
  id: "stress_form",
  entity: "parcel",
  revision: 1,
  dataSource: "stress",
  sections: [
    {
      id: "main",
      title: "Parcel",
      items: [
        { field: "title" },
        { field: "ref" },
        { field: "slug" },
        { field: "status" },
        { field: "priority" },
        { field: "depot" },
        { field: "tags" },
        { field: "owner" },
        { field: "weight" },
        { field: "due" },
        { field: "delivered" },
        { field: "notes" },
      ],
    },
  ],
};

export const stressDashboard: DashboardView = {
  kind: "dashboard",
  specVersion: 9,
  id: "stress_dashboard",
  title: "Depot desk (stress)",
  revision: 1,
  tabs: [
    {
      id: "desk",
      title: "Desk",
      items: [
        { id: "table", x: 0, y: 0, w: 7, h: 9, widget: "view", view: "stress_table" },
        { id: "board", x: 7, y: 0, w: 5, h: 9, widget: "view", view: "stress_board" },
        { id: "calendar", x: 0, y: 9, w: 6, h: 9, widget: "view", view: "stress_calendar" },
        { id: "form", x: 6, y: 9, w: 6, h: 9, widget: "view", view: "stress_form" },
      ],
    },
    {
      id: "parcels",
      title: "Parcels",
      items: [{ id: "all", x: 0, y: 0, w: 12, h: 10, widget: "view", view: "stress_table" }],
    },
  ],
};

/** The documents the `?stress=1` mode adds to the loaded set. */
export const stressDocuments: readonly (EntityDocument | TableView | BoardView | CalendarView | FormView | DashboardView)[] = [
  stressEntity,
  stressTable,
  stressBoard,
  stressCalendar,
  stressForm,
  stressDashboard,
];

/** The top-level roots the stress mode renders, in reading order. */
export const STRESS_ROOTS: readonly string[] = ["stress_dashboard", "stress_table", "stress_board", "stress_calendar", "stress_form"];
