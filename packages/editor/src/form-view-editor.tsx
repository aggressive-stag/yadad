import { conditionViewerFacts, sectionItems } from "@yadad/core";
import type { DocumentError, EntityDocument, FieldValue, FormItem, FormSection, FormView, Registry, ViewerDocument } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { Fragment, useId, useState } from "react";
import type { ReactNode } from "react";
import type { DropTarget, RangeSpan, ReorderableRow } from "./drag.js";
import { flatIndex, insertIndex } from "./drag.js";
import { useReportChange } from "./report-change.js";
import { finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { applyEdit, editRunner } from "./save-result.js";
import { arrowStep, DropIndicator, ReorderGrip, useReorder } from "./reorder.js";
import { builtOf, ConditionBuilder, draftFor } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { asText, choiceField, describeCondition, idFromTitle, propertyInput, toolbarStyle, warningList } from "./ui.js";
import {
  addFormItem,
  addSection,
  fieldsNotOnForm,
  moveFieldTo,
  moveFormItem,
  moveSection,
  moveSectionTo,
  removeFormItem,
  removeSection,
  removeSectionSubRecords,
  setClearWhenHidden,
  setFormItemCondition,
  setFormItemLabel,
  setFormRepeat,
  setSectionSubRecords,
  setSectionTitle,
  subRecordTargetsOf,
  subRecordViaFieldsOf,
} from "./views.js";
import type { SubRecordDraft } from "./views.js";

export interface FormViewEditorProps {
  readonly view: FormView;
  /** The view's entity, for field labels and the fields not placed yet. */
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /** The set's viewer document: with it, "show only when" and "required while" can read a viewer fact (RFC 0006). */
  readonly viewer?: ViewerDocument;
  /** The whole set's entities: with them, a section can become a sub-record checklist over a child entity (RFC 0009 item 3). */
  readonly entities?: readonly EntityDocument[];
  /** Receives the edited form with its revision bumped. */
  readonly onSave: (view: FormView) => void;
  /** Called with the document as it is edited, after every edit, undo or redo; a states preview next to the editor follows it. */
  readonly onChange?: (view: FormView) => void;
  readonly onCancel: () => void;
}


/**
 * Lays out a form: place entity fields in sections, reorder them, take them
 * off, and add, rename, reorder or remove sections. A field or section can
 * be dragged by its grip — the drag shows where it will land — or moved one
 * step with the arrow keys; each move is one undoable patch, and where it
 * lands is announced. Conditions on a field are kept and shown.
 */
export function FormViewEditor({ view, entity, registry, viewer, entities, onSave, onChange, onCancel }: FormViewEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<FormView>>(() => startSession(view));
  useReportChange(session.current, onChange);
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [newSection, setNewSection] = useState("");
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const [adding, setAdding] = useState<{ readonly field?: string | undefined; readonly section?: string | undefined }>({});
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({});
  const [subEdit, setSubEdit] = useState<{ readonly sectionId: string; readonly draft: SubRecordDraft } | undefined>(undefined);
  const [status, setStatus] = useState("");
  const { Table, Button, Section, ErrorSummary } = registry.layout;
  const current = session.current;

  const label = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;

  // Sub-record checklists (RFC 0009 item 3): children of this entity — those carrying a reference back to it —
  // that can hold a checklist: a text field for the row title and a boolean for the tick.
  const checklistTargets = subRecordTargetsOf(entity, entities ?? []).filter((e) => e.fields.some((f) => f.type === "text") && e.fields.some((f) => f.type === "boolean"));
  const childOf = (childId: string) => entities?.find((e) => e.id === childId);
  const childLabel = (childId: string, fieldId: string) => childOf(childId)?.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const draftForChild = (child: EntityDocument): SubRecordDraft => ({
    entity: child.id,
    via: subRecordViaFieldsOf(child, entity)[0] ?? "",
    titleField: child.fields.find((f) => f.type === "text")?.id ?? "",
    doneField: child.fields.find((f) => f.type === "boolean")?.id ?? "",
    orderField: child.fields.find((f) => f.type === "number")?.id,
  });
  const factLabel = (id: string) => viewer?.facts.find((f) => f.id === id)?.label ?? id;
  const sectionName = (id: string) => current.sections.find((s) => s.id === id)?.title ?? id;
  const announce = (message: string) => {
    setProblems([]);
    setStatus(message);
  };

  const run = editRunner(session, setSession, setProblems);

  /** The 1-based position of a field within the section it is in. */
  const positionOf = (doc: FormView, fieldId: string): { readonly section: string; readonly at: number } => {
    for (const section of doc.sections) {
      const at = sectionItems(section).findIndex((item) => item.field === fieldId); // RFC 0008/9: card 47b
      if (at >= 0) return { section: section.title ?? section.id, at: at + 1 };
    }
    return { section: "", at: 0 };
  };

  /** Applies a patch through the session and reports it in the status line. */
  const applyAndAnnounce = (patch: PatchOperation[], message: (doc: FormView) => string): void => {
    const next = applyEdit(session, patch, setSession, setProblems);
    if (next.rejected.length > 0) return announce(`Not moved: ${next.rejected[0]?.message ?? "invalid form"}.`);
    announce(message(next.current));
  };

  /** A one-step move of a field from the keyboard, announced. */
  const keyMoveField = (fieldId: string, step: -1 | 1) => {
    const result = moveFormItem(current, fieldId, step);
    if (!Array.isArray(result) && !result.ok) return announce(`Not moved: ${result.error.message}`);
    const patch = Array.isArray(result) ? result : result.patch;
    applyAndAnnounce(patch, (next) => `${label(fieldId)} moved ${step < 0 ? "up" : "down"} to ${positionOf(next, fieldId).section}, position ${positionOf(next, fieldId).at}.`);
  };

  /** A drag drop of a field: one validated patch, so one Undo reverts it. */
  const dropField = (fieldId: string, target: DropTarget) => {
    const result = moveFieldTo(current, fieldId, target.sectionId, target.index);
    if (!Array.isArray(result) && !result.ok) return announce(`Not moved: ${result.error.message}`);
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return; // a no-op drop: no undo step, nothing to say
    applyAndAnnounce(patch, (next) => {
      const { section, at } = positionOf(next, fieldId);
      return `${label(fieldId)} moved to ${section}, position ${at}.`;
    });
  };

  /** A one-step move of a section from the keyboard, announced. */
  const keyMoveSection = (sectionId: string, step: -1 | 1) => {
    const result = moveSection(current, sectionId, step);
    if (!Array.isArray(result) && !result.ok) return announce(`Not moved: ${result.error.message}`);
    const patch = Array.isArray(result) ? result : result.patch;
    applyAndAnnounce(
      patch,
      (next) => `Section ${next.sections.find((s) => s.id === sectionId)?.title ?? sectionId} moved to position ${next.sections.findIndex((s) => s.id === sectionId) + 1}.`,
    );
  };

  /** A drag drop of a section: one validated patch, so one Undo reverts it. */
  const dropSection = (sectionId: string, target: DropTarget) => {
    const result = moveSectionTo(current, sectionId, target.index);
    if (!Array.isArray(result) && !result.ok) return announce(`Not moved: ${result.error.message}`);
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return; // a no-op drop: no undo step, nothing to say
    applyAndAnnounce(
      patch,
      (next) => `Section ${next.sections.find((s) => s.id === sectionId)?.title ?? sectionId} moved to position ${next.sections.findIndex((s) => s.id === sectionId) + 1}.`,
    );
  };

  // Drag geometry over the laid-out DOM. The rows and spans are looked up
  // while the pointer moves, so the math always sees the rendered
  // positions; the registry's Table owns the <tr>, so a row's element is
  // the closest <tr> of its first cell's marker.
  const rowEl = (id: string): HTMLElement | undefined => {
    const marker = document.querySelector<HTMLElement>(`[data-yadad-row="${id}"]`);
    return (marker?.closest("tr") as HTMLElement | null) ?? marker ?? undefined;
  };
  const spanEl = (id: string): HTMLElement | undefined => document.querySelector<HTMLElement>(`[data-yadad-section-span="${id}"]`) ?? undefined;

  const fieldRows = (): readonly ReorderableRow[] => {
    const rows: ReorderableRow[] = [];
    for (const section of current.sections)
      for (const item of sectionItems(section)) { // RFC 0008/9: card 47b
        const el = rowEl(item.field);
        if (el) rows.push({ id: item.field, sectionId: section.id, el });
      }
    return rows;
  };
  const sectionRows = (): readonly ReorderableRow[] => {
    const rows: ReorderableRow[] = [];
    for (const section of current.sections) {
      const el = spanEl(section.id);
      if (el) rows.push({ id: section.id, sectionId: "", el });
    }
    return rows;
  };
  const sectionSpans = (): readonly RangeSpan[] => {
    const spans: RangeSpan[] = [];
    for (const section of current.sections) {
      const el = spanEl(section.id);
      if (el) spans.push({ id: section.id, el });
    }
    return spans;
  };

  const fieldDrag = useReorder((y, id) => insertIndex(fieldRows(), sectionSpans(), y, id), dropField);
  const sectionDrag = useReorder(
    (y, id) => ({ sectionId: "", index: flatIndex(sectionRows(), y, id) }),
    (id, target) => dropSection(id, target),
  );

  // Condition editing: one builder at a time, for one field's one rule.
  // The builder edits the condition the document holds (conditions.ts);
  // anything deeper than it edits is shown intact in words and replaced
  // wholesale — never dropped, never half-edited. "Show only when" may not
  // reference the field itself: the field would decide its own visibility.
  // "Required while" may: a field can require itself while a value holds.
  type RuleKey = "visibleWhen" | "requiredWhen" | "clearWhenHidden";
  const [builder, setBuilder] = useState<{ readonly field: string; readonly rule: RuleKey; readonly draft: ConditionDraft | undefined } | undefined>(undefined);
  const itemOf = (fieldId: string) => current.sections.flatMap(sectionItems).find((i) => i.field === fieldId);
  const ruleCondition = (item: FormItem | undefined, rule: RuleKey) => (rule === "visibleWhen" ? item?.visibleWhen : rule === "requiredWhen" ? item?.requiredWhen : undefined);
  const ruleText = (item: FormItem | undefined, rule: RuleKey) => {
    const c = ruleCondition(item, rule);
    return c === undefined ? undefined : rule === "visibleWhen" ? `Shown when ${describeCondition(c, label, factLabel)}` : `Required when ${describeCondition(c, label, factLabel)}`;
  };
  const openRule = (fieldId: string, rule: RuleKey) => {
    if (rule === "clearWhenHidden") return;
    setBuilder((open) => (open && open.field === fieldId && open.rule === rule ? undefined : { field: fieldId, rule, draft: draftFor(entity, ruleCondition(itemOf(fieldId), rule), rule === "visibleWhen" ? fieldId : undefined) }));
  };
  const closeRule = () => setBuilder(undefined);
  const applyRule = (fieldId: string, rule: RuleKey) => {
    if (rule === "clearWhenHidden") {
      const on = itemOf(fieldId)?.clearWhenHidden !== true;
      run(setClearWhenHidden(current, fieldId, on), () => announce(`${label(fieldId)} ${on ? "clears its value while hidden." : "keeps its value while hidden."}`));
      return;
    }
    const draft = builder && builder.field === fieldId && builder.rule === rule ? builder.draft : undefined;
    const built = builtOf(draft);
    const same = JSON.stringify(built) === JSON.stringify(ruleCondition(itemOf(fieldId), rule));
    if (same) return;
    run(setFormItemCondition(current, fieldId, rule, built), () => {
      closeRule();
      announce(built === undefined ? `${label(fieldId)} ${ruleLabelText(rule)}: cleared.` : `${label(fieldId)} ${ruleLabelText(rule)}: ${describeCondition(built, label, factLabel)}.`);
    });
  };
  const removeRule = (fieldId: string, rule: "visibleWhen" | "requiredWhen") => {
    run(setFormItemCondition(current, fieldId, rule, undefined), () => {
      closeRule();
      announce(`${label(fieldId)} ${ruleLabelText(rule)}: cleared.`);
    });
  };
  const ruleLabelText = (rule: RuleKey) => (rule === "visibleWhen" ? "show only when" : rule === "requiredWhen" ? "required while" : "clear while hidden");

  // Adding a field: pick one not on the form, and the section to put it in.
  const missing = fieldsNotOnForm(entity, current);
  const fieldChoice = adding.field && missing.includes(adding.field) ? adding.field : missing[0];
  const sectionChoice = adding.section && current.sections.some((s) => s.id === adding.section) ? adding.section : current.sections[0]?.id;
  const fieldPicker = choiceField("add_field", "Field to add", missing.map(label));
  const sectionPicker = choiceField("add_to", "Into section", current.sections.map((s) => sectionName(s.id)));
  const pick = (choices: readonly string[], name: (id: string) => string, v: FieldValue | undefined) => choices.find((id) => name(id) === v);

  const conditionText = (item: FormItem): string =>
    [
      ruleText(item, "visibleWhen"),
      ruleText(item, "requiredWhen"),
      item.clearWhenHidden && "Cleared while hidden",
    ]
      .filter(Boolean)
      .join(". ");

  /** The open builder, when it belongs to this field's row: set or remove its rule. */
  const builderFor = (item: FormItem): ReactNode => {
    if (!builder || builder.field !== item.field || builder.rule === "clearWhenHidden") return null;
    const rule: "visibleWhen" | "requiredWhen" = builder.rule;
    return (
      <div data-yadad-rule-builder="" style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
        <ConditionBuilder
          id={`${base}-${item.field}-${rule}`}
          label={ruleLabelText(rule)}
          registry={registry}
          entity={entity}
          viewer={viewer}
          excludeField={rule === "visibleWhen" ? item.field : undefined}
          draft={builder.draft}
          onChange={(draft) => setBuilder({ field: item.field, rule, draft })}
          current={ruleCondition(item, rule)}
          onReplace={() => setBuilder({ field: item.field, rule, draft: draftFor(entity, undefined, rule === "visibleWhen" ? item.field : undefined) })}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <Button
            label={`Apply ${ruleLabelText(rule)}`}
            type="button"
            variant="primary"
            disabled={builtOf(builder.draft) === undefined || JSON.stringify(builtOf(builder.draft)) === JSON.stringify(ruleCondition(item, rule))}
            onPress={() => applyRule(item.field, rule)}
          />
          {ruleCondition(item, rule) !== undefined && (
            <Button label={`Remove ${ruleLabelText(rule)}`} type="button" variant="secondary" disabled={false} onPress={() => removeRule(item.field, rule)} />
          )}
          <Button label={`Cancel ${ruleLabelText(rule)}`} type="button" variant="secondary" disabled={false} onPress={closeRule} />
        </div>
      </div>
    );
  };

  const columns = ["Field", "Rules", "Actions"].map((name) => ({ id: name.toLowerCase(), headerId: `${base}-col-${name}`, label: name, sortable: false }));

  // Where the field drag's indicator sits in a section: inside the cell of
  // the row the field will precede, or after the table at the end.
  const fieldOthers = (section: FormView["sections"][number]) => sectionItems(section).filter((item) => item.field !== fieldDrag.active); // // RFC 0008/9: card 47b
  const fieldIndicator = (section: FormView["sections"][number], item: FormItem): boolean => {
    const t = fieldDrag.target;
    if (!t || t.sectionId !== section.id) return false;
    return fieldOthers(section).findIndex((i) => i.field === item.field) === t.index;
  };
  const fieldIndicatorAfterTable = (section: FormView["sections"][number]): boolean => {
    const t = fieldDrag.target;
    return t !== undefined && t.sectionId === section.id && t.index >= fieldOthers(section).length;
  };

  // Where the section drag's indicator sits: before the section it will
  // precede, or after the last section.
  const sectionOthers = current.sections.filter((s) => s.id !== sectionDrag.active);
  const sectionIndicatorBefore = (id: string): boolean => sectionDrag.target !== undefined && sectionOthers.findIndex((s) => s.id === id) === sectionDrag.target.index;
  const sectionIndicatorAfterLast = sectionDrag.target !== undefined && sectionDrag.target.index >= sectionOthers.length;

  const fieldGrip = (fieldId: string) => (
    <ReorderGrip
      label={`Drag the field ${label(fieldId)}`}
      dragging={fieldDrag.active === fieldId}
      onPointerDown={(e) => fieldDrag.start(e, fieldId)}
      onPointerMove={fieldDrag.move}
      onPointerUp={fieldDrag.drop}
      onPointerCancel={fieldDrag.cancel}
      onKeyDown={(e) => {
        const step = arrowStep(e);
        if (step === 0) return;
        e.preventDefault();
        keyMoveField(fieldId, step);
      }}
    />
  );

  const sectionView = (section: FormSection, index: number): ReactNode => {
    const titleId = `${base}-title-${section.id}`;
    const title = titles[section.id] ?? section.title ?? "";
    const sectionToolbar = (extra?: ReactNode) => (
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        <ReorderGrip
          label={`Drag the section ${section.title ?? section.id}`}
          dragging={sectionDrag.active === section.id}
          onPointerDown={(e) => sectionDrag.start(e, section.id)}
          onPointerMove={sectionDrag.move}
          onPointerUp={sectionDrag.drop}
          onPointerCancel={sectionDrag.cancel}
          onKeyDown={(e) => {
            const step = arrowStep(e);
            if (step === 0) return;
            e.preventDefault();
            keyMoveSection(section.id, step);
          }}
        />
        {/* Enter in the title input commits the rename like the button; the input itself is the registry's, so the commit rides the bubbling keydown. */}
        <span
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (title !== (section.title ?? "")) run(setSectionTitle(current, section.id, title));
          }}
        >
          {propertyInput(registry, titleId, { id: "title", type: "text", label: "Section title" }, title, (v) => setTitles((t) => ({ ...t, [section.id]: asText(v) })))}
        </span>
        <Button label="Rename section" type="button" variant="secondary" disabled={title === (section.title ?? "")} onPress={() => run(setSectionTitle(current, section.id, title))} />
        <Button label="Move section up" type="button" variant="secondary" disabled={index === 0} onPress={() => run(moveSection(current, section.id, -1))} />
        <Button label="Move section down" type="button" variant="secondary" disabled={index === current.sections.length - 1} onPress={() => run(moveSection(current, section.id, 1))} />
        <Button label="Remove section" type="button" variant="secondary" disabled={false} onPress={() => run(removeSection(current, section.id))} />
        {extra}
      </div>
    );

    // The checklist builder (RFC 0009 item 3), shared by a section that already is a checklist and
    // by a field section that is being turned into one.
    const subBuilder = (draft: SubRecordDraft): ReactNode => {
      const child = childOf(draft.entity);
      const viaFields = (child?.fields ?? []).filter((f) => f.type === "reference" && f.entity === entity.id);
      const textFields = (child?.fields ?? []).filter((f) => f.type === "text");
      const boolFields = (child?.fields ?? []).filter((f) => f.type === "boolean");
      const numFields = [{ id: "", label: "(no order field)" } as const, ...(child?.fields ?? []).filter((f) => f.type === "number")];
      const patchDraft = (patch: Partial<SubRecordDraft>) => setSubEdit({ sectionId: section.id, draft: { ...draft, ...patch } });
      const ready = draft.entity !== "" && draft.via !== "" && draft.titleField !== "" && draft.doneField !== "";
      return (
        <div data-yadad-subrecord-builder={section.id} style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
              <div data-yadad-editor-toolbar="" style={toolbarStyle}>
                {propertyInput(registry, `${base}-sub-via-${section.id}`, choiceField("sub_via", "Linked by", viaFields.map((f) => f.label)), childLabel(draft.entity, draft.via), (v) =>
                  patchDraft({ via: viaFields.find((f) => f.label === v)?.id ?? draft.via }),
                )}
                {propertyInput(registry, `${base}-sub-title-${section.id}`, choiceField("sub_title", "Row title from", textFields.map((f) => f.label)), childLabel(draft.entity, draft.titleField), (v) =>
                  patchDraft({ titleField: textFields.find((f) => f.label === v)?.id ?? draft.titleField }),
                )}
                {propertyInput(registry, `${base}-sub-done-${section.id}`, choiceField("sub_done", "Tick from", boolFields.map((f) => f.label)), childLabel(draft.entity, draft.doneField), (v) =>
                  patchDraft({ doneField: boolFields.find((f) => f.label === v)?.id ?? draft.doneField }),
                )}
                {propertyInput(registry, `${base}-sub-order-${section.id}`, choiceField("sub_order", "Order by", numFields.map((f) => f.label)), numFields.find((f) => f.id === (draft.orderField ?? ""))?.label ?? "(no order field)", (v) => {
                  const picked = numFields.find((f) => f.label === v)?.id ?? "";
                  patchDraft({ orderField: picked === "" ? undefined : picked });
                })}
                {propertyInput(registry, `${base}-sub-add-${section.id}`, { id: "sub_add", type: "text", label: "Add button label (optional)" }, draft.addLabel ?? "", (v) => patchDraft({ addLabel: asText(v) }))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                <Button
                  label="Apply checklist"
                  type="button"
                  variant="primary"
                  disabled={!ready}
                  onPress={() => run(setSectionSubRecords(current, section.id, draft), () => { setSubEdit(undefined); announce(`Section "${section.title ?? section.id}" is a checklist over ${draft.entity}.`); })}
                />
                <Button label="Cancel checklist" type="button" variant="secondary" disabled={false} onPress={() => setSubEdit(undefined)} />
              </div>
        </div>
      );
    };

    // A sub-record checklist section (RFC 0009 item 3): rows are ordinary records of the child entity;
    // the editor shows what the checklist points at and lets you retarget it.
    if (section.subRecords !== undefined) {
      const sub = section.subRecords;
      const editingHere = subEdit?.sectionId === section.id;
      return (
        <Section key={section.id} id={`${base}-section-${section.id}`} title={`Section: ${section.title ?? section.id}`}>
          {sectionToolbar()}
          <p data-yadad-subrecord-section={section.id}>
            Checklist over <strong>{sub.entity}</strong>: rows titled by {childLabel(sub.entity, sub.titleField)}, ticked by {childLabel(sub.entity, sub.doneField)}, linked by {childLabel(sub.entity, sub.via)}
            {sub.orderField !== undefined ? `, ordered by ${childLabel(sub.entity, sub.orderField)}` : ""}. Adding a row creates a {sub.entity}; the rows save through the normal record path.
          </p>
          {editingHere ? (
            subBuilder(subEdit.draft)
          ) : (
            <div data-yadad-editor-toolbar="" style={toolbarStyle}>
              <Button label="Edit checklist" type="button" variant="secondary" disabled={false} onPress={() => setSubEdit({ sectionId: section.id, draft: { entity: sub.entity, via: sub.via, titleField: sub.titleField, doneField: sub.doneField, orderField: sub.orderField, addLabel: sub.addLabel } })} />
              <Button label="Remove checklist" type="button" variant="secondary" disabled={false} onPress={() => run(removeSectionSubRecords(current, section.id), () => announce(`Section "${section.title ?? section.id}" is an empty field section again.`))} />
            </div>
          )}
        </Section>
      );
    }

    const rows = sectionItems(section).map((item) => ({ // // RFC 0008/9: card 47b
      id: item.field,
      cells: [
        <span key="field" data-yadad-row={item.field} style={{ display: "flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)", flexWrap: "wrap" }}>
          {fieldIndicator(section, item) && <DropIndicator />}
          {fieldGrip(item.field)}
          {label(item.field)}
          {/* RFC 0008 item 25: this form may show the field under a label of its own; blank means the field's own label. */}
          {propertyInput(
            registry,
            `${base}-label-${section.id}-${item.field}`,
            { id: "item_label", type: "text", label: `Label for ${label(item.field)} on this form (optional)` },
            labels[`${section.id}:${item.field}`] ?? item.label ?? "",
            (v) => setLabels((l) => ({ ...l, [`${section.id}:${item.field}`]: asText(v) })),
          )}
          <Button
            label={`Set label for ${label(item.field)}`}
            type="button"
            variant="secondary"
            disabled={(labels[`${section.id}:${item.field}`] ?? item.label ?? "") === (item.label ?? "")}
            onPress={() =>
              run(setFormItemLabel(current, item.field, labels[`${section.id}:${item.field}`] ?? item.label), () => {
                const nextLabel = labels[`${section.id}:${item.field}`]?.trim() ?? "";
                announce(nextLabel === "" ? `${label(item.field)} shows under the field's own label again on this form.` : `The label of ${label(item.field)} on this form is "${nextLabel}".`);
              })
            }
          />
        </span>,
        <span key="rules">
          {conditionText(item) || "None"}
          {builderFor(item)}
        </span>,
        <span key="actions" style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <Button label={`Move ${label(item.field)} up`} type="button" variant="secondary" disabled={false} onPress={() => run(moveFormItem(current, item.field, -1))} />
          <Button label={`Move ${label(item.field)} down`} type="button" variant="secondary" disabled={false} onPress={() => run(moveFormItem(current, item.field, 1))} />
          <Button label={`Remove ${label(item.field)}`} type="button" variant="secondary" disabled={false} onPress={() => run(removeFormItem(current, item.field))} />
          <Button label={`Show only when: ${label(item.field)}`} type="button" variant="secondary" disabled={false} onPress={() => openRule(item.field, "visibleWhen")} />
          <Button label={`Required while: ${label(item.field)}`} type="button" variant="secondary" disabled={false} onPress={() => openRule(item.field, "requiredWhen")} />
          <Button
            label={`${item.clearWhenHidden ? "Keep" : "Clear"} ${label(item.field)} while hidden`}
            type="button"
            variant="secondary"
            disabled={!item.visibleWhen || conditionViewerFacts(item.visibleWhen).length > 0}
            onPress={() => applyRule(item.field, "clearWhenHidden")}
          />
        </span>,
      ],
    }));
    return (
      <Section key={section.id} id={`${base}-section-${section.id}`} title={`Section: ${section.title ?? section.id}`}>
        {sectionToolbar(
          checklistTargets.length > 0 ? (
            <Button
              label="Make checklist"
              type="button"
              variant="secondary"
              disabled={false}
              onPress={() => {
                const t = checklistTargets[0]!;
                setSubEdit({ sectionId: section.id, draft: draftForChild(t) });
              }}
            />
          ) : null,
        )}
        <Table caption={`Fields in ${section.title ?? section.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No fields in this section yet." />
        {subEdit?.sectionId === section.id ? subBuilder(subEdit.draft) : null}
        {fieldIndicatorAfterTable(section) && <DropIndicator />}
      </Section>
    );
  };

  return (
    <div data-yadad-form-editor={view.id}>
      <p id={`${base}-help`}>
        Drag a field or section by its grip to move it; with the keyboard, focus a grip and use the arrow keys (Up and Left back, Down and Right forward). Esc cancels a drag. The Move buttons step one place.
      </p>
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save form" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {problems.length > 0 && <ErrorSummary errors={problems} />}
      {warningList(current)}
      {/* RFC 0009 item 4: the form can be offered as a batch composer — the host repeats the field set and creates the rows atomically. */}
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        <span>
          {current.repeat === "batch"
            ? "This form is a batch composer: the host repeats the field set and creates the rows in one atomic batch."
            : "This form creates one record per submit."}
        </span>
        <Button
          label={`${current.repeat === "batch" ? "Turn off" : "Turn on"} batch composer`}
          type="button"
          variant="secondary"
          disabled={false}
          onPress={() => run(setFormRepeat(current, current.repeat !== "batch"), () => announce(current.repeat === "batch" ? "Batch composer off: one record per submit." : "Batch composer on: the host can offer this form as a batch."))}
        />
      </div>
      <Section id={`${base}-add`} title="Add to the form">
        {missing.length === 0 ? (
          <p>Every field of {entity.id} is on this form.</p>
        ) : (
          <div data-yadad-editor-toolbar="" style={toolbarStyle}>
            <p>Not on this form yet: {missing.map(label).join(", ")}.</p>
            {propertyInput(registry, `${base}-add-field`, fieldPicker, fieldChoice ? label(fieldChoice) : undefined, (v) => setAdding((a) => ({ ...a, field: pick(missing, label, v) })))}
            {current.sections.length > 0 &&
              propertyInput(registry, `${base}-add-to`, sectionPicker, sectionChoice ? sectionName(sectionChoice) : undefined, (v) =>
                setAdding((a) => ({ ...a, section: pick(current.sections.map((s) => s.id), sectionName, v) })),
              )}
            <Button
              label="Add field to form"
              type="button"
              variant="primary"
              disabled={!fieldChoice || !sectionChoice}
              onPress={() => fieldChoice && sectionChoice && run(addFormItem(current, sectionChoice, fieldChoice), () => setAdding({ section: sectionChoice }))}
            />
          </div>
        )}
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {propertyInput(registry, `${base}-new-section`, { id: "new_section", type: "text", label: "New section title" }, newSection, (v) => setNewSection(asText(v)))}
          <Button
            label="Add section"
            type="button"
            variant="secondary"
            disabled={newSection.trim() === ""}
            onPress={() => run(addSection(current, idFromTitle(newSection, current.sections.map((s) => s.id), "section"), newSection.trim()), () => setNewSection(""))}
          />
        </div>
      </Section>
      {current.sections.map((section, index) => (
        <Fragment key={section.id}>
          {sectionIndicatorBefore(section.id) && <DropIndicator />}
          <div data-yadad-section-span={section.id}>{sectionView(section, index)}</div>
        </Fragment>
      ))}
      {sectionIndicatorAfterLast && <DropIndicator />}
      <p aria-live="polite" data-yadad-editor-status="">
        {status}
      </p>
    </div>
  );
}
