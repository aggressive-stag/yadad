// The tables and limits the validator enforces, next to the short human
// descriptions `describeContract()` reports. The validator imports these
// constants, so the description and the validation cannot drift apart.

import type { ConditionOp } from "./condition.js";
import { CONDITION_OPS, MAX_RELATIVE_DAYS, RELATIVE_DATE_OPS } from "./condition.js";
import type { CalendarMode, Document, FieldType, MeasureOp, WidgetType } from "./document.js";
import { CALENDAR_MODES, FIELD_TYPES, MEASURE_OPS, SPEC_VERSION, WIDGET_TYPES } from "./document.js";

/** Document kinds, discriminated on `kind`. */
export const DOCUMENT_KINDS = ["entity", "form", "table", "calendar", "dashboard"] as const;

/** Ids for fields, sections, tabs, grid items, columns, documents and views. */
export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ID_HINT = 'Use lowercase letters, digits and underscores, starting with a letter (e.g. "workout_set").';

/** A whole number from 1 to 1000 is a valid `pageSize`. */
export const PAGE_SIZE_MAX = 1000;

/** Dashboard grid: a tab has 1 to MAX_GRID_COLUMNS columns (12 by default). */
export const GRID_COLUMNS_DEFAULT = 12;
export const MAX_GRID_COLUMNS = 24;

/** Grid item keys (x, y, w, h): x and y count from 0, w and h count from 1. */
export type GridItemKey = "x" | "y" | "w" | "h";
export const GRID_ITEM_KEYS: readonly { readonly key: GridItemKey; readonly min: number }[] = [
  { key: "x", min: 0 },
  { key: "y", min: 0 },
  { key: "w", min: 1 },
  { key: "h", min: 1 },
];
/** Upper bound for every grid item number, so a document stays sane. */
export const GRID_ITEM_MAX = 1000;

/** A row action chain (A opens B opens C ...) is at most this many hops long, with no revisits. */
export const MAX_ROW_ACTION_DEPTH = 3;

/** A calendar shows at most this many detail fields under an entry's title. */
export const CALENDAR_DETAIL_FIELDS_MAX = 3;
/** Calendar defaults: the modes offered (first is the default period) and the first day of the week (1 = Monday). */
export const CALENDAR_MODES_DEFAULT: readonly CalendarMode[] = CALENDAR_MODES;
export const CALENDAR_WEEK_STARTS_ON_DEFAULT = 1;
/** Field types a calendar's title, colour and date fields may have. */
export const CALENDAR_TITLE_FIELD_TYPES: readonly FieldType[] = ["text", "select"];
export const CALENDAR_COLOR_FIELD_TYPES: readonly FieldType[] = ["select", "reference"];

/** Conditions may nest at most this many levels (and/or/not). */
export const MAX_CONDITION_DEPTH = 16;

export interface PropertySpec {
  readonly key: string;
  readonly required: boolean;
  readonly description: string;
}

interface DocumentKindSpec {
  readonly kind: Document["kind"];
  readonly description: string;
  readonly properties: readonly PropertySpec[];
}

interface FieldSpec {
  readonly type: FieldType;
  readonly description: string;
  readonly properties: readonly PropertySpec[];
}

type ConditionShape =
  | { readonly kind: "value"; readonly keys: ["value"] }
  | { readonly kind: "values"; readonly keys: ["values"] }
  | { readonly kind: "none"; readonly keys: [] }
  | { readonly kind: "nested"; readonly keys: ["conditions"] }
  | { readonly kind: "single"; readonly keys: ["condition"] };

interface ConditionOpSpec {
  readonly op: ConditionOp;
  readonly shape: ConditionShape;
  readonly example: string;
}

interface MeasureSpec {
  readonly op: MeasureOp;
  readonly description: string;
  /** Field types the op's `field` may have; empty when the op takes no field. */
  readonly fields: readonly FieldType[];
  /** Whether `product` (two number fields) may replace `field`. */
  readonly product: boolean;
  /** The value over no records: "0", or "no value" (shown as a dash). */
  readonly empty: "0" | "no value";
  readonly example: string;
}

interface WidgetSpec {
  readonly widget: WidgetType;
  readonly description: string;
  readonly properties: readonly PropertySpec[];
}

