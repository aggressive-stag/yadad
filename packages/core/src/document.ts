// PRE-CONTRACT document shapes: entities with the five v0 field types and
// form views. Table and dashboard views, and the frozen contract, come later.

import type { Condition } from "./condition.js";

/** Engine document format version. Pre-contract documents are version 0. */
export const SPEC_VERSION = 0;
export type SpecVersion = typeof SPEC_VERSION;

/** Field types known to the engine. */
export const FIELD_TYPES = ["text", "number", "boolean", "select", "date"] as const;
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

/** Discriminated on `type`. */
export type Field = TextField | NumberField | BooleanField | SelectField | DateField;

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
  /** Quick filters the viewer can set: select and boolean fields match exactly, text fields by substring. */
  readonly quickFilters?: readonly QuickFilter[];
}

export interface QuickFilter {
  readonly field: string;
}

/** Widget types a dashboard grid item can hold, discriminated on `widget`. */
export const WIDGET_TYPES = ["view", "count"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Embeds a form or table view, by id. */
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

export type Widget = ViewWidget | CountWidget;

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
export type ViewDocument = FormView | TableView | DashboardView;
export type Document = EntityDocument | ViewDocument;
export type DocumentKind = Document["kind"];
