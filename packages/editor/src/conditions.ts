// Conditions the editors can build. The document language (core's Condition)
// is a small AST; the builder offers the part of it that is comfortable to
// edit: one level of all/any of comparisons, with a "not" on a comparison.
// Anything deeper is shown intact in words and can be replaced, never dropped
// (ARCHITECTURE.md §6).

import { isRelativeDate } from "@yadad/core";
import type { ComparisonValue, Condition, FieldType, Scalar, ViewerCondition } from "@yadad/core";

/** One comparison of a field against a value; "not" applies to the comparison itself. */
export interface Comparison {
  readonly not: boolean;
  /** The operator, "not" aside: eq/neq, ordering for numbers and dates, in/contains, empty/notEmpty. */
  readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "empty" | "notEmpty" | "viewerIn";
  /** The record field; for "viewerIn" the viewer fact id (RFC 0006). */
  readonly field: string;
  /** A value for eq/neq and ordering (on a date field also a relative date); absent for empty/notEmpty. */
  readonly value?: ComparisonValue;
  /** The list for "in", and for "viewerIn" the viewer fact's values (strings or booleans). */
  readonly values?: readonly Scalar[];
}

/** What the builder edits: "all of" (and) or "any of" (or) of comparisons. */
export interface Group {
  readonly combine: "all" | "any";
  readonly comparisons: readonly Comparison[];
}

/** Operators that make sense for a field type, in the order the builder lists them. */
export function operatorsFor(type: FieldType): readonly Comparison["op"][] {
  switch (type) {
    case "number":
    case "date":
    case "datetime": // RFC 0007: card 37d (the value input for an instant)
      return ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"];
    case "text":
      return ["eq", "neq", "contains", "empty", "notEmpty"];
    case "select":
      return ["eq", "neq", "in", "empty", "notEmpty"];
    case "boolean":
    case "reference":
      return ["eq", "neq", "empty", "notEmpty"];
  }
}

/** The operators that take a value input at all. */
export function takesValue(op: Comparison["op"]): boolean {
  return op !== "empty" && op !== "notEmpty";
}

/** A human word for an operator, for the picker and the read-only display. */
export const OPERATOR_WORDS: Readonly<Record<Comparison["op"], string>> = {
  eq: "is",
  neq: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  in: "is one of",
  contains: "contains",
  empty: "is empty",
  notEmpty: "is filled in",
  viewerIn: "is one of",
};

/** The ops on a date field that can compare with "today +/- N days". */
export function takesRelativeDate(type: FieldType, op: Comparison["op"]): boolean {
  return type === "date" && (op === "eq" || op === "neq" || op === "gt" || op === "gte" || op === "lt" || op === "lte");
}

/** A relative date in words: "today", "yesterday", "7 days ago", "tomorrow", "in 3 days". */
export function describeRelativeDate(days: number): string {
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  return days < 0 ? `${-days} days ago` : `in ${days} days`;
}

/** A comparison value in words: a fixed value as written, a relative date as above. An unfinished one reads "…". */
export function describeComparisonValue(value: ComparisonValue | undefined): string {
  if (value === undefined) return "…";
  if (isRelativeDate(value)) return Number.isInteger(value.daysFromToday) ? describeRelativeDate(value.daysFromToday) : "…";
  return typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
}

/**
 * One condition node to a comparison; undefined when it carries combining
 * or nesting ("not" of a "not", "not" of a group), which the builder does not
 * edit.
 */
function toComparison(c: Condition): Comparison | undefined {
  switch (c.op) {
    case "not": {
      const inner = toComparison(c.condition);
      return inner && !inner.not ? { ...inner, not: true } : undefined;
    }
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { not: false, op: c.op, field: c.field, value: c.value };
    case "in":
      return { not: false, op: "in", field: c.field, values: c.values };
    case "contains":
      return { not: false, op: "contains", field: c.field, value: c.value };
    case "viewerIn":
      return { not: false, op: "viewerIn", field: c.fact, values: c.values };
    case "empty":
    case "notEmpty":
      return { not: false, op: c.op, field: c.field };
    default:
      return undefined;
  }
}

/**
 * A condition to the builder's shape, or undefined when it is deeper than
 * the builder edits: an empty all/any (which means "always"/"never"), a
 * combining inside a combining, or a "not" the builder would not place.
 */