export interface ContractDescription {
  readonly specVersion: number;
  readonly id: { readonly pattern: string; readonly hint: string };
  readonly documentKinds: readonly DocumentKindSpec[];
  readonly fieldTypes: readonly FieldSpec[];
  readonly conditions: {
    readonly ops: readonly ConditionOpSpec[];
    readonly maxValueType: string;
    readonly maxDepth: number;
    readonly relativeDate: { readonly description: string; readonly ops: readonly ConditionOp[]; readonly fieldTypes: readonly FieldType[]; readonly maxDays: number; readonly example: string };
  };
  readonly widgets: readonly WidgetSpec[];
  /** Limits and defaults of the `calendar` view kind. */
  readonly calendar: {
    readonly modes: readonly CalendarMode[];
    readonly defaultModes: readonly CalendarMode[];
    readonly weekStartsOn: { readonly default: number; readonly min: number; readonly max: number };
    readonly detailFieldsMax: number;
    readonly dateFieldTypes: readonly FieldType[];
    readonly titleFieldTypes: readonly FieldType[];
    readonly colorFieldTypes: readonly FieldType[];
  };
  /** Registry keys a registry may leave out; the renderer reports a view that needs a missing one. */
  readonly optionalRegistryKeys: readonly { readonly key: string; readonly description: string }[];
  /** The ops of a `stat` widget's `measure`. */
  readonly measures: readonly MeasureSpec[];
  readonly grid: {
    readonly columns: { readonly default: number; readonly max: number };
    readonly items: readonly { readonly key: GridItemKey; readonly min: number; readonly max: number }[];
  };
  readonly limits: { readonly pageSize: { readonly max: number }; readonly rowActionDepth: { readonly max: number } };
  readonly errorCodes: readonly string[];
}

// ---- the tables -----------------------------------------------------------

const DOCUMENT_KIND_SPECS: readonly DocumentKindSpec[] = [
  {
    kind: "entity",
    description: "The data model: owns fields, types and validation.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "entity".' },
      { key: "specVersion", required: true, description: `The engine document format version. Currently ${SPEC_VERSION}; documents of older versions are upgraded with migrate().` },
      { key: "id", required: true, description: "The entity's id." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      { key: "fields", required: true, description: "The fields, an array of { id, type, label, ... }." },
    ],
  },
  {
    kind: "form",
    description: "Sections of fields from one entity, with per-field visibility and required rules.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "form".' },
      { key: "specVersion", required: true, description: `The engine document format version. Currently ${SPEC_VERSION}; documents of older versions are upgraded with migrate().` },
      { key: "id", required: true, description: "The form's id." },
      { key: "entity", required: true, description: "The id of the entity this form edits." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      { key: "dataSource", required: true, description: "Key the host maps to a DataAdapter. Never a URL." },
      { key: "sections", required: true, description: "An array of sections: { id, title?, items: [{ field, visibleWhen?, requiredWhen?, clearWhenHidden? }] }." },
    ],
  },
  {
    kind: "table",
    description: "Records of one entity as rows, with columns, sorting, paging and filters.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "table".' },
      { key: "specVersion", required: true, description: `The engine document format version. Currently ${SPEC_VERSION}; documents of older versions are upgraded with migrate().` },
      { key: "id", required: true, description: "The table's id." },
      { key: "entity", required: true, description: "The id of the entity whose records are shown." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      { key: "dataSource", required: true, description: "Key the host maps to a DataAdapter. Never a URL." },
      { key: "columns", required: true, description: "An array of { field, editable? }; at least one, each field once." },
      { key: "title", required: false, description: "Caption shown with the table." },
      { key: "sort", required: false, description: "Initial sort: an array of { field, dir: \"asc\" | \"desc\" }." },
      { key: "pageSize", required: false, description: "Rows per page, a whole number from 1 to 1000." },
      { key: "filter", required: false, description: "A condition every row must always match." },
      { key: "quickFilters", required: false, description: "An array of { field }; the viewer can set them. Select and boolean fields match exactly, text by substring, number and date fields as a from/to range (either end may stay empty)." },
      { key: "rowAction", required: false, description: `Opens another table view from a row: { open: <table view id>, bind: [{ field, to }], mode?: "replace" }. Each binding adds eq(to, row value of field) to the target's own filter; field is on this table's entity, to on the target's, both of the same field type. At least one binding; chains run at most ${MAX_ROW_ACTION_DEPTH} hops with no revisits. Table targets and "replace" mode only.` },
    ],
  },
  {
    kind: "calendar",
    description: "Records of one entity placed on the days of a month or week by one date field; with editable, moving an entry to another day changes that field. Calendar dates only: no time of day, no time zone.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "calendar".' },
      { key: "specVersion", required: true, description: `The engine document format version. Currently ${SPEC_VERSION}; documents of older versions are upgraded with migrate().` },
      { key: "id", required: true, description: "The calendar's id." },
      { key: "entity", required: true, description: "The id of the entity whose records are shown." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      { key: "dataSource", required: true, description: "Key the host maps to a DataAdapter. Never a URL." },
      { key: "dateField", required: true, description: "The id of a date field of the entity: the day an entry is placed on. Records with no date are not shown." },
      { key: "title", required: false, description: "Accessible name and heading. Defaults to the entity id." },
      { key: "titleField", required: false, description: "The id of a text or select field shown as the entry's title. Defaults to the entity's first text field; required when the entity has none." },
      { key: "detailFields", required: false, description: `Up to ${CALENDAR_DETAIL_FIELDS_MAX} field ids shown small under the title, each once, not the date or title field.` },
      { key: "colorField", required: false, description: "The id of a select or reference field that colours entries (eight colour slots; the value's text is always available too)." },
      { key: "filter", required: false, description: "A condition every entry must always match (relative dates allowed)." },
      { key: "sort", required: false, description: "Order of entries within a day: an array of { field, dir }. Defaults to the title field, ascending." },
      { key: "modes", required: false, description: `The periods the viewer can switch between, from ${CALENDAR_MODES.join(", ")}; non-empty, no duplicates, the first is the default. Defaults to [${CALENDAR_MODES_DEFAULT.map((m) => JSON.stringify(m)).join(", ")}].` },
      { key: "weekStartsOn", required: false, description: `First day of the week: a whole number from 0 (Sunday) to 6. Defaults to ${CALENDAR_WEEK_STARTS_ON_DEFAULT} (Monday).` },
      { key: "editable", required: false, description: "Whether moving an entry to another day changes its date field. Defaults to false." },
      { key: "rowAction", required: false, description: `Opens a table view from an entry, as on tables: { open: <table view id>, bind: [{ field, to }], mode? }. A calendar can start a chain (at most ${MAX_ROW_ACTION_DEPTH} hops in all), never be the target.` },
    ],
  },
  {
    kind: "dashboard",
    description: "Tabs of widgets (views, counts and stats) laid out on a grid. Refers to other views by id.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "dashboard".' },
      { key: "specVersion", required: true, description: `The engine document format version. Currently ${SPEC_VERSION}; documents of older versions are upgraded with migrate().` },
      { key: "id", required: true, description: "The dashboard's id." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      { key: "tabs", required: true, description: "An array of { id, title, columns?, items: [...] }; at least one." },
      { key: "title", required: false, description: "Caption shown with the dashboard." },
    ],
  },
];

