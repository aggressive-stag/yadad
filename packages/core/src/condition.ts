// Conditions are JSON, never strings (ARCHITECTURE.md §6): a small AST that
// core validates and runtime evaluates against a record's values.

/** A value a condition compares against. Dates compare as "YYYY-MM-DD" strings. */
export type Scalar = string | number | boolean;

/**
 * A date relative to the viewer's local date: 0 is today, -7 a week ago, 1
 * tomorrow. The runtime turns it into a "YYYY-MM-DD" Scalar before a
 * condition is evaluated or sent to a DataAdapter, so adapters and servers
 * never see this shape. Only valid on `date` fields.
 */
export interface RelativeDate {
  readonly daysFromToday: number;
}

/** What eq/neq/gt/gte/lt/lte compare a field with: a fixed value, or (date fields only) a relative date. */
export type ComparisonValue = Scalar | RelativeDate;

/** Relative dates may reach at most this many days from today (about 100 years). */
export const MAX_RELATIVE_DAYS = 36500;

/** The comparison ops that accept a relative date. */
export const RELATIVE_DATE_OPS = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;

export type Condition =
  /** Compare a field with a value. Ordering ops only match values of the same type. */
  | { readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; readonly field: string; readonly value: ComparisonValue }
  /** The field equals one of the values. */
  | { readonly op: "in"; readonly field: string; readonly values: readonly Scalar[] }
  /** Case-insensitive substring match on a text value. */
  | { readonly op: "contains"; readonly field: string; readonly value: string }
  /** No value (missing, null or blank text), or any value. */
  | { readonly op: "empty" | "notEmpty"; readonly field: string }
  /** All (and) or any (or) of the conditions. An empty "and" is true; an empty "or" is false. */
  | { readonly op: "and" | "or"; readonly conditions: readonly Condition[] }
  | { readonly op: "not"; readonly condition: Condition }
  /** The viewer's value for this fact is one of these (RFC 0006). Reads the viewer, not the record. */
  | { readonly op: "viewerIn"; readonly fact: string; readonly values: readonly (string | boolean)[] };

/** The subset of conditions for places that have no record: `viewerIn`, `and`, `or`, `not`. */
export type ViewerCondition =
  | Extract<Condition, { readonly op: "viewerIn" }>
  | { readonly op: "and" | "or"; readonly conditions: readonly ViewerCondition[] }
  | { readonly op: "not"; readonly condition: ViewerCondition };

export type ConditionOp = Condition["op"];

/** True for a `{ daysFromToday }` value. Shape only; the validator checks the number. */
export function isRelativeDate(value: unknown): value is RelativeDate {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "daysFromToday" in value;
}

export const CONDITION_OPS: readonly ConditionOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "empty", "notEmpty", "and", "or", "not", "viewerIn"];

/** Every record field id a condition refers to, for checking them against the entity. A `viewerIn` leaf names no field. */
export function conditionFields(condition: Condition): string[] {
  switch (condition.op) {
    case "and":
    case "or":
      return condition.conditions.flatMap(conditionFields);
    case "not":
      return conditionFields(condition.condition);
    case "viewerIn":
      return [];
    default:
      return [condition.field];
  }
}

/** Every viewer fact id a condition reads (one per `viewerIn` leaf, in order, repeats kept). */
export function conditionViewerFacts(condition: Condition): string[] {
  switch (condition.op) {
    case "and":
    case "or":
      return condition.conditions.flatMap(conditionViewerFacts);
    case "not":
      return conditionViewerFacts(condition.condition);
    case "viewerIn":
      return [condition.fact];
    default:
      return [];
  }
}
