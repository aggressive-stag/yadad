// PRE-CONTRACT document shapes: entities with the five v0 field types and
// form views. Table and dashboard views, and the frozen contract, come later.

import type { Condition } from "./condition.js";

/**
 * Engine document format version. Version 1 adds relative dates in conditions
 * (`{ daysFromToday }`); a version 0 document is valid as it is, and
 * `migrate()` stamps it as version 1. Version 2 adds the first slices of
 * RFCs 0001-0003 (the `stat` widget, the `reference` field, table
 * `rowAction`); older documents stay valid and `migrate()` stamps them.
 * Version 3 adds the `calendar` view (RFC 0004); older documents stay valid
 * and `migrate()` stamps them.
 */
export const SPEC_VERSION = 3;
/** Every version the validator accepts: the current one and older ones that `migrate()` upgrades. */
export const SUPPORTED_SPEC_VERSIONS = [0, 1, 2, 3] as const;
export type SpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];

/** Field types known to the engine. */
export const FIELD_TYPES = ["text", "number", "boolean", "select", "date", "reference"] as const;
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
export type Field = TextField | NumberField | BooleanField | SelectField | DateField | ReferenceField;

/** Data model: owns fields, types and validation. */
export interface EntityDocument {
  readonly kind: "entity";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly revision: number;
  readonly fields: readonly Field[];
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
  /** Activating an entry opens a table view scoped to it, as on tables. A calendar can start a chain, never be a target. */
  readonly rowAction?: RowAction;
}

export interface QuickFilter {
  readonly field: string;
}

/** Widget types a dashboard grid item can hold, discriminated on `widget`. */
export const WIDGET_TYPES = ["view", "count", "stat"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Embeds a form, table or calendar view, by id. */
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
export type GridItem = { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number } & Widget;

export interface DashboardTab {
  readonly id: string;
  readonly title: string;
  /** Grid columns. Defaults to 12. */
  readonly columns?: number;
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

/** Discriminated on `kind`. */
export type ViewDocument = FormView | TableView | CalendarView | DashboardView;
export type Document = EntityDocument | ViewDocument;
export type DocumentKind = Document["kind"];