const FIELD_SPECS: Record<FieldType, FieldSpec> = {
  text: { type: "text", description: "A short or long text value.", properties: [] },
  number: {
    type: "number",
    description: "A number.",
    properties: [
      { key: "min", required: false, description: "Lowest allowed value." },
      { key: "max", required: false, description: "Highest allowed value." },
      { key: "step", required: false, description: "Allowed increment, a number greater than 0 (e.g. 0.5)." },
      { key: "unit", required: false, description: 'Shown next to the value, e.g. "kg".' },
    ],
  },
  boolean: { type: "boolean", description: "A yes/no value.", properties: [] },
  select: {
    type: "select",
    description: "A fixed list of choices.",
    properties: [{ key: "options", required: true, description: '{ source: "static", values: [non-empty, unique texts] }; at least one value.' }],
  },
  date: {
    type: "date",
    description: 'A calendar date, stored as "YYYY-MM-DD".',
    properties: [
      { key: "min", required: false, description: 'Earliest allowed date, "YYYY-MM-DD".' },
      { key: "max", required: false, description: 'Latest allowed date, "YYYY-MM-DD".' },
    ],
  },
  reference: {
    type: "reference",
    description:
      "A link to a record of another entity. The stored value is the target record's id (text). The server enforces that the record exists; the form offers existing records. Conditions on it take eq, neq, in, empty and notEmpty; it cannot be a quick filter or a table sort key.",
    properties: [
      { key: "entity", required: true, description: "The id of the target entity (an entity in the same set; may be the entity itself)." },
      { key: "display", required: false, description: "The id of a text or select field on the target that labels a record. Defaults to the target's first text field." },
    ],
  },
};

