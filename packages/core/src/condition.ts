// Conditions are JSON, never strings (ARCHITECTURE.md §6): a small AST that
// core validates and runtime evaluates against a record's values.

/** A value a condition compares against. Dates compare as "YYYY-MM-DD" strings. */
export type Scalar = string | number | boolean;

export type Condition =
  /** Compare a field with a value. Ordering ops only match values of the same type. */
  | { readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; readonly field: string; readonly value: Scalar }
  /** The field equals one of the values. */
  | { readonly op: "in"; readonly field: string; readonly values: readonly Scalar[] }
  /** Case-insensitive substring match on a text value. */
  | { readonly op: "contains"; readonly field: string; readonly value: string }
  /** No value (missing, null or blank text), or any value. */
  | { readonly op: "empty" | "notEmpty"; readonly field: string }
  /** All (and) or any (or) of the conditions. An empty "and" is true; an empty "or" is false. */
  | { readonly op: "and" | "or"; readonly conditions: readonly Condition[] }
  | { readonly op: "not"; readonly condition: Condition };

export type ConditionOp = Condition["op"];

export const CONDITION_OPS: readonly ConditionOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "empty", "notEmpty", "and", "or", "not"];

/** Every field id a condition refers to, for checking them against the entity. */
export function conditionFields(condition: Condition): string[] {
  switch (condition.op) {
    case "and":
    case "or":
      return condition.conditions.flatMap(conditionFields);
    case "not":
      return conditionFields(condition.condition);
    default:
      return [condition.field];
  }
}
