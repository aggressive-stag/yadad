import type { Condition, EntityDocument, Field, FieldValue, Registry } from "@yadad/core";
import type { ReactNode } from "react";
import { buildGroup, OPERATOR_WORDS, operatorsFor, parseGroup, roundTrips, takesValue } from "./conditions.js";
import type { Comparison, Group } from "./conditions.js";
import { renderInput } from "./inputs.js";
import { choiceField, describeCondition } from "./ui.js";

/** A comparison the user is composing: values are optional while being edited. */
interface DraftComparison {
  readonly not: boolean;
  readonly op: Comparison["op"];
  readonly field: string;
  readonly value?: FieldValue | undefined;
  readonly values?: readonly FieldValue[] | undefined;
}

interface DraftGroup {
  readonly combine: "all" | "any";
  readonly comparisons: readonly DraftComparison[];
}

/** The draft shape the editors keep in state; exported for their hooks. */
export type ConditionDraft = DraftGroup;

/** A fresh draft to start a new condition: one comparison, no value yet. */
export function starterDraft(fields: readonly Field[], excludeField?: string): DraftGroup | undefined {
  const field = fields.find((f) => f.id !== excludeField);
  return field ? { combine: "all", comparisons: [{ not: false, op: "eq", field: field.id }] } : undefined;
}

/** A draft to keep editing: the condition as the builder sees it, or a starter when there is none. */
export function draftFor(entity: EntityDocument, condition: Condition | undefined, excludeField?: string): DraftGroup | undefined {
  if (condition !== undefined && roundTrips(condition)) return parseGroup(condition) as DraftGroup;
  return starterDraft(entity.fields, excludeField);
}

/** What the draft builds today; the parent uses this to disable Apply and detect no-ops. */
export function builtOf(draft: DraftGroup | undefined): Condition | undefined {
  return draft ? buildGroup(draft as unknown as Group) : undefined;
}

const COMBINE = { all: "All of", any: "Any of" } as const;

interface ConditionBuilderProps {
  /** A stable id for this builder: its inputs get `${id}-…` ids. */
  readonly id: string;
  /** A human name for the condition, for labels: "Show only when", "Rows always match". */
  readonly label: string;
  readonly registry: Registry<ReactNode>;
  readonly entity: EntityDocument;
  /** A field the condition must not reference: the field itself, for "show only when". */
  readonly excludeField?: string | undefined;
  readonly draft: DraftGroup | undefined;
  readonly onChange: (draft: DraftGroup | undefined) => void;
  /** Shown when the current condition is deeper than the builder edits. */
  readonly current?: Condition | undefined;
  readonly onReplace?: (() => void) | undefined;
}

/**
 * Edits one condition against an entity: a field, an operator that makes
 * sense for that field's type, and the field's own input for the value.
 * All-of / any-of combines the comparisons; "not" flips one comparison.
 * Deeper conditions are shown intact in words, with a way to replace them —
 * never silently dropped.
 */
