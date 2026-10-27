// The tables and limits the validator enforces, next to the short human
// descriptions `describeContract()` reports. The validator imports these
// constants, so the description and the validation cannot drift apart.

import type { ConditionOp } from "./condition.js";
import { CONDITION_OPS, MAX_RELATIVE_DAYS, MAX_RELATIVE_HOURS, RELATIVE_DATE_OPS } from "./condition.js";
import type { CalendarMode, Document, FieldType, MeasureOp, SeriesBucket, SeriesDisplay, SeriesSortBy, SeriesSortDir, ViewerFactType, WidgetType } from "./document.js";
import { ACTIONS_MAX, ACTION_CONFIRM_TONES, ACTION_INPUT_FIELD_TYPES, ACTION_INPUT_MAX, CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT, CALENDAR_MAX_ENTRIES_PER_DAY_MAX, CALENDAR_MODES, RECORD_ACTIONS_MAX, FIELD_TYPES, MEASURE_OPS, SERIES_BUCKETS, SERIES_DISPLAYS, SERIES_LIMIT_DEFAULT, SERIES_LIMIT_MAX, SERIES_SORT_BYS, SERIES_SORT_DIRS, SPEC_VERSION, VIEWER_FACT_TYPES, WIDGET_TYPES } from "./document.js";

/** Document kinds, discriminated on `kind`. */
export const DOCUMENT_KINDS = ["entity", "form", "table", "calendar", "board", "dashboard", "viewer"] as const;

/** Ids for fields, sections, tabs, grid items, columns, documents and views. */
export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ID_HINT = 'Use lowercase letters, digits and underscores, starting with a letter (e.g. "workout_set").';

/** A whole number from 1 to 1000 is a valid `pageSize`. */
export const PAGE_SIZE_MAX = 1000;

/** A `maxLength` on a text field is a whole number of characters from 1 to this (RFC 0008 item 13c, card 47g). */
export const TEXT_MAX_LENGTH_CEILING = 100000;

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

/** A board groups by at most this many fields. */
export const BOARD_GROUP_BY_MAX = 5;
/** A board shows at most this many card fields under a card's title. */
export const BOARD_CARD_FIELDS_MAX = 3;
/** Field types a board's groupBy entries may have. */
export const BOARD_GROUP_FIELD_TYPES: readonly FieldType[] = ["select", "boolean", "reference"];
/** Field types a series `groupBy.field` may have (RFC 0001 slice 2, decision 2). */
export const SERIES_GROUP_FIELD_TYPES: readonly FieldType[] = ["select", "boolean", "reference", "text", "date"];
/** Field types a board's titleField may have. */
export const BOARD_TITLE_FIELD_TYPES: readonly FieldType[] = ["text", "select"];

/** A viewer document declares 1 to this many facts; a select fact lists 2 to this many values (RFC 0006). */
export const VIEWER_FACTS_MAX = 8;
export const VIEWER_FACT_VALUES_MAX = 8;
export const VIEWER_FACT_VALUES_MIN = 2;

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
  | { readonly kind: "single"; readonly keys: ["condition"] }
  | { readonly kind: "viewer"; readonly keys: ["fact", "values"] }
  /** RFC 0009 item 1: names a record field AND a viewer fact; a record leaf, so a filter place rejects it. */
  | { readonly kind: "fieldEqFact"; readonly keys: ["field", "fact"] };

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

