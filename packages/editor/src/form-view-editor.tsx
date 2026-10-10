import type { DocumentError, EntityDocument, FieldValue, FormItem, FormView, Registry } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { asText, choiceField, describeCondition, idFromTitle, propertyInput, toolbarStyle, warningList } from "./ui.js";
import { addFormItem, addSection, fieldsNotOnForm, moveFormItem, moveSection, removeFormItem, removeSection, setSectionTitle } from "./views.js";

export interface FormViewEditorProps {
  readonly view: FormView;
  /** The view's entity, for field labels and the fields not placed yet. */
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /** Receives the edited form with its revision bumped. */
  readonly onSave: (view: FormView) => void;
  readonly onCancel: () => void;
}

type Result = PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

/**
 * Lays out a form: place entity fields in sections, reorder them (a field
 * moves across into the next section at an edge), take them off, and add,
 * rename, reorder or remove sections. Conditions on a field are kept and shown.
 */
export function FormViewEditor({ view, entity, registry, onSave, onCancel }: FormViewEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<FormView>>(() => startSession(view));
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [newSection, setNewSection] = useState("");
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const [adding, setAdding] = useState<{ readonly field?: string | undefined; readonly section?: string | undefined }>({});
  const { Table, Button, Section, ErrorSummary } = registry.layout;
  const current = session.current;

  const label = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const sectionName = (id: string) => current.sections.find((s) => s.id === id)?.title ?? id;

  const run = (result: Result, onOk?: () => void) => {
    if (!Array.isArray(result) && !result.ok) return setProblems([result.error]);
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return onOk?.();
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length === 0) onOk?.();
  };

  // Adding a field: pick one not on the form, and the section to put it in.
  const missing = fieldsNotOnForm(entity, current);
  const fieldChoice = adding.field && missing.includes(adding.field) ? adding.field : missing[0];
  const sectionChoice = adding.section && current.sections.some((s) => s.id === adding.section) ? adding.section : current.sections[0]?.id;
  const fieldPicker = choiceField("add_field", "Field to add", missing.map(label));
  const sectionPicker = choiceField("add_to", "Into section", current.sections.map((s) => sectionName(s.id)));
  const pick = (choices: readonly string[], name: (id: string) => string, v: FieldValue | undefined) => choices.find((id) => name(id) === v);

  const conditions = (item: FormItem): string =>
    [
      item.visibleWhen && `Shown when ${describeCondition(item.visibleWhen, label)}`,
      item.requiredWhen && `Required when ${describeCondition(item.requiredWhen, label)}`,
      item.clearWhenHidden && "Cleared while hidden",
    ]
      .filter(Boolean)
      .join(". ");

  const columns = ["Field", "Rules", "Actions"].map((name) => ({ id: name.toLowerCase(), headerId: `${base}-col-${name}`, label: name, sortable: false }));

  const sectionView = (section: FormView["sections"][number], index: number): ReactNode => {
    const titleId = `${base}-title-${section.id}`;
    const title = titles[section.id] ?? section.title ?? "";
    const rows = section.items.map((item) => ({
      id: item.field,
      cells: [
        label(item.field),
        conditions(item) || "None",
        <span key="actions" style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <Button label={`Move ${label(item.field)} up`} type="button" variant="secondary" disabled={false} onPress={() => run(moveFormItem(current, item.field, -1))} />
          <Button label={`Move ${label(item.field)} down`} type="button" variant="secondary" disabled={false} onPress={() => run(moveFormItem(current, item.field, 1))} />
          <Button label={`Remove ${label(item.field)}`} type="button" variant="secondary" disabled={false} onPress={() => run(removeFormItem(current, item.field))} />
        </span>,
      ],
    }));
    return (
      <Section key={section.id} id={`${base}-section-${section.id}`} title={`Section: ${section.title ?? section.id}`}>
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {propertyInput(registry, titleId, { id: "title", type: "text", label: "Section title" }, title, (v) => setTitles((t) => ({ ...t, [section.id]: asText(v) })))}
          <Button label="Rename section" type="button" variant="secondary" disabled={title === (section.title ?? "")} onPress={() => run(setSectionTitle(current, section.id, title))} />
          <Button label="Move section up" type="button" variant="secondary" disabled={index === 0} onPress={() => run(moveSection(current, section.id, -1))} />
          <Button label="Move section down" type="button" variant="secondary" disabled={index === current.sections.length - 1} onPress={() => run(moveSection(current, section.id, 1))} />
          <Button label="Remove section" type="button" variant="secondary" disabled={false} onPress={() => run(removeSection(current, section.id))} />
        </div>
        <Table caption={`Fields in ${section.title ?? section.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No fields in this section yet." />
      </Section>
    );
  };

  return (
    <div data-yadad-form-editor={view.id}>
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
      {current.sections.map(sectionView)}
    </div>
  );
}
