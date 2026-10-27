import { isRelativeDate, isRelativeInstant, optionValue } from "@yadad/core";
import type { Condition, EntityDocument, Field, FieldValue, Registry, RelativeDate, RelativeInstant, ViewerDocument, ViewerFact } from "@yadad/core";
import type { ReactNode } from "react";
import { buildGroup, describeComparisonValue, isViewerComparison, OPERATOR_WORDS, operatorsFor, parseGroup, roundTrips, takesRelativeDate, takesRelativeInstant, takesValue } from "./conditions.js";
import type { Comparison, Group } from "./conditions.js";
import { renderInput } from "./inputs.js";
import { choiceField, describeCondition } from "./ui.js";

/** A relative date still being typed: the number of days may be empty. */
interface DraftRelativeDate {
  readonly daysFromToday: number | undefined;
}

/** A relative instant still being typed: the number of hours may be empty. */
interface DraftRelativeInstant {
  readonly hoursFromNow: number | undefined;
}

/** A comparison the user is composing: values are optional while being edited. */
interface DraftComparison {
  readonly not: boolean;
  readonly op: Comparison["op"];
  readonly field: string;
  /** Only for "fieldEqFact": the viewer fact id the record field is compared with (RFC 0009 item 1). */
  readonly fact?: string | undefined;
  readonly value?: FieldValue | RelativeDate | DraftRelativeDate | RelativeInstant | DraftRelativeInstant | undefined;
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

/** A fresh draft that reads the viewer: one comparison on the first fact, no values yet. */
export function viewerStarterDraft(viewer: ViewerDocument | undefined): DraftGroup | undefined {
  const fact = viewer?.facts[0];
  return fact ? { combine: "all", comparisons: [{ not: false, op: "viewerIn", field: fact.id }] } : undefined;
}

/** A draft to keep editing: the condition as the builder sees it, or a starter when there is none. */
export function draftFor(entity: EntityDocument, condition: Condition | undefined, excludeField?: string): DraftGroup | undefined {
  if (condition !== undefined && roundTrips(condition)) return parseGroup(condition) as DraftGroup;
  return starterDraft(entity.fields, excludeField);
}

/** Like draftFor, for a place that accepts only viewer conditions (a column's visibleWhen, a tab's visibleWhen). */
export function viewerDraftFor(viewer: ViewerDocument | undefined, condition: Condition | undefined): DraftGroup | undefined {
  if (condition !== undefined && roundTrips(condition)) return parseGroup(condition) as DraftGroup;
  return viewerStarterDraft(viewer);
}

/** What the draft builds today; the parent uses this to disable Apply and detect no-ops. */
export function builtOf(draft: DraftGroup | undefined): Condition | undefined {
  return draft ? buildGroup(draft as unknown as Group) : undefined;
}

const COMBINE = { all: "All of", any: "Any of" } as const;

const DATE_MODES = { fixed: "A fixed date", relative: "Today plus or minus days" } as const;
const isRelative = (v: DraftComparison["value"]): v is RelativeDate | DraftRelativeDate => v !== undefined && v !== null && isRelativeDate(v);
const INSTANT_MODES = { fixed: "A fixed date and time", relative: "Hours from now" } as const;
const isRelativeNow = (v: DraftComparison["value"]): v is RelativeInstant | DraftRelativeInstant => v !== undefined && v !== null && isRelativeInstant(v);
const HOURS_FIELD: Field = { id: "hours_from_now", type: "number", label: "Hours from now (negative: ago)", step: 1 };
const DAYS_FIELD: Field = { id: "days_from_today", type: "number", label: "Days from today (negative: ago)", step: 1 };

interface ConditionBuilderProps {
  /** A stable id for this builder: its inputs get `${id}-…` ids. */
  readonly id: string;
  /** A human name for the condition, for labels: "Show only when", "Rows always match". */
  readonly label: string;
  readonly registry: Registry<ReactNode>;
  /** The entity whose fields a comparison can read. Omit for a place that has no record (only viewer comparisons then). */
  readonly entity?: EntityDocument | undefined;
  /** The set's viewer document: with it, a comparison can read a viewer fact (RFC 0006). */
  readonly viewer?: ViewerDocument | undefined;
  /**
   * What a comparison may read. "record": fields only. "record+viewer": fields
   * and viewer facts (needs `viewer`). "viewer": viewer facts only, for places
   * that have no record. Defaults to "record+viewer" when `viewer` is given.
   */
  readonly sources?: "record" | "record+viewer" | "viewer" | undefined;
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
export function ConditionBuilder({ id, label, registry, entity, viewer, sources, excludeField, draft, onChange, current, onReplace }: ConditionBuilderProps): ReactNode {
  const { Button } = registry.layout;
  const mode = sources ?? (viewer ? "record+viewer" : "record");
  const candidates = entity && mode !== "viewer" ? entity.fields.filter((f) => f.id !== excludeField) : [];
  const facts = viewer && mode !== "record" ? viewer.facts : [];
  if (candidates.length === 0 && facts.length === 0) return <p>{mode === "viewer" ? "No viewer facts are declared to compare against." : `No other fields of ${entity?.id ?? "the entity"} to compare against.`}</p>;
  const labelOf = (fieldId: string) => entity?.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const factLabelOf = (factId: string) => facts.find((f) => f.id === factId)?.label ?? factId;
  const fieldOf = (c: DraftComparison): Field => entity?.fields.find((f) => f.id === c.field) ?? candidates[0]!;
  const factOf = (c: DraftComparison): ViewerFact => facts.find((f) => f.id === c.field) ?? facts[0]!;
  const factValues = (fact: ViewerFact): readonly (string | boolean)[] => (fact.type === "select" ? fact.options.values.map(optionValue) : [true, false]); // RFC 0008: card 47a
  const showValue = (v: FieldValue | undefined): string => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v));
  const SOURCES = { field: "A field of the record", viewer: "The viewer" } as const;