/** Where a condition may appear and what it may read (RFC 0006). `record` leaves read the record; `viewer` leaves are `viewerIn`. */
interface ConditionPlaceSpec {
  /** JSON Pointer pattern into the document; `*` stands for an array index. */
  readonly path: string;
  /** The document kinds that have this key. */
  readonly kinds: readonly Document["kind"][];
  /** `record+viewer`: any condition. `viewer`: only viewerIn, and, or, not. `record`: no viewerIn (filters are sent to the server). */
  readonly accepts: "record+viewer" | "viewer" | "record";
  readonly description: string;
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
    readonly relativeInstant: { readonly description: string; readonly ops: readonly ConditionOp[]; readonly fieldTypes: readonly FieldType[]; readonly maxHours: number; readonly example: string };
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
  /** Limits and defaults of the `board` view kind. */
  readonly board: {
    readonly groupByMax: number;
    readonly cardFieldsMax: number;
    readonly groupFieldTypes: readonly FieldType[];
    readonly titleFieldTypes: readonly FieldType[];
  };
  /** Limits and defaults of the `series` widget (RFC 0001 slice 2). */
  readonly series: {
    readonly displays: readonly SeriesDisplay[];
    readonly buckets: readonly SeriesBucket[];
    readonly sortBys: readonly SeriesSortBy[];
    readonly sortDirs: readonly SeriesSortDir[];
    readonly groupFieldTypes: readonly FieldType[];
    readonly limit: { readonly default: number; readonly min: number; readonly max: number };
  };
  /** The `viewer` document kind (RFC 0006): the facts a host can tell the renderers about the viewer. */
  readonly viewer: {
    readonly factTypes: readonly ViewerFactType[];
    readonly factsMax: number;
    readonly factValuesMax: number;
    readonly factValuesMin: number;
    /** A set has at most this many viewer documents. */
    readonly documentsMax: number;
  };
  /** Limits of entity `actions` (RFC 0007). */
  readonly actions: {
    /** A view offers at most this many of them (`recordActions`). */
    readonly recordActionsMax: number;
    readonly max: number;
    readonly inputMax: number;
    readonly inputFieldTypes: readonly FieldType[];
    readonly confirmTones: readonly string[];
  };
  /** Every place a condition can appear and which kinds of leaf it accepts. */
  readonly conditionPlaces: readonly ConditionPlaceSpec[];
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
      { key: "fields", required: true, description: "The fields, an array of { id, type, label, required?, readOnly?, ... }. readOnly (RFC 0010) accepts only true: the server sets the field (an id, a created-at). It is shown in tables, conditions and bindings, but refused as a form item, an editable column or an inline edit; a write does not send it, and recordJsonSchema(entity, { mode: \"write\" }) leaves it out. required together with readOnly is valid: stored records carry it, but it is never a form requirement." },
      {
        key: "actions",
        required: false,
        description: `Commands a record can run (RFC 0007): an array of ${ACTIONS_MAX} at most, each { id, label, confirm?, input?, visibleWhen? }. confirm is { message, title?, confirmLabel?, tone?: "neutral" | "danger", subjectField? }; subjectField is a field id of the entity (any type, read-only allowed), and the dialog shows that field's display value as a subject line under the message, the way a table cell shows it. input is 1 to ${ACTION_INPUT_MAX} fields of type ${ACTION_INPUT_FIELD_TYPES.join(", ")} (never reference), each id once. visibleWhen takes record and viewerIn leaves: the action is offered on a record only while it holds. An action with neither confirm nor input runs on press; one with input always asks in a dialog. Views offer actions with recordActions; the server runs and authorises them.`,
      },
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
      { key: "sections", required: true, description: 'An array of sections: { id, title?, items: [{ field, visibleWhen?, requiredWhen?, clearWhenHidden? }] } OR { id, title?, subRecords: { entity, via, titleField, doneField, orderField?, addLabel? } } — never both keys in one section. The items conditions may mix record leaves and viewerIn leaves; clearWhenHidden cannot be true while visibleWhen reads the viewer. A subRecords section (RFC 0009 item 3) hosts an inline checklist over another entity whose records carry a `via` reference back to this form\'s entity; each row is an ordinary record with its own can and version.' },
      { key: "repeat", required: false, description: 'The one legal value is "batch" (RFC 0009 item 4): the host renders the field set N times and the write path creates N records atomically.' },
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
      { key: "columns", required: true, description: "An array of { field, editable?, visibleWhen?, editableWhen?, compare?, sortable? }; at least one, each field once. compare (RFC 0007) shows what changed in a text field: { \"to\": \"previousRow\" | \"nextRow\" } diffs it against that neighbour in the table's own order, { \"field\": \"<other text field>\" } against another text field of the same record. The cell shows the column's value as the after; text fields only, never together with editable. sortable (RFC 0010) accepts only false and keeps this column's header from offering a sort; a declared sort naming the column is an error. visibleWhen and editableWhen are viewer conditions (viewerIn, and, or, not): the column is shown, or edited in place, only while they hold for the viewer. editableWhen needs editable: true and can only narrow it." },
      { key: "title", required: false, description: "Caption shown with the table." },
      { key: "sort", required: false, description: "Initial sort: an array of { field, dir: \"asc\" | \"desc\" }." },
      { key: "sortable", required: false, description: "Only false is accepted (RFC 0010): no column offers a sort, for a list the server serves in one order. A declared sort is then an error. A single column can opt out with its own sortable: false." },
      { key: "pageSize", required: false, description: "Rows per page, a whole number from 1 to 1000." },
      { key: "filter", required: false, description: "A condition every row must always match." },
      { key: "filters", required: false, description: 'Named saved filters the host offers as chips (RFC 0009 item 5): an array of { id, name, condition }; the condition is a condition over this entity, checked exactly like the view\'s own filter. Which filter is selected is the host\'s business, not the document\'s.' },
      { key: "quickFilters", required: false, description: "An array of { field, default?, label?, placeholder? }; the viewer can set them. Select and boolean fields match exactly, text by substring, number, date and datetime fields as a from/to range (either end may stay empty). default (RFC 0010) is the filter's initial state only, never persisted, and the viewer clears it like any chip: a string for select (one of its options), text and time fields, true or false for boolean, an array of strings for tags, { from?, to? } for number (numbers), date (\"YYYY-MM-DD\") and datetime (stored instants like \"2026-10-17T09:30:00.000Z\") fields. label names the control (the field's label is the default). placeholder is hint text for text filters only." },
      { key: "addForm", required: false, description: "The id of a form document over the same entity (RFC 0008 item 4): the table renders an add affordance that opens that form and reloads after a save. The target must exist, be a form, and share this table's entity." },
      { key: "rowAction", required: false, description: `Opens another table view from a row: { open: <table view id>, bind: [{ field, to }], mode?: "replace" }. Each binding adds eq(to, row value of field) to the target's own filter; field is on this table's entity, to on the target's, both of the same field type. The reserved field "id" binds the record's own id (unless the entity declares a field named id) to a text field or to a reference to this entity. At least one binding; chains run at most ${MAX_ROW_ACTION_DEPTH} hops with no revisits. Table targets and "replace" mode only. visibleWhen (a viewer condition) hides the action from viewers it does not hold for.` },
      { key: "recordActions", required: false, description: `The ids of the entity's actions this view offers on each row, in this order: 1 to ${RECORD_ACTIONS_MAX}, each once, each declared on the view's entity. An action shows on a row only while its visibleWhen holds and the record's can.actions does not say false; a view whose adapter cannot run actions shows an error. A dashboard embedding the view inherits them.` },
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
      { key: "maxEntriesPerDay", required: false, description: `Entries a day cell shows before "+N more": an integer from 1 to ${CALENDAR_MAX_ENTRIES_PER_DAY_MAX}. Defaults to ${CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT} (RFC 0008 item 7).` },
      { key: "doneField", required: false, description: "The id of a boolean field of the entity (RFC 0008 item 3): each entry renders a completion toggle that patches just that field through the adapter's normal save, disabled without can.update. Not the dateField." },
      { key: "filter", required: false, description: "A condition every entry must always match (relative dates allowed)." },
      { key: "sort", required: false, description: "Order of entries within a day: an array of { field, dir }. Defaults to the title field, ascending." },
      { key: "modes", required: false, description: `The periods the viewer can switch between, from ${CALENDAR_MODES.join(", ")}; non-empty, no duplicates, the first is the default. Defaults to [${CALENDAR_MODES_DEFAULT.map((m) => JSON.stringify(m)).join(", ")}].` },
      { key: "weekStartsOn", required: false, description: `First day of the week: a whole number from 0 (Sunday) to 6. Defaults to ${CALENDAR_WEEK_STARTS_ON_DEFAULT} (Monday).` },
      { key: "editable", required: false, description: "Whether moving an entry to another day changes its date field. Defaults to false." },
      { key: "editableWhen", required: false, description: "A viewer condition (viewerIn, and, or, not): moving is offered only while it holds for the viewer. Needs editable: true; can only narrow it." },
      { key: "rowAction", required: false, description: `Opens a table view from an entry, as on tables: { open: <table view id>, bind: [{ field, to }], mode? }. A calendar can start a chain (at most ${MAX_ROW_ACTION_DEPTH} hops in all), never be the target.` },
      { key: "recordActions", required: false, description: `The ids of the entity's actions this view offers on each entry, in this order: 1 to ${RECORD_ACTIONS_MAX}, each once, each declared on the view's entity. An action shows on an entry only while its visibleWhen holds and the record's can.actions does not say false; a view whose adapter cannot run actions shows an error. A dashboard embedding the view inherits them.` },
    ],
  },
  {
    kind: "board",
    description: "Records of one entity shown as cards in columns, one column per value of a field; with editable, dragging a card to another column changes that field.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "board".' },
      { key: "specVersion", required: true, description: `The engine document format version. Currently ${SPEC_VERSION}; documents of older versions are upgraded with migrate().` },
      { key: "id", required: true, description: "The board's id." },
      { key: "entity", required: true, description: "The id of the entity whose records are shown." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      { key: "dataSource", required: true, description: "Key the host maps to a DataAdapter. Never a URL." },
      { key: "groupBy", required: true, description: `An array of { field }: the fields the viewer may group by, 1 to ${BOARD_GROUP_BY_MAX} entries, each once, the first is the default. Each field must be a select, boolean or reference field (not a required boolean, which can only be true).` },
      { key: "columnsFrom", required: false, description: "With a reference groupBy: \"options\" builds columns from the target entity's records (through the adapter), so a group with no cards is still a drop target; \"records\" (the default) builds them from the loaded page (RFC 0008 item 10)." },
      { key: "doneField", required: false, description: "The id of a boolean field of the entity (RFC 0008 item 3): each card renders a completion toggle that patches just that field through the adapter's normal save, disabled without can.update. Not one of the groupBy fields." },
      { key: "title", required: false, description: "Accessible name and heading. Defaults to the entity id." },
      { key: "titleField", required: false, description: "The id of a text or select field shown as the card's title. Defaults to the entity's first text field; required when the entity has none." },
      { key: "cardFields", required: false, description: `Up to ${BOARD_CARD_FIELDS_MAX} field ids shown small under the title, each once, not the title field.` },
      { key: "filter", required: false, description: "A condition every card must always match (relative dates allowed)." },
      { key: "sort", required: false, description: "Order of cards within a column: an array of { field, dir }. Defaults to the title field, ascending." },
      { key: "editable", required: false, description: "Whether dragging a card to another column changes the field currently grouping the board. Defaults to false." },
      { key: "editableWhen", required: false, description: "A viewer condition (viewerIn, and, or, not): moving is offered only while it holds for the viewer. Needs editable: true; can only narrow it." },
      { key: "rowAction", required: false, description: `Opens a table view from a card, as on tables: { open: <table view id>, bind: [{ field, to }], mode? }. A board can start a chain (at most ${MAX_ROW_ACTION_DEPTH} hops in all), never be the target.` },
      { key: "recordActions", required: false, description: `The ids of the entity's actions this view offers on each card, in this order: 1 to ${RECORD_ACTIONS_MAX}, each once, each declared on the view's entity. An action shows on a card only while its visibleWhen holds and the record's can.actions does not say false; a view whose adapter cannot run actions shows an error. A dashboard embedding the view inherits them.` },
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
      { key: "tabs", required: true, description: "An array of { id, title, columns?, visibleWhen?, items: [...] }; at least one. Every grid item may also carry visibleWhen. visibleWhen is a viewer condition (viewerIn, and, or, not): a tab is listed, or a widget rendered, only while it holds for the viewer; a hidden widget leaves its cell empty. A grid item is { id, x, y, w, h, ... }: x and y count from 0, w and h from 1. w is the number of columns it spans. One row (h = 1) is a fixed height, 4rem unless the host sets --yadad-grid-row-height, so an item h rows high is as tall as h rows plus the gaps between them (--yadad-grid-gap, 1rem by default); below the stack width the renderer stacks the items in reading order and every row sizes to its content." },
      { key: "title", required: false, description: "Caption shown with the dashboard." },
    ],
  },
  {
    kind: "viewer",
    description: "The facts a host can tell the renderers about the viewer (a role, a plan, a feature flag), read by viewerIn conditions. A set has at most one. It is not a view: it draws nothing.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "viewer".' },
      { key: "specVersion", required: true, description: `The engine document format version. Currently ${SPEC_VERSION}; documents of older versions are upgraded with migrate().` },
      { key: "id", required: true, description: "The viewer document's id." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      {
        key: "facts",
        required: true,
        description: `An array of ${VIEWER_FACTS_MAX} facts at most (at least one), each id once: { id, label, type: ${VIEWER_FACT_TYPES.map((t) => JSON.stringify(t)).join(" | ")}, default, options? }. A select fact needs options { source: "static", values } with ${VIEWER_FACT_VALUES_MIN} to ${VIEWER_FACT_VALUES_MAX} values and a default that is one of them; a boolean fact has no options and a true/false default. The default is what a viewer the host says nothing about gets: pick the least-privileged one.`,
      },
    ],
  },
];