const CONDITION_EXAMPLES: { readonly [K in ConditionOp]: string } = {
  eq: '{ "op": "eq", "field": "exercise", "value": "Squat" }',
  neq: '{ "op": "neq", "field": "exercise", "value": "Squat" }',
  gt: '{ "op": "gt", "field": "weight", "value": 100 }',
  gte: '{ "op": "gte", "field": "weight", "value": 100 }',
  lt: '{ "op": "lt", "field": "weight", "value": 100 }',
  lte: '{ "op": "lte", "field": "weight", "value": 100 }',
  in: '{ "op": "in", "field": "exercise", "values": ["Squat", "Bench"] } (a list under "values")',
  contains: '{ "op": "contains", "field": "name", "value": "text" }',
  empty: '{ "op": "empty", "field": "notes" }',
  notEmpty: '{ "op": "notEmpty", "field": "notes" }',
  and: '{ "op": "and", "conditions": [ <condition>, ... ] } (a list under "conditions")',
  or: '{ "op": "or", "conditions": [ <condition>, ... ] } (a list under "conditions")',
  not: '{ "op": "not", "condition": <condition> } (one condition under "condition")',
};

const CONDITION_SHAPES: { readonly [K in ConditionOp]: ConditionShape } = {
  eq: { kind: "value", keys: ["value"] },
  neq: { kind: "value", keys: ["value"] },
  gt: { kind: "value", keys: ["value"] },
  gte: { kind: "value", keys: ["value"] },
  lt: { kind: "value", keys: ["value"] },
  lte: { kind: "value", keys: ["value"] },
  in: { kind: "values", keys: ["values"] },
  contains: { kind: "value", keys: ["value"] },
  empty: { kind: "none", keys: [] },
  notEmpty: { kind: "none", keys: [] },
  and: { kind: "nested", keys: ["conditions"] },
  or: { kind: "nested", keys: ["conditions"] },
  not: { kind: "single", keys: ["condition"] },
};

/** Field types each measure op accepts (empty for count, which takes no field). */
export const MEASURE_FIELD_TYPES: { readonly [K in MeasureOp]: readonly FieldType[] } = {
  count: [],
  sum: ["number"],
  avg: ["number"],
  min: ["number", "date"],
  max: ["number", "date"],
  countDistinct: FIELD_TYPES,
};

/** Ops that also accept `product` (two number fields multiplied per record). */
export const MEASURE_PRODUCT_OPS: readonly MeasureOp[] = ["sum", "avg"];

/** Result of a measure over no records, shown as a dash when there is no value. */
const MEASURE_SPECS: { readonly [K in MeasureOp]: MeasureSpec } = {
  count: { op: "count", description: "The number of records.", fields: [], product: false, empty: "0", example: '{ "op": "count" }' },
  sum: { op: "sum", description: "The total of a number field, or of the product of two number fields per record. Empty values are skipped.", fields: MEASURE_FIELD_TYPES.sum, product: true, empty: "0", example: '{ "op": "sum", "product": ["weight", "reps"] }' },
  avg: { op: "avg", description: "The mean of a number field, or of the product of two number fields per record. Empty values are skipped.", fields: MEASURE_FIELD_TYPES.avg, product: true, empty: "no value", example: '{ "op": "avg", "field": "weight" }' },
  min: { op: "min", description: "The smallest value of a field. Empty values are skipped.", fields: MEASURE_FIELD_TYPES.min, product: false, empty: "no value", example: '{ "op": "min", "field": "weight" }' },
  max: { op: "max", description: "The largest value of a field. Empty values are skipped.", fields: MEASURE_FIELD_TYPES.max, product: false, empty: "no value", example: '{ "op": "max", "field": "weight" }' },
  countDistinct: { op: "countDistinct", description: "The number of distinct non-empty values of a field.", fields: MEASURE_FIELD_TYPES.countDistinct, product: false, empty: "0", example: '{ "op": "countDistinct", "field": "day" }' },
};

const WIDGET_SPECS: Record<WidgetType, WidgetSpec> = {
  view: {
    widget: "view",
    description: "Embeds a form, table or calendar view, by id.",
    properties: [{ key: "view", required: true, description: "The id of the form, table or calendar view to embed. Counts and stats take table views only." }],
  },
  count: {
    widget: "count",
    description: "Counts the records a table view shows (its fixed filter applies), optionally narrowed further.",
    properties: [
      { key: "label", required: true, description: "Shown with the count." },
      { key: "view", required: true, description: "The id of the table view to count." },
      { key: "filter", required: false, description: "A condition that narrows the count further." },
    ],
  },
  stat: {
    widget: "stat",
    description:
      "Shows one number computed over the records of a table view (its fixed filter applies), optionally narrowed further. Empty input gives 0 for count, sum and countDistinct, and no value (shown as a dash) for min, max and avg. At most 5000 records are read; past that the widget says the number is partial.",
    properties: [
      { key: "label", required: true, description: "Shown with the number." },
      { key: "view", required: true, description: "The id of the table view to compute over." },
      { key: "measure", required: true, description: "What to compute: an object with an \"op\" from `measures`, plus \"field\" (or, for sum and avg, \"product\": [fieldA, fieldB])." },
      { key: "filter", required: false, description: "A condition that narrows the records further." },
    ],
  },
};

