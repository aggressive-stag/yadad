import type { DocumentError, EntityDocument, FieldValue, FormItem, FormView, Registry } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { Fragment, useId, useState } from "react";
import type { ReactNode } from "react";
import type { DropTarget, RangeSpan, ReorderableRow } from "./drag.js";
import { flatIndex, insertIndex } from "./drag.js";
import { useReportChange } from "./report-change.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
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
  setClearWhenHidden,
  setFormItemCondition,
  setSectionTitle,
} from "./views.js";

export interface FormViewEditorProps {
  readonly view: FormView;
  /** The view's entity, for field labels and the fields not placed yet. */
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /** Receives the edited form with its revision bumped. */
  readonly onSave: (view: FormView) => void;
  /** Called with the document as it is edited, after every edit, undo or redo; a states preview next to the editor follows it. */
  readonly onChange?: (view: FormView) => void;
  readonly onCancel: () => void;
}

type Result = PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

/**
 * Lays out a form: place entity fields in sections, reorder them, take them
 * off, and add, rename, reorder or remove sections. A field or section can
 * be dragged by its grip — the drag shows where it will land — or moved one
 * step with the arrow keys; each move is one undoable patch, and where it
 * lands is announced. Conditions on a field are kept and shown.
 */
export function FormViewEditor({ view, entity, registry, onSave, onChange, onCancel }: FormViewEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<FormView>>(() => startSession(view));
  useReportChange(session.current, onChange);
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [newSection, setNewSection] = useState("");
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const [adding, setAdding] = useState<{ readonly field?: string | undefined; readonly section?: string | undefined }>({});
  const [status, setStatus] = useState("");
  const { Table, Button, Section, ErrorSummary } = registry.layout;
  const current = session.current;

  const label = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const sectionName = (id: string) => current.sections.find((s) => s.id === id)?.title ?? id;
  const announce = (message: string) => {
    setProblems([]);
    setStatus(message);
  };

  const run = (result: Result, onOk?: () => void) => {
    if (!Array.isArray(result) && !result.ok) return setProblems([result.error]);
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return onOk?.();
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length === 0) onOk?.();
  };

  /** The 1-based position of a field within the section it is in. */
  const positionOf = (doc: FormView, fieldId: string): { readonly section: string; readonly at: number } => {
    for (const section of doc.sections) {
      const at = section.items.findIndex((item) => item.field === fieldId);
      if (at >= 0) return { section: section.title ?? section.id, at: at + 1 };
    }
    return { section: "", at: 0 };
  };

  /** Applies a patch through the session and reports it in the status line. */
  const applyAndAnnounce = (patch: PatchOperation[], message: (doc: FormView) => string): void => {
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
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
      for (const item of section.items) {
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
  const itemOf = (fieldId: string) => current.sections.flatMap((s) => s.items).find((i) => i.field === fieldId);
  const ruleCondition = (item: FormItem | undefined, rule: RuleKey) => (rule === "visibleWhen" ? item?.visibleWhen : rule === "requiredWhen" ? item?.requiredWhen : undefined);
  const ruleText = (item: FormItem | undefined, rule: RuleKey) => {
    const c = ruleCondition(item, rule);
    return c === undefined ? undefined : rule === "visibleWhen" ? `Shown when ${describeCondition(c, label)}` : `Required when ${describeCondition(c, label)}`;
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
      announce(built === undefined ? `${label(fieldId)} ${ruleLabelText(rule)}: cleared.` : `${label(fieldId)} ${ruleLabelText(rule)}: ${describeCondition(built, label)}.`);
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
  const fieldOthers = (section: FormView["sections"][number]) => section.items.filter((item) => item.field !== fieldDrag.active);
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

  const sectionView = (section: FormView["sections"][number], index: number): ReactNode => {
    const titleId = `${base}-title-${section.id}`;
    const title = titles[section.id] ?? section.title ?? "";
    const rows = section.items.map((item) => ({
      id: item.field,
      cells: [
        <span key="field" data-yadad-row={item.field} style={{ display: "flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
          {fieldIndicator(section, item) && <DropIndicator />}
          {fieldGrip(item.field)}
          {label(item.field)}
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
            disabled={!item.visibleWhen}
            onPress={() => applyRule(item.field, "clearWhenHidden")}
          />
        </span>,
      ],
    }));
    return (
      <Section key={section.id} id={`${base}-section-${section.id}`} title={`Section: ${section.title ?? section.id}`}>
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
          {propertyInput(registry, titleId, { id: "title", type: "text", label: "Section title" }, title, (v) => setTitles((t) => ({ ...t, [section.id]: asText(v) })))}
          <Button label="Rename section" type="button" variant="secondary" disabled={title === (section.title ?? "")} onPress={() => run(setSectionTitle(current, section.id, title))} />
          <Button label="Move section up" type="button" variant="secondary" disabled={index === 0} onPress={() => run(moveSection(current, section.id, -1))} />
          <Button label="Move section down" type="button" variant="secondary" disabled={index === current.sections.length - 1} onPress={() => run(moveSection(current, section.id, 1))} />
          <Button label="Remove section" type="button" variant="secondary" disabled={false} onPress={() => run(removeSection(current, section.id))} />
        </div>
        <Table caption={`Fields in ${section.title ?? section.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No fields in this section yet." />
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
