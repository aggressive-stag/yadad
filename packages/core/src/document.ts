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
 * `migrate()` stamps them.
 */
export const SPEC_VERSION = 6;
/** Every version the validator accepts: the current one and older ones that `migrate()` upgrades. */
export const SUPPORTED_SPEC_VERSIONS = [0, 1, 2, 3, 4, 5, 6] as const;
export type SpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];

/** Field types known to the engine. */
export const FIELD_TYPES = ["text", "number", "boolean", "select", "date", "datetime", "reference"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

interface FieldBase {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
}

export interface TextField extends FieldBase {
  readonly type: "text";
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

/** A fixed list of choices. Dynamic sources (another entity) come later. */
export interface StaticOptions {
  readonly source: "static";
  readonly values: readonly string[];
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
}

/** Discriminated on `type`. */
export type Field = TextField | NumberField | BooleanField | SelectField | DateField | DatetimeField | ReferenceField;

/** An entity declares at most this many record actions, and an action at most this many input fields (RFC 0007). */
export const ACTIONS_MAX = 12;
export const ACTION_INPUT_MAX = 5;
/** A table, board or calendar offers at most this many actions on a record. */
export const RECORD_ACTIONS_MAX = 6;
/** Field types an action's input fields may have: those with a plain input, not `reference` (a picker needs a target query). */
export const ACTION_INPUT_FIELD_TYPES = ["text", "number", "boolean", "select", "date", "datetime"] as const;
export type ActionInputFieldType = (typeof ACTION_INPUT_FIELD_TYPES)[number];
export const ACTION_CONFIRM_TONES = ["neutral", "danger"] as const;
export type ActionConfirmTone = (typeof ACTION_CONFIRM_TONES)[number];

/** A field definition of an action's input: the same properties as the entity field of that type. */
export type ActionInputField = TextField | NumberField | BooleanField | SelectField | DateField | DatetimeField;

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
  /** Show the field only while this holds. */
  readonly visibleWhen?: Condition;
  /** Require the field while this holds (views can only tighten the entity's rules). */
  readonly requiredWhen?: Condition;
  /** Drop the field's value while it is hidden. Defaults to false: hidden values are kept. */
  readonly clearWhenHidden?: boolean;
}

export interface FormSection {
  readonly id: string;
  readonly title?: string;
  readonly items: readonly FormItem[];
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
}

export interface TableColumn {
  /** Id of a field on the view's entity. */
  readonly field: string;
  /** Whether rows can edit this column in place. Defaults to false. */
  readonly editable?: boolean;
  /** Show the column only while this holds for the viewer (RFC 0006). Absent: always shown. */
  readonly visibleWhen?: ViewerCondition;
  /** Edit the column in place only while this holds for the viewer. Needs `editable: true`; can only narrow it (RFC 0006). */
  readonly editableWhen?: ViewerCondition;
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
  /** Quick filters the viewer can set: select and boolean fields match exactly, text fields by substring, number and date fields as a from/to range (gte/lte, either end optional). */
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
  /** Id of a select or reference field that colours entries. */
  readonly colorField?: string;
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

/** Widget types a dashboard grid item can hold, discriminated on `widget`. */
export const WIDGET_TYPES = ["view", "count", "stat"] as const;
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

export type Widget = ViewWidget | CountWidget | StatWidget;

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
