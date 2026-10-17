import { isRelativeDate } from "@yadad/core";
import type { ComparisonValue, Condition, EntityDocument, FieldValue, FormView, RecordValues, Scalar } from "@yadad/core";

const isEmpty = (v: FieldValue | undefined): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Orders two values of the same type; undefined when they cannot be compared or the first is empty. */
function order(a: FieldValue | undefined, b: Scalar): number | undefined {
  if (isEmpty(a)) return undefined; // an empty value (including blank text) is above and below nothing
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return undefined;
}

/** The local calendar date of `now` as "YYYY-MM-DD". */
export function localIsoDate(now: Date): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, "0");
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/** The local date `days` from `now` (negative: before), as "YYYY-MM-DD". Calendar days, so daylight saving never shifts it. */
export function dateFromToday(days: number, now: Date = new Date()): string {
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

function resolveValue(value: ComparisonValue, now: Date | undefined): Scalar {
  return isRelativeDate(value) ? dateFromToday(value.daysFromToday, now) : value;
}

/**
 * Replaces every relative date ({ daysFromToday }) in a condition with the
 * "YYYY-MM-DD" it means on the client's local date (`now`, default the current
 * time). Run it before a filter goes to a DataAdapter, so servers and the
 * records protocol only ever see fixed values. Conditions without a relative
 * date come back as the same object.
 */
export function resolveRelativeDates(condition: Condition, now?: Date): Condition;
export function resolveRelativeDates(condition: Condition | undefined, now?: Date): Condition | undefined;
export function resolveRelativeDates(condition: Condition | undefined, now?: Date): Condition | undefined {
  if (!condition) return condition;
  switch (condition.op) {
    case "and":
    case "or": {
      const conditions = condition.conditions.map((c) => resolveRelativeDates(c, now));
      return conditions.some((c, i) => c !== condition.conditions[i]) ? { op: condition.op, conditions } : condition;
    }
    case "not": {
      const inner = resolveRelativeDates(condition.condition, now);
      return inner === condition.condition ? condition : { op: "not", condition: inner };
    }
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return isRelativeDate(condition.value) ? { op: condition.op, field: condition.field, value: resolveValue(condition.value, now) } : condition;
    default:
      return condition;
  }
}

/**
 * Evaluates a condition against a record's values. Comparisons across types
 * are false. Relative dates resolve against `now` (default the current time).
 */
export function evaluateCondition(condition: Condition, values: RecordValues, now?: Date): boolean {
  switch (condition.op) {
    case "and":
      return condition.conditions.every((c) => evaluateCondition(c, values, now));
    case "or":
      return condition.conditions.some((c) => evaluateCondition(c, values, now));
    case "not":
      return !evaluateCondition(condition.condition, values, now);
    case "empty":
      return isEmpty(values[condition.field]);
    case "notEmpty":
      return !isEmpty(values[condition.field]);
    case "in":
      return condition.values.some((v) => v === values[condition.field]);
    case "contains": {
      const v = values[condition.field];
      return typeof v === "string" && v.toLowerCase().includes(condition.value.toLowerCase());
    }
    case "viewerIn":
      // STUB (RFC 0006, card viewer-core): no viewer is passed yet, and the RFC's answer for no viewer is false.
      // The runtime card replaces this with a lookup in the resolved viewer.
      return false;
    case "eq":
      return values[condition.field] === resolveValue(condition.value, now);
    case "neq":
      return values[condition.field] !== resolveValue(condition.value, now);
    default: {
      const o = order(values[condition.field], resolveValue(condition.value, now));
      if (o === undefined) return false;
      return condition.op === "gt" ? o > 0 : condition.op === "gte" ? o >= 0 : condition.op === "lt" ? o < 0 : o <= 0;
    }
  }
}

export interface FormRules {
  /** Fields whose visibleWhen is false. */
  readonly hidden: ReadonlySet<string>;
  /** Visible fields whose requiredWhen is true. */
  readonly required: ReadonlySet<string>;
}

/** Which form items are hidden or conditionally required for the current values. */
export function evaluateFormRules(view: FormView, values: RecordValues): FormRules {
  const hidden = new Set<string>();
  const required = new Set<string>();
  for (const item of view.sections.flatMap((s) => s.items)) {
    if (item.visibleWhen && !evaluateCondition(item.visibleWhen, values)) hidden.add(item.field);
    else if (item.requiredWhen && evaluateCondition(item.requiredWhen, values)) required.add(item.field);
  }
  return { hidden, required };
}

/**
 * What a form actually saves: values of hidden clearWhenHidden fields are
 * dropped, and conditionally required fields become required. Views only
 * tighten the entity's rules, never loosen them.
 */
export function applyFormRules(entity: EntityDocument, view: FormView, values: RecordValues): { entity: EntityDocument; values: RecordValues } {
  const { hidden, required } = evaluateFormRules(view, values);
  const cleared = new Set(view.sections.flatMap((s) => s.items).filter((i) => i.clearWhenHidden === true && hidden.has(i.field)).map((i) => i.field));
  return {
    entity: { ...entity, fields: entity.fields.map((f) => (required.has(f.id) ? { ...f, required: true } : f)) },
    values: Object.fromEntries(Object.entries(values).filter(([k]) => !cleared.has(k))),
  };
}