export function ConditionBuilder({ id, label, registry, entity, excludeField, draft, onChange, current, onReplace }: ConditionBuilderProps): ReactNode {
  const { Button } = registry.layout;
  const candidates = entity.fields.filter((f) => f.id !== excludeField);
  if (candidates.length === 0) return <p>No other fields of {entity.id} to compare against.</p>;
  const labelOf = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const fieldOf = (c: DraftComparison): Field => entity.fields.find((f) => f.id === c.field) ?? candidates[0]!;

  const setComparison = (i: number, patch: { not?: boolean; op?: DraftComparison["op"]; field?: string; value?: FieldValue | undefined; values?: readonly FieldValue[] | undefined }) =>
    onChange({
      combine: draft?.combine ?? "all",
      comparisons: (draft?.comparisons ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });

  const removeComparison = (i: number) => {
    const comparisons = (draft?.comparisons ?? []).filter((_, j) => j !== i);
    onChange(comparisons.length === 0 ? undefined : { combine: draft?.combine ?? "all", comparisons });
  };

  // A field or operator change invalidates a value of the old type; reset it.
  // The operator stays only when the new field's type offers it.
  const onField = (i: number, fieldId: string) => {
    const next = entity.fields.find((f) => f.id === fieldId);
    const current = draft?.comparisons[i];
    const keep = next !== undefined && current !== undefined && operatorsFor(next.type).includes(current.op);
    setComparison(i, { field: fieldId, ...(keep ? {} : { op: "eq" as const }), value: undefined, values: undefined });
  };
  const onOperator = (i: number, op: DraftComparison["op"]) => setComparison(i, { op, value: undefined, values: undefined });

  const combineId = `${id}-combine`;
  const combineField = choiceField("combine", "Match", Object.keys(COMBINE) as string[]);
  const compareWords = draft
    ? draft.comparisons.map((c) => {
        const words = OPERATOR_WORDS[c.op];
        const value = c.op === "in" ? (c.values ?? []).join(", ") : takesValue(c.op) ? String(c.value ?? "…") : "";
        return `${labelOf(c.field)} ${words}${value ? ` ${value}` : ""}`;
      })
    : [];

  return (
    <div data-yadad-condition-builder={id}>
      {current !== undefined && !roundTrips(current) ? (
        <>
          <p data-yadad-condition-readonly="">{describeCondition(current, labelOf)}</p>
          <p>This is deeper than the builder edits, so it is shown as-is. Replacing it starts a new one.</p>
          {onReplace ? <Button label={`Replace ${label}`} type="button" variant="secondary" disabled={false} onPress={onReplace} /> : null}
        </>
      ) : null}
      {draft ? (
        <>
          <div data-yadad-condition-summary="" style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", alignItems: "center" }}>
            {renderInput(registry, combineField, draft.combine === "any" ? "Any of" : "All of", { inputId: combineId, invalid: false }, (v) => onChange({ ...draft, combine: v === "Any of" ? "any" : "all" }))}
            <p>{compareWords.join(draft.combine === "any" ? " or " : " and ")}</p>
          </div>
          {draft.comparisons.map((c, i) => {
            const f = fieldOf(c);
            const fieldId = `${id}-field-${i}`;
            const opId = `${id}-op-${i}`;
            const ops = operatorsFor(f.type);
            const opField = choiceField("op", "Operator", ops.map((o) => OPERATOR_WORDS[o]));
            return (
              <div key={i} data-yadad-condition-comparison={`${id}-${i}`} style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", alignItems: "center", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                {renderInput(registry, choiceField("field", label, candidates.map((x) => x.label)), labelOf(c.field), { inputId: fieldId, invalid: false }, (v) => onField(i, candidates.find((x) => x.label === v)?.id ?? c.field))}
                {renderInput(registry, opField, OPERATOR_WORDS[c.op] ?? "is", { inputId: opId, invalid: false }, (v) => {
                  const op = ops.find((o) => OPERATOR_WORDS[o] === v);
                  if (op) onOperator(i, op);
                })}
                {c.op === "in" && f.type === "select" ? (
                  <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-space-1, 0.25rem)" }}>
                    {f.options.values.map((v) => (
                      <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
                        {renderInput(registry, { id: `${c.field}_${v}`, type: "boolean", label: v }, (c.values ?? []).includes(v), { inputId: `${id}-in-${i}-${v}`, invalid: false }, (on) =>
                          setComparison(i, { values: on ? [...(c.values ?? []), v] : (c.values ?? []).filter((x) => x !== v) }),
                        )}
                        {v}
                      </span>
                    ))}
                  </span>
                ) : takesValue(c.op) ? (
                  renderInput(registry, f, c.value, { inputId: `${id}-value-${i}`, invalid: false }, (v) => setComparison(i, { value: v }))
                ) : null}
                {renderInput(registry, { id: `${c.field}_not`, type: "boolean", label: "Not" }, c.not, { inputId: `${id}-not-${i}`, invalid: false }, (on) => setComparison(i, { not: on === true }))}
                <Button label={`Remove comparison ${i + 1}`} type="button" variant="secondary" disabled={false} onPress={() => removeComparison(i)} />
              </div>
            );
          })}
          {draft.comparisons.length > 0 && builtOf(draft) === undefined ? <p data-yadad-condition-incomplete="">Fill in every row to apply this condition.</p> : null}
          <div style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
            <Button label="Add comparison" type="button" variant="secondary" disabled={false} onPress={() => onChange({ combine: draft.combine, comparisons: [...draft.comparisons, { not: false, op: "eq", field: candidates[0]!.id }] })} />
          </div>
        </>
      ) : (
        <p>
          {label}: none.
        </p>
      )}
    </div>
  );
}