const FIELD_SPECS: Record<FieldType, FieldSpec> = {
  text: {
    type: "text",
    description: "A short or long text value.",
    properties: [
      { key: "multiline", required: false, description: "Render the form input as a textarea and keep line breaks in display (RFC 0008 item 13a). Storage is unchanged — the record still stores a plain string." },
      { key: "maxLength", required: false, description: `Maximum stored length in characters: a whole number from 1 to ${TEXT_MAX_LENGTH_CEILING} (RFC 0008 item 13c). The client can refuse too-long input before the round trip.` },
    ],
  },
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
    properties: [{ key: "options", required: true, description: '{ source: "static", values: [non-empty, unique entries] }; at least one value. An entry is a text or { value, label?, color? }; a color is one of the eight COLOR_PALETTE hexes (any other is a warning and paints nothing).' }],
  },
  date: {
    type: "date",
    description: 'A calendar date, stored as "YYYY-MM-DD".',
    properties: [
      { key: "min", required: false, description: 'Earliest allowed date, "YYYY-MM-DD".' },
      { key: "max", required: false, description: 'Latest allowed date, "YYYY-MM-DD".' },
    ],
  },
  datetime: {
    type: "datetime",
    description:
      'An instant, stored in exactly one form: "YYYY-MM-DDTHH:MM:SS.sssZ" (UTC, three fractional digits, a trailing Z; what Date.prototype.toISOString prints). Shown in the viewer\'s time zone. Conditions on it take eq, neq, gt, gte, lt, lte, in, empty and notEmpty (no contains) with an instant of that form as the value. It cannot be a calendar dateField or a board groupBy. Use it only with a registry that has fields.datetime.',
    properties: [
      { key: "min", required: false, description: 'Earliest allowed instant, "YYYY-MM-DDTHH:MM:SS.sssZ".' },
      { key: "max", required: false, description: 'Latest allowed instant, "YYYY-MM-DDTHH:MM:SS.sssZ".' },
    ],
  },
  time: {
    type: "time",
    description:
      'A time of day (RFC 0008 item 14), stored as "HH:MM" — 24-hour, zero-padded, no day and no zone. A time-only comparison compares minutes from midnight and is legal wherever eq, neq, gt, gte, lt, lte, in, empty and notEmpty are. Separate from date by design: due_date plus due_time stay two fields, and a calendar entry is never placed by a time.',
    properties: [
      { key: "min", required: false, description: 'Earliest allowed time, "HH:MM".' },
      { key: "max", required: false, description: 'Latest allowed time, "HH:MM".' },
      { key: "step", required: false, description: "Allowed increment in whole minutes greater than 0, e.g. 15. Defaults to any minute." },
    ],
  },
  tags: {
    type: "tags",
    description:
      'A list of free-text tags (RFC 0008 item 15), stored as an array of non-empty strings in the order entered — the only field type whose value is an array. Conditions: contains and in match ANY element (negate with not); empty and notEmpty treat an empty array as empty. It cannot be a sort key or a board groupBy.',
    properties: [],
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
  viewerIn: '{ "op": "viewerIn", "fact": "role", "values": ["editor", "owner"] } (the viewer\'s value of a fact declared in the viewer document is one of "values"; a list under "values")',
  fieldEqFact: '{ "op": "fieldEqFact", "field": "list", "fact": "home" } (the record\'s value of "field" equals the viewer\'s value of a fact declared in the viewer document)',
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
  viewerIn: { kind: "viewer", keys: ["fact", "values"] },
  fieldEqFact: { kind: "fieldEqFact", keys: ["field", "fact"] },
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
    description: "Embeds a form, table, calendar or board view, by id.",
    properties: [{ key: "view", required: true, description: "The id of the form, table, calendar or board view to embed. Counts and stats take table views only." }],
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
  series: {
    widget: "series",
    description:
      "Groups the records of a table view by one field and shows one measure per group as a table, bar chart or line chart. groupBy.field is a select, boolean, reference, text or date field (a number or datetime is refused); only a date takes bucket \"day\" | \"week\" | \"month\" (default day; week keys are the ISO week's Monday as YYYY-MM-DD, month keys YYYY-MM). Records without a group value are skipped and counted. A date series sorted by group fills missing buckets with 0 (count, sum, countDistinct) or no value (min, max, avg) so a line shows the gap, and past the limit keeps the newest buckets. At most 5000 records are read; past that the widget says the numbers are partial. Drawn by the optional widgets.series registry component; without it the widget names the missing key.",
    properties: [
      { key: "label", required: true, description: "Shown with the chart; doubles as its accessible name." },
      { key: "view", required: true, description: "The id of the table view to group." },
      { key: "groupBy", required: true, description: "The field to group by: { \"field\": \"<id>\" }, optionally with \"bucket\": \"day\" | \"week\" | \"month\" (dates only)." },
      { key: "measure", required: true, description: "What to compute per group: same shape as a stat's measure." },
      { key: "display", required: true, description: "\"table\", \"bar\" or \"line\"." },
      { key: "sort", required: false, description: "{ \"by\": \"group\" | \"value\", \"dir\": \"asc\" | \"desc\" }. Default group ascending." },
      { key: "limit", required: false, description: "Whole number 1 to 200 groups shown; default 50." },
      { key: "filter", required: false, description: "A condition that narrows the records further." },
    ],
  },
};