  const setComparison = (i: number, patch: { not?: boolean; op?: DraftComparison["op"]; field?: string; fact?: string | undefined; value?: DraftComparison["value"]; values?: readonly FieldValue[] | undefined }) =>
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
    const next = entity?.fields.find((f) => f.id === fieldId);
    const current = draft?.comparisons[i];
    const keep = next !== undefined && current !== undefined && operatorsFor(next.type).includes(current.op);
    setComparison(i, { field: fieldId, ...(keep ? {} : { op: "eq" as const }), value: undefined, values: undefined });
  };
  const onOperator = (i: number, op: DraftComparison["op"]) => {
    // A date comparison keeps "today plus N" when only the operator changes between comparing ops.
    const c = draft?.comparisons[i];
    const keep = c !== undefined && isRelative(c.value) && takesRelativeDate("date", op);
    // fieldEqFact needs a fact to compare against: default it to the first declared one (RFC 0009 item 1).
    const keepNow = c !== undefined && isRelativeNow(c.value) && takesRelativeInstant("datetime", op);
    setComparison(i, { op, fact: op === "fieldEqFact" ? facts[0]?.id : undefined, value: keep || keepNow ? c.value : undefined, values: undefined });
  };

  const onSource = (i: number, source: keyof typeof SOURCES) => {
    if (source === "viewer") setComparison(i, { op: "viewerIn", field: facts[0]!.id, value: undefined, values: undefined });
    else setComparison(i, { op: "eq", field: candidates[0]!.id, value: undefined, values: undefined });
  };
  const onFact = (i: number, factId: string) => setComparison(i, { field: factId, values: undefined });

  const combineId = `${id}-combine`;
  const combineField = choiceField("combine", "Match", Object.keys(COMBINE) as string[]);
  const compareWords = draft
    ? draft.comparisons.map((c) => {
        if (isViewerComparison(c)) return `${c.not ? "not " : ""}the viewer's ${factLabelOf(c.field)} is one of ${(c.values ?? []).map(showValue).join(", ")}`;
        if (c.op === "fieldEqFact") return `${c.not ? "not " : ""}${labelOf(c.field)} equals the viewer's ${factLabelOf(c.fact ?? facts[0]?.id ?? "")}`; // RFC 0009 item 1
        const words = OPERATOR_WORDS[c.op];
        const value = c.op === "in" ? (c.values ?? []).join(", ") : takesValue(c.op) ? describeComparisonValue(c.value as Comparison["value"]) : "";
        return `${labelOf(c.field)} ${words}${value ? ` ${value}` : ""}`;
      })
    : [];

  return (
    <div data-yadad-condition-builder={id}>
      {current !== undefined && !roundTrips(current) ? (
        <>
          <p data-yadad-condition-readonly="">{describeCondition(current, labelOf, factLabelOf)}</p>
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
            if (isViewerComparison(c)) {
              const fact = factOf(c);
              return (
                <div key={i} data-yadad-condition-comparison={`${id}-${i}`} style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", alignItems: "center", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                  {candidates.length > 0 && renderInput(registry, choiceField("source", "Compare", Object.values(SOURCES)), SOURCES.viewer, { inputId: `${id}-source-${i}`, invalid: false }, () => onSource(i, "field"))}
                  {renderInput(registry, choiceField("fact", label, facts.map((x) => x.label)), fact.label, { inputId: `${id}-fact-${i}`, invalid: false }, (v) => onFact(i, facts.find((x) => x.label === v)?.id ?? c.field))}
                  <span>is one of</span>
                  <span role="group" aria-label={`Values of ${fact.label}`} style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-space-1, 0.25rem)" }}>
                    {factValues(fact).map((v) => (
                      <span key={String(v)} style={{ display: "inline-flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
                        {renderInput(registry, { id: `${c.field}_${String(v)}`, type: "boolean", label: showValue(v) }, (c.values ?? []).includes(v), { inputId: `${id}-in-${i}-${String(v)}`, invalid: false }, (on) =>
                          setComparison(i, { values: on ? [...(c.values ?? []), v] : (c.values ?? []).filter((x) => x !== v) }),
                        )}
                        {showValue(v)}
                      </span>
                    ))}
                  </span>
                  {renderInput(registry, { id: `${c.field}_not`, type: "boolean", label: "Not" }, c.not, { inputId: `${id}-not-${i}`, invalid: false }, (on) => setComparison(i, { not: on === true }))}
                  <Button label={`Remove comparison ${i + 1}`} type="button" variant="secondary" disabled={false} onPress={() => removeComparison(i)} />
                </div>
              );
            }
            const f = fieldOf(c);
            const fieldId = `${id}-field-${i}`;
            const opId = `${id}-op-${i}`;
            const ops = facts.length > 0 ? [...operatorsFor(f.type), "fieldEqFact" as const] : operatorsFor(f.type); // RFC 0009 item 1: with a viewer, a field can equal a fact
            const opField = choiceField("op", "Operator", ops.map((o) => OPERATOR_WORDS[o]));
            return (
              <div key={i} data-yadad-condition-comparison={`${id}-${i}`} style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", alignItems: "center", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                {facts.length > 0 && renderInput(registry, choiceField("source", "Compare", Object.values(SOURCES)), SOURCES.field, { inputId: `${id}-source-${i}`, invalid: false }, () => onSource(i, "viewer"))}
                {renderInput(registry, choiceField("field", label, candidates.map((x) => x.label)), labelOf(c.field), { inputId: fieldId, invalid: false }, (v) => onField(i, candidates.find((x) => x.label === v)?.id ?? c.field))}
                {renderInput(registry, opField, OPERATOR_WORDS[c.op] ?? "is", { inputId: opId, invalid: false }, (v) => {
                  const op = ops.find((o) => OPERATOR_WORDS[o] === v);
                  if (op) onOperator(i, op);
                })}
                {c.op === "in" && f.type === "select" ? (
                  <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-space-1, 0.25rem)" }}>
                    {f.options.values.map(optionValue).map((v) => ( /* RFC 0008: card 47a */
                      <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
                        {renderInput(registry, { id: `${c.field}_${v}`, type: "boolean", label: v }, (c.values ?? []).includes(v), { inputId: `${id}-in-${i}-${v}`, invalid: false }, (on) =>
                          setComparison(i, { values: on ? [...(c.values ?? []), v] : (c.values ?? []).filter((x) => x !== v) }),
                        )}
                        {v}
                      </span>
                    ))}
                  </span>
                ) : null}
                {c.op === "fieldEqFact" && facts.length > 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "var(--yadad-control-font-size, 0.85rem)" }}>
                    <span>the viewer's</span>
                    <select data-yadad-condition-fact={id} value={c.fact ?? facts[0]?.id ?? ""} onChange={(e) => setComparison(i, { fact: e.target.value })}>
                      {facts.map((f) => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {takesValue(c.op) && !(c.op === "in" && f.type === "select") && (
                  <>
                    {takesRelativeDate(f.type, c.op)
                      ? renderInput(registry, choiceField("date_mode", "Compare with", Object.values(DATE_MODES)), isRelative(c.value) ? DATE_MODES.relative : DATE_MODES.fixed, { inputId: `${id}-mode-${i}`, invalid: false }, (v) =>
                          setComparison(i, { value: v === DATE_MODES.relative ? { daysFromToday: 0 } : undefined }),
                        )
                      : null}
                    {takesRelativeInstant(f.type, c.op)
                      ? renderInput(registry, choiceField("instant_mode", "Compare with", Object.values(INSTANT_MODES)), isRelativeNow(c.value) ? INSTANT_MODES.relative : INSTANT_MODES.fixed, { inputId: `${id}-mode-${i}`, invalid: false }, (v) =>
                          setComparison(i, { value: v === INSTANT_MODES.relative ? { hoursFromNow: 0 } : undefined }),
                        )
                      : null}
                    {isRelativeNow(c.value)
                      ? renderInput(registry, HOURS_FIELD, c.value.hoursFromNow, { inputId: `${id}-hours-${i}`, invalid: false }, (v) =>
                          setComparison(i, { value: { hoursFromNow: typeof v === "number" && Number.isInteger(v) ? v : undefined } }),
                        )
                      : isRelative(c.value)
                      ? renderInput(registry, DAYS_FIELD, c.value.daysFromToday, { inputId: `${id}-days-${i}`, invalid: false }, (v) =>
                          setComparison(i, { value: { daysFromToday: typeof v === "number" && Number.isInteger(v) ? v : undefined } }),
                        )
                      : renderInput(registry, f, c.value as FieldValue | undefined, { inputId: `${id}-value-${i}`, invalid: false }, (v) => setComparison(i, { value: v }))}
                  </>
                )}
                {renderInput(registry, { id: `${c.field}_not`, type: "boolean", label: "Not" }, c.not, { inputId: `${id}-not-${i}`, invalid: false }, (on) => setComparison(i, { not: on === true }))}
                <Button label={`Remove comparison ${i + 1}`} type="button" variant="secondary" disabled={false} onPress={() => removeComparison(i)} />
              </div>
            );
          })}
          {draft.comparisons.length > 0 && builtOf(draft) === undefined ? <p data-yadad-condition-incomplete="">Fill in every row to apply this condition.</p> : null}
          <div style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
            <Button
              label="Add comparison"
              type="button"
              variant="secondary"
              disabled={false}
              onPress={() => onChange({ combine: draft.combine, comparisons: [...draft.comparisons, candidates.length > 0 ? { not: false, op: "eq", field: candidates[0]!.id } : { not: false, op: "viewerIn", field: facts[0]!.id }] })}
            />
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
