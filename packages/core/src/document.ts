// PRE-CONTRACT document shapes: entities with the five v0 field types and
// form views. Table and dashboard views, and the frozen contract, come later.

import type { Condition, ViewerCondition } from "./condition.js";

/**
 * Engine document format version. Version 1 adds relative dates in conditions
 * (`{ daysFromToday }`); a version 0 document is valid as it is, and
 * `migrate()` stamps it as version 1. Version 2 adds the first slices of
 * RFCs 0001-0003 (the `stat` widget, the `reference` field, table
 * `rowAction`); older documents stay valid and `migrate()` stamps them.
 * Version 3 adds the `calendar` view (RFC 0004); older documents stay valid
 * and `migrate()` stamps them. Version 4 adds the `board` view (RFC 0005);
 * older documents stay valid and `migrate()` stamps them. Version 5 adds the
 * `viewer` document kind, the `viewerIn` condition op and the viewer-only
 * `visibleWhen`/`editableWhen` keys (RFC 0006); older documents stay valid and
 * `migrate()` stamps them. Version 6 adds the RFC 0007 round (the `datetime`
 * field type, entity `actions`, view `recordActions`, the table column
 * `compare` setting); older documents stay valid and `migrate()` stamps them.
 * Version 7 adds the dashboard `series` widget (RFC 0001 slice 2); older
 * documents stay valid and `migrate()` stamps them.
 */
export const SPEC_VERSION = 8;
/** Every version the validator accepts: the current one and older ones that `migrate()` upgrades. */
export const SUPPORTED_SPEC_VERSIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export type SpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];

