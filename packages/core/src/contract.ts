// The tables and limits the validator enforces, next to the short human
// descriptions `describeContract()` reports. The validator imports these
// constants, so the description and the validation cannot drift apart.

import type { ConditionOp } from "./condition.js";
import { CONDITION_OPS } from "./condition.js";
import type { Document, FieldType, WidgetType } from "./document.js";
import { FIELD_TYPES, SPEC_VERSION, WIDGET_TYPES } from "./document.js";

/** Document kinds, discriminated on `kind`. */
export const DOCUMENT_KINDS = ["entity", "form", "table", "dashboard"] as const;

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
  };
  readonly widgets: readonly WidgetSpec[];
  readonly grid: {
    readonly columns: { readonly default: number; readonly max: number };
    readonly items: readonly { readonly key: GridItemKey; readonly min: number; readonly max: number }[];
  };
  readonly limits: { readonly pageSize: { readonly max: number } };
  readonly errorCodes: readonly string[];
}

// ---- the tables -----------------------------------------------------------

const DOCUMENT_KIND_SPECS: readonly DocumentKindSpec[] = [
  {
    kind: "entity",
    description: "The data model: owns fields, types and validation.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "entity".' },
      { key: "specVersion", required: true, description: "The engine document format version. Currently 0." },
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
      { key: "specVersion", required: true, description: "The engine document format version. Currently 0." },
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
      { key: "specVersion", required: true, description: "The engine document format version. Currently 0." },
      { key: "id", required: true, description: "The table's id." },
      { key: "entity", required: true, description: "The id of the entity whose records are shown." },
      { key: "revision", required: true, description: "Bumped whenever this document changes." },
      { key: "dataSource", required: true, description: "Key the host maps to a DataAdapter. Never a URL." },
      { key: "columns", required: true, description: "An array of { field, editable? }; at least one, each field once." },
      { key: "title", required: false, description: "Caption shown with the table." },
      { key: "sort", required: false, description: "Initial sort: an array of { field, dir: \"asc\" | \"desc\" }." },
      { key: "pageSize", required: false, description: "Rows per page, a whole number from 1 to 1000." },
      { key: "filter", required: false, description: "A condition every row must always match." },
      { key: "quickFilters", required: false, description: "An array of { field }; the viewer can set them." },
    ],
  },
  {
    kind: "dashboard",
    description: "Tabs of widgets (views and counts) laid out on a grid. Refers to other views by id.",
    properties: [
      { key: "kind", required: true, description: 'The kind, "dashboard".' },
      { key: "specVersion", required: true, description: "The engine document format version. Currently 0." },
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

const WIDGET_SPECS: Record<WidgetType, WidgetSpec> = {
  view: {
    widget: "view",
    description: "Embeds a form or table view, by id.",
    properties: [{ key: "view", required: true, description: "The id of the form or table view to embed." }],
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
      maxValueType: "text, a number or true/false (contains: text only)",
      maxDepth: MAX_CONDITION_DEPTH,
    },
    widgets: WIDGET_TYPES.map((widget) => WIDGET_SPECS[widget]),
    grid: {
      columns: { default: GRID_COLUMNS_DEFAULT, max: MAX_GRID_COLUMNS },
      items: GRID_ITEM_KEYS.map(({ key, min }) => ({ key, min, max: GRID_ITEM_MAX })),
    },
    limits: { pageSize: { max: PAGE_SIZE_MAX } },
    errorCodes: [...ERROR_CODES],
  };
}
