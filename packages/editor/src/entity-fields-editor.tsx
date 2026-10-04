import { FIELD_TYPES } from "@yadad/core";
import type { DocumentError, EntityDocument, Field, FieldType, FieldValue, RecordValues, Registry, SelectField, ViewDocument } from "@yadad/core";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { COMMON_PROPERTIES, FIELD_PROPERTIES, FIELD_TYPE_LABELS, fieldFromProperties, propertiesFromField } from "./field-options";
import { addField, removeField, updateField } from "./fields";
import { renderInput } from "./inputs";
import { edit, finish, isDirty, redo, startSession, undo } from "./session";
import type { EditSession } from "./session";

export interface EntityFieldsEditorProps {
  readonly entity: EntityDocument;
  /** Every view, so removing a field that is still in use can be refused. */
  readonly views: readonly ViewDocument[];
  readonly registry: Registry<ReactNode>;
  /** Receives the edited entity with its revision bumped. */
  readonly onSave: (entity: EntityDocument) => void;
  readonly onCancel: () => void;
}

interface PanelState {
  /** The field being edited, or undefined when adding a new one. */
  readonly editing?: string;
  readonly type: FieldType;
  readonly values: RecordValues;
}

const typeChooser: SelectField = {
  id: "type",
  type: "select",
  label: "Field type",
  required: true,
  options: { source: "static", values: FIELD_TYPES.map((t) => FIELD_TYPE_LABELS[t]) },
};

/**
 * Lists an entity's fields and edits them: add a field, change one's label,
 * options or required flag, or remove one no view uses. Ids and types of
 * existing fields are fixed, since saved records depend on them.
 */
export function EntityFieldsEditor({ entity, views, registry, onSave, onCancel }: EntityFieldsEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<EntityDocument>>(() => startSession(entity));
  const [panel, setPanel] = useState<PanelState | undefined>(undefined);
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const { Table, Button, Section, FieldFrame, ErrorSummary } = registry.layout;
  const current = session.current;

  const applyPatch = (next: EditSession<EntityDocument>, onOk?: () => void) => {
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length === 0) onOk?.();
  };

  const remove = (field: Field) => {
    const result = removeField(current, field.id, views);
    if (!result.ok) setProblems([result.error]);
    else applyPatch(edit(session, result.patch));
  };

  const applyPanel = () => {
    if (!panel) return;
    const field = fieldFromProperties(panel.type, panel.editing ? { ...panel.values, id: panel.editing } : panel.values);
    if (!panel.editing) return applyPatch(edit(session, addField(current, field)), () => setPanel(undefined));
    const result = updateField(current, field);
    if (!result.ok) setProblems([result.error]);
    else applyPatch(edit(session, result.patch), () => setPanel(undefined));
  };

  const setValue = (key: string, value: FieldValue | undefined) => setPanel((p) => (p ? { ...p, values: { ...p.values, [key]: value ?? null } } : p));

  const property = (field: Field): ReactNode => {
    const inputId = `${base}-prop-${field.id}`;
    return (
      <FieldFrame key={field.id} inputId={inputId} errorId={`${inputId}-errors`} label={field.label} required={field.required === true} errors={[]}>
        {renderInput(registry, field, panel?.values[field.id] ?? undefined, { inputId, invalid: false }, (v) => setValue(field.id, v))}
      </FieldFrame>
    );
  };

  const typeInputId = `${base}-type`;
  const panelView = panel && (
    <Section id="field-panel" title={panel.editing ? `Edit "${panel.editing}"` : "Add a field"}>
      {panel.editing ? (
        <p>
          Type: {FIELD_TYPE_LABELS[panel.type]} (fixed: saved records depend on it)
        </p>
      ) : (
        <FieldFrame inputId={typeInputId} errorId={`${typeInputId}-errors`} label={typeChooser.label} required errors={[]}>
          {renderInput(registry, typeChooser, FIELD_TYPE_LABELS[panel.type], { inputId: typeInputId, invalid: false }, (label) => {
            const type = FIELD_TYPES.find((t) => FIELD_TYPE_LABELS[t] === label);
            if (type) setPanel((p) => (p ? { ...p, type } : p));
          })}
        </FieldFrame>
      )}
      {COMMON_PROPERTIES.filter((p) => !(panel.editing && p.id === "id")).map(property)}
      {FIELD_PROPERTIES[panel.type].map(property)}
      <Button label={panel.editing ? "Apply changes" : "Add field"} type="button" variant="primary" disabled={false} onPress={applyPanel} />
      <Button label="Close" type="button" variant="secondary" disabled={false} onPress={() => setPanel(undefined)} />
    </Section>
  );

  const columns = ["Label", "Id", "Type", "Required", "Actions"].map((label) => ({ id: label.toLowerCase(), headerId: `${base}-col-${label}`, label, sortable: false }));
  const rows = current.fields.map((field) => ({
    id: field.id,
    cells: [
      field.label,
      field.id,
      FIELD_TYPE_LABELS[field.type],
      field.required === true ? "Yes" : "No",
      <span key="actions">
        <Button label={`Edit ${field.label}`} type="button" variant="secondary" disabled={false} onPress={() => setPanel({ editing: field.id, type: field.type, values: propertiesFromField(field) })} />
        <Button label={`Remove ${field.label}`} type="button" variant="secondary" disabled={false} onPress={() => remove(field)} />
      </span>,
    ],
  }));

  return (
    <div data-yadad-entity-editor={entity.id}>
      <div data-yadad-editor-toolbar="">
        <Button label="New field" type="button" variant="secondary" disabled={false} onPress={() => setPanel({ type: "text", values: {} })} />
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save fields" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {problems.length > 0 && <ErrorSummary errors={problems} />}
      {panelView}
      <Table caption={`Fields of ${entity.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No fields yet." />
    </div>
  );
}
