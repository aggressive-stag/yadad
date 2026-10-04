import type { Condition, EntityDocument, FieldValue, FormView, RecordValues, Scalar } from "@yadad/core";

const isEmpty = (v: FieldValue | undefined): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Orders two values of the same type; undefined when they cannot be compared. */
function order(a: FieldValue | undefined, b: Scalar): number | undefined {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return undefined;
}

/** Evaluates a condition against a record's values. Comparisons across types are false. */
export function evaluateCondition(condition: Condition, values: RecordValues): boolean {
  switch (condition.op) {
    case "and":
      return condition.conditions.every((c) => evaluateCondition(c, values));
    case "or":
      return condition.conditions.some((c) => evaluateCondition(c, values));
    case "not":
      return !evaluateCondition(condition.condition, values);
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
    case "eq":
      return values[condition.field] === condition.value;
    case "neq":
      return values[condition.field] !== condition.value;
    default: {
      const o = order(values[condition.field], condition.value);
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