/** Field types known to the engine. */
export const FIELD_TYPES = ["text", "number", "boolean", "select", "date", "datetime", "reference", "time", "tags"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

interface FieldBase {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
}

export interface TextField extends FieldBase {
  readonly type: "text";
  /** Render the form input as a textarea and keep line breaks in display (RFC 0008 item 13a). Storage is unchanged — still a string. */
  readonly multiline?: boolean;
  /** Maximum stored length; the client can refuse "too long" before the round trip (RFC 0008 item 13c). A positive whole number. */
  readonly maxLength?: number;
}

export interface NumberField extends FieldBase {
  readonly type: "number";
  readonly min?: number;
  readonly max?: number;
  /** Allowed increment, e.g. 0.5. Defaults to any number. */
  readonly step?: number;
  /** Shown next to the value, e.g. "kg". */
  readonly unit?: string;
}

/** A yes/no value. `required: true` means it must be checked (e.g. a consent box). */
export interface BooleanField extends FieldBase {
  readonly type: "boolean";
}

/** One option of a fixed list. Plain strings stay legal and mean `{ value }` (RFC 0008 item 5). */
export interface StaticOptionValue {
  readonly value: string;
  /** Human-readable name; defaults to `value`. Display-only — records store `value`. */
  readonly label?: string;
  /** `#RRGGBB` display hint (a swatch). Display-only; never stored. */
  readonly color?: string;
}

/** A fixed list of choices. Dynamic sources (another entity) come later. */
export interface StaticOptions {
  readonly source: "static";
  readonly values: readonly (string | StaticOptionValue)[];
}

/** Whether a static option is written as an object (RFC 0008 item 5). */
export function isStaticOptionValue(option: string | StaticOptionValue): option is StaticOptionValue {
  return typeof option === "object" && option !== null;
}

/** The stored value of a static option, however it was written. */
export function optionValue(option: string | StaticOptionValue): string {
  return isStaticOptionValue(option) ? option.value : option;
}

/** The text that labels a static option: its label when it has one, else its value (RFC 0008 item 5). */
export function optionLabel(option: string | StaticOptionValue): string {
  return isStaticOptionValue(option) ? option.label ?? option.value : option;
}

/** The option's `#RRGGBB` swatch hint, when it carries one (RFC 0008 item 5). Display-only; never stored. */
export function optionColor(option: string | StaticOptionValue): string | undefined {
  return isStaticOptionValue(option) ? option.color : undefined;
}

export interface SelectField extends FieldBase {
  readonly type: "select";
  readonly options: StaticOptions;
}

/** A calendar date, stored as "YYYY-MM-DD". */
export interface DateField extends FieldBase {
  readonly type: "date";
  readonly min?: string;
  readonly max?: string;
}

/**
 * An instant (RFC 0007), stored in exactly one form: "YYYY-MM-DDTHH:MM:SS.sssZ"
 * (UTC, three fractional digits, `Z`). Shown in the viewer's time zone.
 */
export interface DatetimeField extends FieldBase {
  readonly type: "datetime";
  /** Earliest allowed instant, in the stored form. */
  readonly min?: string;
  /** Latest allowed instant, in the stored form. */
  readonly max?: string;
}

/**
 * A time of day (RFC 0008 item 14), stored as "HH:MM" — 24-hour, zero-padded,
 * no day and no zone. Separate from `date` by design: `due_date` + `due_time`
 * stay two fields, a calendar entry is never placed by a `time`, and a
 * `datetime` remains the one-field answer when the instant itself is the fact.
 */
export interface TimeField extends FieldBase {
  readonly type: "time";
  /** Earliest allowed time, "HH:MM". */
  readonly min?: string;
  /** Latest allowed time, "HH:MM". */
  readonly max?: string;
  /** Allowed increment in minutes, e.g. 15. Defaults to any minute. */
  readonly step?: number;
}

/**
 * A list of free-text tags (RFC 0008 item 15), stored as an array of non-empty
 * strings in the order entered. The only field type whose value is an array.
 * Conditions: contains and in match ANY element (negate with not); empty and
 * notEmpty work as usual. Never a sort key, a board groupBy or a series groupBy.
 */
export interface TagsField extends FieldBase {
  readonly type: "tags";
}

/**
 * A link to a record of another entity (RFC 0002). The stored value is the
 * target record's id, a string. The server owns referential integrity; the
 * engine only offers existing records in the picker.
 */
export interface ReferenceField extends FieldBase {
  readonly type: "reference";
  /** Id of the target entity. Self references are allowed. */
  readonly entity: string;
  /** Id of a text or select field on the target that labels a record. Defaults to the target's first text field. */
  readonly display?: string;
  /**
   * Id of a colour-shaped field on the target (a hex-constrained `text`, or a `select` whose chosen
   * option carries `color` — RFC 0008 item 5): the entry borrows the referenced record's colour
   * (RFC 0008 item 8). Absent: the stable hash stays the colouring.
   */
  readonly colorFrom?: string;
}

/** Discriminated on `type`. */
export type Field = TextField | NumberField | BooleanField | SelectField | DateField | DatetimeField | ReferenceField | TimeField | TagsField;

/** An entity declares at most this many record actions, and an action at most this many input fields (RFC 0007). */
export const ACTIONS_MAX = 12;
export const ACTION_INPUT_MAX = 5;
/** A table, board or calendar offers at most this many actions on a record. */
export const RECORD_ACTIONS_MAX = 6;
/** A day cell shows this many entries before "+N more" unless the view says otherwise (RFC 0008 item 7). */
export const CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT = 3;
export const CALENDAR_MAX_ENTRIES_PER_DAY_MAX = 31;
/** Upper bound for a view-level label override (RFC 0008 item 6). */
export const FORM_ITEM_LABEL_MAX = 120;
/** Field types an action's input fields may have: those with a plain input, not `reference` (a picker needs a target query). */
export const ACTION_INPUT_FIELD_TYPES = ["text", "number", "boolean", "select", "date", "datetime", "time"] as const;
export type ActionInputFieldType = (typeof ACTION_INPUT_FIELD_TYPES)[number];
export const ACTION_CONFIRM_TONES = ["neutral", "danger"] as const;
export type ActionConfirmTone = (typeof ACTION_CONFIRM_TONES)[number];

/** A field definition of an action's input: the same properties as the entity field of that type. */
export type ActionInputField = TextField | NumberField | BooleanField | SelectField | DateField | DatetimeField | TimeField;

/** What the dialog says before an action runs. */
export interface ActionConfirm {
  readonly title?: string;
  readonly message: string;
  readonly confirmLabel?: string;
  /** "danger" marks the confirm button as destructive. Defaults to "neutral". */
  readonly tone?: ActionConfirmTone;
}

/**
 * A named command a record can run (RFC 0007): approve, reject, restore. The
 * server decides what it changes; the document only says what is offered.
 */
export interface RecordAction {
  readonly id: string;
  /** The button text. */
  readonly label: string;
  /** Absent: the action runs on press without a dialog, unless it has `input`. */
  readonly confirm?: ActionConfirm;
  /** Asked for in the dialog; at most `ACTION_INPUT_MAX` fields. */
  readonly input?: readonly ActionInputField[];
  /** Offered on a record only while this holds (record and viewerIn leaves, as on a form item). */
  readonly visibleWhen?: Condition;
}

/** Data model: owns fields, types and validation. */
export interface EntityDocument {
  readonly kind: "entity";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly revision: number;
  readonly fields: readonly Field[];
  /** Commands a record can run; views offer them with `recordActions` (RFC 0007). */
  readonly actions?: readonly RecordAction[];
}

export interface FormItem {
  /** Id of a field on the view's entity. */
  readonly field: string;
  /** Display label for this view only; defaults to the entity field's label (RFC 0008 item 6). */
  readonly label?: string;
  /** Show the field only while this holds. */
  readonly visibleWhen?: Condition;
  /** Require the field while this holds (views can only tighten the entity's rules). */
  readonly requiredWhen?: Condition;
  /** Drop the field's value while it is hidden. Defaults to false: hidden values are kept. */
  readonly clearWhenHidden?: boolean;
}

/**
 * A declared sub-record checklist section (RFC 0009 item 3, ratified (b)): a
 * second entity whose records carry a `reference` back to the form's entity.
 * Each child stays an ordinary record — its own `can`, its own version; the
 * form only hosts the editing affordance, and writes go through the adapter
 * as ordinary writes to `entity`.
 */
export interface SubRecordSection {
  /** Id of the child entity; it must exist and carry `via` as a reference to the form's entity. */
  readonly entity: string;
  /** Id of a `reference` field on `entity` whose target is the form's entity. */
  readonly via: string;
  /** Id of a text field on `entity`: what the row's input edits. */
  readonly titleField: string;
  /** Id of a boolean field on `entity`: the row's checkbox. */
  readonly doneField: string;
  /** Id of a number field on `entity`: ascending order of the rows. Optional. */
  readonly orderField?: string;
  /** Label for the add-row control. Defaults to the renderer's "Add <entity title>". */
  readonly addLabel?: string;
}

/** A section holds fields OR a sub-record checklist — discriminated by which key is present. */
export interface FormSection {
  readonly id: string;
  readonly title?: string;
  /** Field layout. Absent exactly when `subRecords` is present. */
  readonly items?: readonly FormItem[];
  /** Inline checklist over a child entity (RFC 0009 item 3). Absent exactly when `items` is present. */
  readonly subRecords?: SubRecordSection;
}

/** Layout only: references entity fields by id. */
export interface FormView {
  readonly kind: "form";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly entity: string;
  readonly revision: number;
  /** Key the host maps to a DataAdapter. Never a URL. */
  readonly dataSource: string;
  readonly sections: readonly FormSection[];
  /**
   * The host renders the field set N times and the write path creates N
   * records atomically via `batch create` (RFC 0009 item 4). The one legal value.
   */
  readonly repeat?: "batch";
}

/** Which neighbour a `compare` column diffs against: the row before or after it in the table's own order. */
export const COMPARE_NEIGHBOURS = ["previousRow", "nextRow"] as const;
export type CompareNeighbour = (typeof COMPARE_NEIGHBOURS)[number];

/**
 * What a column's text is compared with (RFC 0007), exactly one of two:
 * the same field in a neighbouring row (`to`), or another text field of the
 * same record (`field`). The cell shows the column's value as the "after".
 */
export type ColumnCompare =
  | { readonly to: CompareNeighbour; readonly field?: never }
  | { readonly field: string; readonly to?: never };

export interface TableColumn {
  /** Id of a field on the view's entity. */
  readonly field: string;
  /** Whether rows can edit this column in place. Defaults to false. */
  readonly editable?: boolean;
  /** Show the column only while this holds for the viewer (RFC 0006). Absent: always shown. */
  readonly visibleWhen?: ViewerCondition;
  /** Edit the column in place only while this holds for the viewer. Needs `editable: true`; can only narrow it (RFC 0006). */
  readonly editableWhen?: ViewerCondition;
  /** Show what changed in this text field against a neighbouring row or another field (RFC 0007). Text fields only; not with `editable`. */
  readonly compare?: ColumnCompare;
}

export interface SortSpec {
  readonly field: string;
  readonly dir: "asc" | "desc";
}

/** Records of one entity as rows; columns reference entity fields by id. */
export interface TableView {
  readonly kind: "table";
  readonly specVersion: SpecVersion;
  readonly id: string;
  /** Caption shown with the table. */
  readonly title?: string;
  readonly entity: string;
  readonly revision: number;
  /** Key the host maps to a DataAdapter. Never a URL. */
  readonly dataSource: string;
  readonly columns: readonly TableColumn[];
  /** Initial sort; viewers can change it. First entry sorts first. */
  readonly sort?: readonly SortSpec[];
  /** Rows per page. Defaults to 25. */
  readonly pageSize?: number;
  /** Rows must always match this. */
  readonly filter?: Condition;
  /** Named saved filters the host offers as chips (RFC 0009 item 5); which one is selected stays the host's. */
  readonly filters?: readonly NamedFilter[];
  /**
   * Id of a form view over the SAME entity (RFC 0008 item 4): the table offers "Add {entity}" and
   * opens that form; a save reloads the table. It is `rowAction.open` in the create direction.
   */
  readonly addForm?: string;
  /** Quick filters the viewer can set: select and boolean fields match exactly, text fields by substring, number, date and datetime fields as a from/to range (gte/lte, either end optional). */
  readonly quickFilters?: readonly QuickFilter[];
  /** Clicking a row opens another table view scoped to that row (RFC 0003). */
  readonly rowAction?: RowAction;
  /** Ids of the entity's actions this view offers on each record, in this order (RFC 0007). 1 to `RECORD_ACTIONS_MAX`, each once. */
  readonly recordActions?: readonly string[];
}

/** Row action modes. Slice 1 has `replace` only (the target takes the table's place, with Back). */
export const ROW_ACTION_MODES = ["replace"] as const;
export type RowActionMode = (typeof ROW_ACTION_MODES)[number];

/** Copies the clicked row's `field` value into the target view's filter on `to` (an `eq` condition). */
export interface RowBinding {
  /** Id of a field on this table's entity. */
  readonly field: string;
  /** Id of a field on the target table's entity, of the same type. */
  readonly to: string;
}

/** Opens a table view, filtered by the clicked row. The documents are never modified. */
export interface RowAction {
  /** Id of a table view. */
  readonly open: string;
  /** At least one; every binding adds an `eq(to, row[field])` condition to the target's own filter. */
  readonly bind: readonly RowBinding[];
  /** Defaults to "replace". */
  readonly mode?: RowActionMode;
  /** Open the target only while this holds for the viewer (RFC 0006). Absent: always. */
  readonly visibleWhen?: ViewerCondition;
}

/** The periods a calendar can show. A phone-width agenda is a rendering choice, not a mode. */
export const CALENDAR_MODES = ["month", "week"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

/**
 * Records of one entity placed on the days of a month or week by one `date`
 * field (RFC 0004). With `editable`, moving an entry to another day changes
 * that field. Dates are calendar dates ("YYYY-MM-DD"): no time, no time zone.
 */
export interface CalendarView {
  readonly kind: "calendar";
  readonly specVersion: SpecVersion;
  readonly id: string;
  /** Accessible name and heading. Defaults to the entity id. */
  readonly title?: string;
  readonly entity: string;
  readonly revision: number;
  /** Key the host maps to a DataAdapter. Never a URL. */
  readonly dataSource: string;
  /** Id of a `date` field of the entity: the day an entry is placed on. */
  readonly dateField: string;
  /** Id of a text or select field shown as the entry's title. Defaults to the entity's first text field. */
  readonly titleField?: string;
  /** Up to CALENDAR_DETAIL_FIELDS_MAX field ids shown small under the title (not the date or title field). */
  readonly detailFields?: readonly string[];
  /**
   * Entries a day cell shows before "+N more" (RFC 0008 item 7). 1 to CALENDAR_MAX_ENTRIES_PER_DAY_MAX;
   * defaults to CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT (today's fixed cutoff, so no document changes today).
   */
  readonly maxEntriesPerDay?: number;
  /** Id of a select or reference field that colours entries. */
  readonly colorField?: string;
  /**
   * Id of a boolean field of the entity (RFC 0008 item 3): each entry renders a
   * completion toggle that patches just that field through the adapter's normal
   * save (not `act`), disabled without `can.update`. Opt-in; absent today.
   */
  readonly doneField?: string;
  /** Entries must always match this. */
  readonly filter?: Condition;
  /** Order of entries within a day. */
  readonly sort?: readonly SortSpec[];
  /** The periods the viewer can switch between; the first is the default. Non-empty, no duplicates. Defaults to ["month", "week"]. */
  readonly modes?: readonly CalendarMode[];
  /** First day of the week, 0 (Sunday) to 6. Defaults to 1 (Monday). */
  readonly weekStartsOn?: number;
  /** Moving an entry changes `dateField`. Defaults to false. */
  readonly editable?: boolean;
  /** Moving is offered only while this holds for the viewer. Needs `editable: true`; can only narrow it (RFC 0006). */
  readonly editableWhen?: ViewerCondition;
  /** Activating an entry opens a table view scoped to it, as on tables. A calendar can start a chain, never be a target. */
  readonly rowAction?: RowAction;
  /** Ids of the entity's actions this view offers on each record, in this order (RFC 0007). 1 to `RECORD_ACTIONS_MAX`, each once. */
  readonly recordActions?: readonly string[];
}

/** One field the viewer may group a board by. */
export interface BoardGroupBy {
  /** Id of a select, boolean or reference field on the view's entity. */
  readonly field: string;
}

/**
 * Records of one entity shown as cards in columns, one column per value of a
 * field (RFC 0005). `groupBy` lists the fields the viewer may group by (the
 * first is the default); with `editable`, dragging a card to another column
 * changes that field.
 */
export interface BoardView {
  readonly kind: "board";
  readonly specVersion: SpecVersion;
  readonly id: string;
  /** Accessible name and heading. Defaults to the entity id. */
  readonly title?: string;
  readonly entity: string;
  readonly revision: number;
  /** Key the host maps to a DataAdapter. Never a URL. */
  readonly dataSource: string;
  /** Fields the viewer may group by. 1 to BOARD_GROUP_BY_MAX entries, no duplicates; the first is the default. */
  readonly groupBy: readonly BoardGroupBy[];
  /** Id of a text or select field shown as the card's title. Defaults to the entity's first text field. */
  readonly titleField?: string;
  /** Up to BOARD_CARD_FIELDS_MAX field ids shown small under the title (not the title field), each once. */
  readonly cardFields?: readonly string[];
  /** Cards must always match this. */
  readonly filter?: Condition;
  /**
   * For a reference `groupBy`: build columns from the target entity's records (through the adapter)
   * instead of from the loaded page, so a group with no cards is still a drop target
   * (RFC 0008 item 10). Defaults to "records" — today's behaviour. Meaningful only with a reference groupBy.
   */
  readonly columnsFrom?: "options" | "records";
  /**
   * Id of a boolean field of the entity (RFC 0008 item 3): each card renders a
   * completion toggle that patches just that field through the adapter's normal
   * save (not `act`), disabled without `can.update`. Not one of the `groupBy`
   * fields — a card cannot both toggle it and move columns with it. Opt-in.
   */
  readonly doneField?: string;
  /** Order of cards within a column. */
  readonly sort?: readonly SortSpec[];
  /** Dragging a card changes the field it is currently grouped by. Defaults to false. */
  readonly editable?: boolean;
  /** Moving is offered only while this holds for the viewer. Needs `editable: true`; can only narrow it (RFC 0006). */
  readonly editableWhen?: ViewerCondition;
  /** Activating a card opens a table view scoped to it, as on tables. A board can start a chain, never be a target. */
  readonly rowAction?: RowAction;
  /** Ids of the entity's actions this view offers on each record, in this order (RFC 0007). 1 to `RECORD_ACTIONS_MAX`, each once. */
  readonly recordActions?: readonly string[];
}

export interface QuickFilter {
  readonly field: string;
}

/**
 * A document-level named saved filter (RFC 0009 item 5): query *shape*, not
 * query state — which one is selected stays the host's. The condition is over
 * the view's entity, checked by the same validator a view `filter` passes.
 */
export interface NamedFilter {
  readonly id: string;
  readonly name: string;
  readonly condition: Condition;
}

/** Widget types a dashboard grid item can hold, discriminated on `widget`. */
export const WIDGET_TYPES = ["view", "count", "stat", "series"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Embeds a form, table, calendar or board view, by id. */
export interface ViewWidget {
  readonly widget: "view";
  readonly view: string;
}

/** Counts the records a table view shows (its fixed filter applies), optionally narrowed further. */
export interface CountWidget {
  readonly widget: "count";
  readonly label: string;
  /** Id of a table view: its entity, data source and fixed filter are used. */
  readonly view: string;
  readonly filter?: Condition;
}

/** The aggregate operations a stat measure can use. */
export const MEASURE_OPS = ["count", "sum", "countDistinct", "min", "max", "avg"] as const;
export type MeasureOp = (typeof MEASURE_OPS)[number];

/**
 * What a `stat` computes over the records, discriminated on `op`. `sum` and
 * `avg` take one number field or the product of two number fields per record
 * (a typed pair, not a formula). Empty values are skipped, except by `count`.
 */
export type Measure =
  | { readonly op: "count" }
  | { readonly op: "countDistinct"; readonly field: string }
  | { readonly op: "min" | "max"; readonly field: string }
  | { readonly op: "sum" | "avg"; readonly field: string }
  | { readonly op: "sum" | "avg"; readonly product: readonly [string, string] };

/** Shows one number computed over the records of a table view (its fixed filter applies), optionally narrowed further. */
export interface StatWidget {
  readonly widget: "stat";
  readonly label: string;
  /** Id of a table view: its entity, data source and fixed filter are used. */
  readonly view: string;
  readonly measure: Measure;
  readonly filter?: Condition;
}

/** How a series renders its groups (RFC 0001 slice 2). `bar` and `line` are drawn by the components repo. */
export const SERIES_DISPLAYS = ["table", "bar", "line"] as const;
export type SeriesDisplay = (typeof SERIES_DISPLAYS)[number];

/** Date groupings a date groupBy may collapse records into. Absent means `day`. */
export const SERIES_BUCKETS = ["day", "week", "month"] as const;
export type SeriesBucket = (typeof SERIES_BUCKETS)[number];

/** What a series sorts its groups by, and which way. Default group ascending. */
export const SERIES_SORT_BYS = ["group", "value"] as const;
export type SeriesSortBy = (typeof SERIES_SORT_BYS)[number];
export const SERIES_SORT_DIRS = ["asc", "desc"] as const;
export type SeriesSortDir = (typeof SERIES_SORT_DIRS)[number];

/** Groups shown: default and ceiling (RFC 0001 slice 2, decision 1). */
export const SERIES_LIMIT_DEFAULT = 50;
export const SERIES_LIMIT_MAX = 200;

/**
 * Groups the records of a table view by one field and shows one measure per
 * group as a table, bar chart or line chart (RFC 0001 slice 2). `groupBy.field`
 * is a select, boolean, reference, text or date field; only a date takes a
 * `bucket`. Records without a group value are skipped and counted. A date
 * series sorted by group fills missing buckets (0 for count/sum/countDistinct,
 * no value for min/max/avg) so a line shows the gap; past the cap the newest
 * N buckets are kept. Rendered through the optional `widgets.series` registry
 * key; without it the widget names the missing key.
 */
export interface SeriesWidget {
  readonly widget: "series";
  /** Required; doubles as the chart's accessible name. */
  readonly label: string;
  /** Id of a table view: its entity, data source and fixed filter are used. */
  readonly view: string;
  readonly groupBy: { readonly field: string; readonly bucket?: SeriesBucket };
  readonly measure: Measure;
  readonly display: SeriesDisplay;
  readonly sort?: { readonly by: SeriesSortBy; readonly dir: SeriesSortDir };
  /** Whole number 1 to SERIES_LIMIT_MAX; defaults to SERIES_LIMIT_DEFAULT. */
  readonly limit?: number;
  readonly filter?: Condition;
}

export type Widget = ViewWidget | CountWidget | StatWidget | SeriesWidget;

/** A widget placed on the tab's grid: column x, row y (from 0), w columns wide, h rows tall. */
export type GridItem = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Render the widget only while this holds for the viewer; otherwise its cell stays empty (RFC 0006). */
  readonly visibleWhen?: ViewerCondition;
} & Widget;

export interface DashboardTab {
  readonly id: string;
  readonly title: string;
  /** Grid columns. Defaults to 12. */
  readonly columns?: number;
  /** List the tab only while this holds for the viewer (RFC 0006). */
  readonly visibleWhen?: ViewerCondition;
  readonly items: readonly GridItem[];
}

/** Tabs of widgets laid out on a grid. Refers to other views by id, so it has no entity of its own. */
export interface DashboardView {
  readonly kind: "dashboard";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly title?: string;
  readonly revision: number;
  readonly tabs: readonly DashboardTab[];
}

/** Viewer fact types. Both have a closed set of values, so the state grid can list every case. */
export const VIEWER_FACT_TYPES = ["select", "boolean"] as const;
export type ViewerFactType = (typeof VIEWER_FACT_TYPES)[number];

interface ViewerFactBase {
  readonly id: string;
  readonly label: string;
}

/** A fact with a closed list of values, e.g. a role. */
export interface SelectViewerFact extends ViewerFactBase {
  readonly type: "select";
  readonly options: StaticOptions;
  /** One of `options.values`: what a viewer the host says nothing about gets. */
  readonly default: string;
}

/** A yes/no fact, e.g. a feature flag. */
export interface BooleanViewerFact extends ViewerFactBase {
  readonly type: "boolean";
  /** What a viewer the host says nothing about gets. */
  readonly default: boolean;
}

export type ViewerFact = SelectViewerFact | BooleanViewerFact;

/**
 * The facts a host can tell the renderers about the viewer (RFC 0006). A
 * document set has at most one. Not a view: it has no entity and draws nothing.
 */
export interface ViewerDocument {
  readonly kind: "viewer";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly revision: number;
  /** 1 to VIEWER_FACTS_MAX facts, each id once. */
  readonly facts: readonly ViewerFact[];
}

/** One fact's value for one viewer. */
export interface ViewerFactValue {
  readonly fact: string;
  readonly value: string | boolean;
}

/** A complete, valid viewer: every declared fact exactly once, in declaration order. */
export interface ResolvedViewer {
  readonly facts: readonly ViewerFactValue[];
}

/** Discriminated on `kind`. */
export type ViewDocument = FormView | TableView | CalendarView | BoardView | DashboardView;
export type Document = EntityDocument | ViewDocument | ViewerDocument;
export type DocumentKind = Document["kind"];

/**
 * The view title field an omitted `titleField` falls back to: the entity's
 * first text field. One owner (card 45a) — the validator's calendar/board
 * title checks and the runtime's titleFieldOf helpers must never drift apart.
 */
export function defaultTitleField(entity: EntityDocument): string | undefined {
  return entity.fields.find((f) => f.type === "text")?.id;
}

/**
 * The items of a form section: [] for a sub-record checklist section (RFC 0009
 * item 3), which has none. One owner — every consumer walks sections through
 * this instead of touching `items` directly, so the discriminator stays in core.
 */
export function sectionItems(section: FormSection): readonly FormItem[] {
  return section.items ?? [];
}