/**
 * The error codes `validateDocument` and `validateDocuments` report. The
 * data-adapter codes (docs/records-protocol.md) reuse the same shape but are
 * not listed here because documents never carry them.
 */
export const ERROR_CODES = [
  "type", // wrong JSON type (object, string, number, ...)
  "required", // missing property
  "unknown-property", // property not in the schema (no additionalProperties)
  "invalid-value", // right type, disallowed value
  "unknown-kind",
  "unknown-field-type",
  "unsupported-spec-version",
  "duplicate-id",
  "unknown-reference", // a document references an id that does not exist in the set
  "empty", // a warning: valid but empty (a form with no fields, a tab with no widgets)
] as const;
export type DocumentErrorCode = (typeof ERROR_CODES)[number];

// ---- the pure description -------------------------------------------------

/**
 * A plain JSON description of everything a document can contain: the document
 * kinds and their properties, the field types and their type-specific
 * properties, the condition ops and their exact shapes, the widget types, the
 * grid limits, the id pattern and the error codes. Built from the same
 * constants the validator uses, so it cannot describe what the validator
 * rejects. Pure: no I/O, deterministic, JSON-serializable.
 */
export function describeContract(): ContractDescription {
  return {
    specVersion: SPEC_VERSION,
    id: { pattern: ID_PATTERN.source, hint: ID_HINT },
    documentKinds: DOCUMENT_KIND_SPECS,
    fieldTypes: FIELD_TYPES.map((type) => FIELD_SPECS[type]),
    conditions: {
      ops: CONDITION_OPS.map((op) => ({ op, shape: CONDITION_SHAPES[op], example: CONDITION_EXAMPLES[op] })),
      maxValueType: "text, a number or true/false (contains: text only; eq, neq, gt, gte, lt, lte on a date field also take a relative date)",
      maxDepth: MAX_CONDITION_DEPTH,
      relativeDate: {
        description:
          'Instead of a fixed "YYYY-MM-DD", the value of a comparison may be { "daysFromToday": <whole number> } (0 is today, -7 a week ago, 1 tomorrow), resolved from the viewer\'s local date. Date fields only; not in "in" or "contains".',
        ops: [...RELATIVE_DATE_OPS],
        fieldTypes: ["date"],
        maxDays: MAX_RELATIVE_DAYS,
        example: '{ "op": "gte", "field": "day", "value": { "daysFromToday": -7 } }',
      },
    },
    widgets: WIDGET_TYPES.map((widget) => WIDGET_SPECS[widget]),
    calendar: {
      modes: [...CALENDAR_MODES],
      defaultModes: [...CALENDAR_MODES_DEFAULT],
      weekStartsOn: { default: CALENDAR_WEEK_STARTS_ON_DEFAULT, min: 0, max: 6 },
      detailFieldsMax: CALENDAR_DETAIL_FIELDS_MAX,
      dateFieldTypes: ["date"],
      titleFieldTypes: [...CALENDAR_TITLE_FIELD_TYPES],
      colorFieldTypes: [...CALENDAR_COLOR_FIELD_TYPES],
    },
    optionalRegistryKeys: [
      { key: "layout.Calendar", description: "Draws a calendar view (CalendarProps). Optional for now: without it a calendar view renders an error summary instead. It becomes required once the reference component set ships a calendar." },
    ],
    measures: MEASURE_OPS.map((op) => MEASURE_SPECS[op]),
    grid: {
      columns: { default: GRID_COLUMNS_DEFAULT, max: MAX_GRID_COLUMNS },
      items: GRID_ITEM_KEYS.map(({ key, min }) => ({ key, min, max: GRID_ITEM_MAX })),
    },
    limits: { pageSize: { max: PAGE_SIZE_MAX }, rowActionDepth: { max: MAX_ROW_ACTION_DEPTH } },
    errorCodes: [...ERROR_CODES],
  };
}
