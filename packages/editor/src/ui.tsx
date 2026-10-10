import type { Condition, Field, FieldValue, Registry, Scalar } from "@yadad/core";
import type { CSSProperties, ReactNode } from "react";
import { renderInput } from "./inputs.js";

/** Toolbar layout shared by the editors; hosts can change the gap with --yadad-toolbar-gap. */
export const toolbarStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "end", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockEnd: "var(--yadad-toolbar-gap, 0.5rem)" };

/** A labelled input for an editor property, drawn with the registry's own field components. */
export function propertyInput(registry: Registry<ReactNode>, inputId: string, field: Field, value: FieldValue | undefined, onChange: (value: FieldValue | undefined) => void): ReactNode {
  const { FieldFrame } = registry.layout;
  return (
    <FieldFrame key={inputId} inputId={inputId} errorId={`${inputId}-errors`} label={field.label} required={field.required === true} errors={[]}>
      {renderInput(registry, field, value, { inputId, invalid: false }, onChange)}
    </FieldFrame>
  );
}

/** A choice list over labelled options; the first option is selected when the value is unset. */
export function choiceField(id: string, label: string, choices: readonly string[]): Field {
  return { id, type: "select", label, options: { source: "static", values: [...choices] } };
}

/** A document-style id from a title: lowercase letters, digits and underscores, unique among `used`. */
export function idFromTitle(title: string, used: Iterable<string>, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = /^[a-z]/.test(slug) ? slug : slug === "" ? fallback : `${fallback}_${slug}`;
  const taken = new Set(used);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

export const asText = (v: FieldValue | undefined): string => (typeof v === "string" ? v : "");

const OP_WORDS = { eq: "is", neq: "is not", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most" } as const;

/** A condition in plain words, using field labels, e.g. "How did it feel? is Hard". */
export function describeCondition(condition: Condition, label: (fieldId: string) => string): string {
  const show = (v: Scalar) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v));
  switch (condition.op) {
    case "and":
    case "or":
      return condition.conditions.length === 0 ? (condition.op === "and" ? "always" : "never") : condition.conditions.map((c) => describeCondition(c, label)).join(` ${condition.op} `);
    case "not":
      return `not (${describeCondition(condition.condition, label)})`;
    case "in":
      return `${label(condition.field)} is one of ${condition.values.map(show).join(", ")}`;
    case "contains":
      return `${label(condition.field)} contains "${condition.value}"`;
    case "empty":
      return `${label(condition.field)} is empty`;
    case "notEmpty":
      return `${label(condition.field)} is filled in`;
    default:
      return `${label(condition.field)} ${OP_WORDS[condition.op]} ${show(condition.value)}`;
  }
}