export function parseGroup(condition: Condition | undefined): Group | undefined {
  if (condition === undefined) return undefined;
  switch (condition.op) {
    case "and":
    case "or": {
      if (condition.conditions.length === 0) return undefined;
      const comparisons = condition.conditions.map(toComparison);
      if (comparisons.some((c) => c === undefined)) return undefined;
      return { combine: condition.op === "and" ? "all" : "any", comparisons: comparisons as Comparison[] };
    }
    default: {
      const c = toComparison(condition);
      return c ? { combine: "all", comparisons: [c] } : undefined;
    }
  }
}

/**
 * One comparison to a Condition; undefined when it lacks what the op needs
 * (no value for a value operator, no list for "in").
 */
export function compareToCondition(c: Comparison): Condition | undefined {
  let body: Condition;
  switch (c.op) {
    case "empty":
    case "notEmpty":
      body = { op: c.op, field: c.field };
      break;
    case "in":
      if (c.values === undefined || c.values.length === 0) return undefined;
      body = { op: "in", field: c.field, values: c.values };
      break;
    case "viewerIn":
      if (c.values === undefined || c.values.length === 0) return undefined;
      body = { op: "viewerIn", fact: c.field, values: c.values.filter((v): v is string | boolean => typeof v === "string" || typeof v === "boolean") };
      if (body.values.length !== c.values.length) return undefined;
      break;
    case "contains":
      if (typeof c.value !== "string") return undefined;
      body = { op: "contains", field: c.field, value: c.value };
      break;
    default:
      if (c.value === undefined) return undefined;
      // A relative date still being typed has no whole number yet.
      if (isRelativeDate(c.value) && !Number.isInteger(c.value.daysFromToday)) return undefined;
      body = { op: c.op, field: c.field, value: c.value };
      break;
  }
  return c.not ? { op: "not", condition: body } : body;
}

/**
 * The builder's shape to a Condition. An empty group is no condition: the
 * builder offers no way to express "always"/"never" (that is the absence of
 * a condition), so saving with no comparisons removes the rule. A group with
 * any incomplete comparison is no condition either, so it cannot be applied.
 */
export function buildGroup(group: Group): Condition | undefined {
  if (group.comparisons.length === 0) return undefined;
  const built = group.comparisons.map(compareToCondition);
  // One unfinished row makes the whole group unbuildable: dropping it would lose the user's row silently.
  const list = built.filter((c): c is Condition => c !== undefined);
  if (list.length !== built.length) return undefined;
  if (list.length === 1) return list[0];
  return { op: group.combine === "all" ? "and" : "or", conditions: list };
}

/**
 * Whether a condition round-trips through the builder: editable when it
 * does. A condition that does not round-trip stays read-only in words,
 * with a way to replace it — the builder would otherwise rewrite what it
 * claims to be editing.
 */
export function roundTrips(condition: Condition | undefined): boolean {
  if (condition === undefined) return true;
  const g = parseGroup(condition);
  if (!g) return false;
  const built = buildGroup(g);
  return built !== undefined && JSON.stringify(built) === JSON.stringify(condition);
}

/**
 * Whether a value (or list of values) fits a field type: the builder offers
 * only operators that make sense per type, and the value input is the
 * field's own registry input, so this is a belt to the suspenders against
 * a condition the document validator would reject.
 */
export function valueFits(type: FieldType, value: ComparisonValue | readonly Scalar[] | undefined): boolean {
  if (value === undefined) return true;
  if (isRelativeDate(value)) return type === "date" && Number.isInteger(value.daysFromToday);
  const list: readonly Scalar[] = Array.isArray(value) ? value : [value as Scalar];
  if (list.some((v) => typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) return false;
  switch (type) {
    case "number":
      return list.every((v) => typeof v === "number");
    case "date":
      return list.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
    case "boolean":
      return list.every((v) => typeof v === "boolean");
    default:
      return true;
  }
}

/** Whether a comparison reads the viewer rather than a record field. */
export function isViewerComparison(c: Pick<Comparison, "op">): boolean {
  return c.op === "viewerIn";
}

/**
 * A condition as a ViewerCondition (only `viewerIn`, `and`, `or`, `not`), or
 * undefined when it reads a record anywhere: the places that have no record
 * accept nothing else.
 */
export function asViewerCondition(condition: Condition | undefined): ViewerCondition | undefined {
  if (condition === undefined) return undefined;
  switch (condition.op) {
    case "viewerIn":
      return condition;
    case "not": {
      const inner = asViewerCondition(condition.condition);
      return inner && { op: "not", condition: inner };
    }
    case "and":
    case "or": {
      const parts = condition.conditions.map(asViewerCondition);
      return parts.every((p) => p !== undefined) ? { op: condition.op, conditions: parts as ViewerCondition[] } : undefined;
    }
    default:
      return undefined;
  }
}