const CONDITION_PLACE_SPECS: readonly ConditionPlaceSpec[] = [
  { path: "/actions/*/visibleWhen", kinds: ["entity"], accepts: "record+viewer", description: "The action is offered on a record only while this holds for the record's values and the viewer; otherwise it is not rendered." },
  { path: "/sections/*/items/*/visibleWhen", kinds: ["form"], accepts: "record+viewer", description: "A viewer leaf that is false hides the field exactly like a record condition. clearWhenHidden: true is rejected while this reads the viewer." },
  { path: "/sections/*/items/*/requiredWhen", kinds: ["form"], accepts: "record+viewer", description: "Requires the field while the condition holds." },
  { path: "/columns/*/visibleWhen", kinds: ["table"], accepts: "viewer", description: "The column is not shown while this is false." },
  { path: "/columns/*/editableWhen", kinds: ["table"], accepts: "viewer", description: "The column is editable in place only while this holds; needs the column's editable: true." },
  { path: "/editableWhen", kinds: ["calendar", "board"], accepts: "viewer", description: "Moving is offered only while this holds; needs editable: true." },
  { path: "/rowAction/visibleWhen", kinds: ["table", "calendar", "board"], accepts: "viewer", description: "While false, rows, entries and cards do not open the target view." },
  { path: "/tabs/*/visibleWhen", kinds: ["dashboard"], accepts: "viewer", description: "The tab is not listed while this is false." },
  { path: "/tabs/*/items/*/visibleWhen", kinds: ["dashboard"], accepts: "viewer", description: "The widget is not rendered while this is false; its cell stays empty." },
  { path: "/filter", kinds: ["table", "calendar", "board"], accepts: "record", description: "A filter is sent to the server as a query, so it cannot depend on the viewer." },
  { path: "/filters/*/condition", kinds: ["table"], accepts: "record", description: "RFC 0009 item 5: a saved filter is a query shape, checked by the same rule as /filter — viewer leaves are banned." },
  { path: "/tabs/*/items/*/filter", kinds: ["dashboard"], accepts: "record", description: "The filter of a count or stat widget; it cannot depend on the viewer." },
];

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
      maxValueType: "text, a number or true/false (contains: text only; eq, neq, gt, gte, lt, lte on a date field also take a relative date, and on a datetime field a relative instant)",
      maxDepth: MAX_CONDITION_DEPTH,
      relativeDate: {
        description:
          'Instead of a fixed "YYYY-MM-DD", the value of a comparison may be { "daysFromToday": <whole number> } (0 is today, -7 a week ago, 1 tomorrow), resolved from the viewer\'s local date. Date fields only; not in "in" or "contains".',
        ops: [...RELATIVE_DATE_OPS],
        fieldTypes: ["date"],
        maxDays: MAX_RELATIVE_DAYS,
        example: '{ "op": "gte", "field": "day", "value": { "daysFromToday": -7 } }',
      },
      relativeInstant: {
        description:
          'Instead of a fixed instant, the value of a comparison may be { "hoursFromNow": <whole number> } (0 is now, -24 a day ago, 2 in two hours), resolved at query time to the stored UTC instant. Datetime fields only; not in "in" or "contains". A "daysFromToday" value stays refused on a datetime field.',
        ops: [...RELATIVE_DATE_OPS],
        fieldTypes: ["datetime"],
        maxHours: MAX_RELATIVE_HOURS,
        example: '{ "op": "gte", "field": "at", "value": { "hoursFromNow": -24 } }',
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
    board: {
      groupByMax: BOARD_GROUP_BY_MAX,
      cardFieldsMax: BOARD_CARD_FIELDS_MAX,
      groupFieldTypes: [...BOARD_GROUP_FIELD_TYPES],
      titleFieldTypes: [...BOARD_TITLE_FIELD_TYPES],
    },
    series: {
      displays: [...SERIES_DISPLAYS],
      buckets: [...SERIES_BUCKETS],
      sortBys: [...SERIES_SORT_BYS],
      sortDirs: [...SERIES_SORT_DIRS],
      groupFieldTypes: [...SERIES_GROUP_FIELD_TYPES],
      limit: { default: SERIES_LIMIT_DEFAULT, min: 1, max: SERIES_LIMIT_MAX },
    },
    viewer: { factTypes: [...VIEWER_FACT_TYPES], factsMax: VIEWER_FACTS_MAX, factValuesMax: VIEWER_FACT_VALUES_MAX, factValuesMin: VIEWER_FACT_VALUES_MIN, documentsMax: 1 },
    actions: { recordActionsMax: RECORD_ACTIONS_MAX, max: ACTIONS_MAX, inputMax: ACTION_INPUT_MAX, inputFieldTypes: [...ACTION_INPUT_FIELD_TYPES], confirmTones: [...ACTION_CONFIRM_TONES] },
    conditionPlaces: CONDITION_PLACE_SPECS,
    optionalRegistryKeys: [
      { key: "layout.Calendar", description: "Draws a calendar view (CalendarProps). Optional for now: without it a calendar view renders an error summary instead. It becomes required once the reference component set ships a calendar." },
      { key: "layout.Board", description: "Draws a board view (BoardProps). Optional for now: without it a board view renders an error summary instead. It becomes required once the reference component set ships a board." },
      { key: "fields.datetime", description: "The Input and Display of a datetime field (RFC 0007). Optional: a document that uses a datetime field with a registry that lacks it renders an error summary naming the key instead." },
      { key: "layout.Dialog", description: "Draws a modal dialog around content the renderer builds (DialogProps; RFC 0007). Optional: an action that needs a confirmation or input, rendered with a registry that lacks it, shows an error summary instead. Actions with neither need no dialog." },
      { key: "widgets.series", description: "Draws a series widget (SeriesWidgetProps; RFC 0001 slice 2). Optional for now: without it a series widget renders an error summary naming the key instead. It becomes required once the reference component set ships charts." },
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
