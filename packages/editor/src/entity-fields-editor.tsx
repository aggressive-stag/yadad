import { FIELD_TYPES } from "@yadad/core";
import type { ActionConfirm, ActionConfirmTone, DocumentError, EntityDocument, Field, FieldType, FieldValue, RecordAction, RecordValues, Registry, SelectField, ViewDocument } from "@yadad/core";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { COMMON_PROPERTIES, FIELD_PROPERTIES, FIELD_TYPE_LABELS, fieldFromProperties, propertiesFromField } from "./field-options.js";
import { addAction, moveAction, removeAction, updateAction } from "./actions.js";
import { addField, removeField, updateField } from "./fields.js";
import { renderInput } from "./inputs.js";
import { choiceField, propertyInput, warningList } from "./ui.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";

export interface EntityFieldsEditorProps {
  readonly entity: EntityDocument;
  /** Every view, so removing a field that is still in use can be refused. */
  readonly views: readonly ViewDocument[];
  readonly registry: Registry<ReactNode>;
  /**
   * The other entities, so a reference field can pick its target and display
   * field from lists. Without it those are typed as ids.
   */
  readonly entities?: readonly EntityDocument[];
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

/** The Actions panel's form: the id is typed once and then fixed, as a field's is. */
interface ActionPanelState {
  /** The action being edited, or undefined when adding a new one. */
  readonly editing?: string;
  readonly values: RecordValues;
}

const CONFIRM_TONE_LABELS: { readonly [K in ActionConfirmTone]: string } = { neutral: "Neutral", danger: "Danger" };

const ACTION_PANEL_PROPERTIES: readonly Field[] = [
  { id: "id", type: "text", label: "Id", required: true },
  { id: "label", type: "text", label: "Label", required: true },
  { id: "confirmTitle", type: "text", label: "Confirm title (optional)" },
  { id: "confirmMessage", type: "text", label: "Confirm message (optional; a confirm dialog exists only with a message)" },
  { id: "confirmLabel", type: "text", label: "Confirm button label (optional)" },
  choiceField("confirmTone", "Confirm tone", Object.values(CONFIRM_TONE_LABELS)),
];

/** The panel values as a RecordAction, keeping the parts this card does not edit. */
function actionFromPanel(state: ActionPanelState, current?: RecordAction): RecordAction {
  const id = typeof state.values["id"] === "string" && state.values["id"] !== "" ? state.values["id"] : (current?.id ?? "");
  const label = typeof state.values["label"] === "string" ? state.values["label"] : (current?.label ?? "");
  const message = typeof state.values["confirmMessage"] === "string" ? state.values["confirmMessage"].trim() : "";
  const title = typeof state.values["confirmTitle"] === "string" ? state.values["confirmTitle"].trim() : "";
  const confirmLabel = typeof state.values["confirmLabel"] === "string" ? state.values["confirmLabel"].trim() : "";
  const tone = Object.keys(CONFIRM_TONE_LABELS).find((t) => CONFIRM_TONE_LABELS[t as ActionConfirmTone] === state.values["confirmTone"]) as ActionConfirmTone | undefined;
  const confirm: ActionConfirm | undefined = message === "" ? undefined : { message, ...(title !== "" ? { title } : {}), ...(confirmLabel !== "" ? { confirmLabel } : {}), ...(tone !== undefined && tone !== "neutral" ? { tone } : {}) };
  return { id, label, ...(confirm === undefined ? {} : { confirm }), ...(current?.input === undefined ? {} : { input: current.input }), ...(current?.visibleWhen === undefined ? {} : { visibleWhen: current.visibleWhen }) };
}

function panelFromAction(action: RecordAction): ActionPanelState {
  return {
    editing: action.id,
    values: {
      id: action.id,
      label: action.label,
      ...(action.confirm?.title !== undefined ? { confirmTitle: action.confirm.title } : {}),
      ...(action.confirm !== undefined ? { confirmMessage: action.confirm.message } : {}),
      ...(action.confirm?.confirmLabel !== undefined ? { confirmLabel: action.confirm.confirmLabel } : {}),
      ...(action.confirm?.tone !== undefined ? { confirmTone: CONFIRM_TONE_LABELS[action.confirm.tone] } : {}),
    },
  };
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
export function EntityFieldsEditor({ entity, views, registry, entities, onSave, onCancel }: EntityFieldsEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<EntityDocument>>(() => startSession(entity));
  const [panel, setPanel] = useState<PanelState | undefined>(undefined);
  const [actionPanel, setActionPanel] = useState<ActionPanelState | undefined>(undefined);
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

  const applyActionPanel = () => {
    if (!actionPanel) return;
    const editing = actionPanel.editing === undefined ? undefined : (current.actions ?? []).find((a) => a.id === actionPanel.editing);
    const draft = actionFromPanel(actionPanel, editing);
    // The label and confirm are what this card edits; on an existing action the id in the panel cannot change.
    const result = editing === undefined ? addAction(current, draft) : updateAction(current, editing.id, { label: draft.label, ...(draft.confirm === undefined ? {} : { confirm: draft.confirm }) });
    if (!result.ok) setProblems([result.error]);
    else applyPatch(edit(session, result.patch), () => setActionPanel(undefined));
  };

  const removeActionRow = (action: RecordAction) => {
    const result = removeAction(current, action.id, views);
    if (!result.ok) setProblems([result.error]);
    else applyPatch(edit(session, result.patch));
  };

  const moveActionRow = (action: RecordAction, by: number) => {
    const result = moveAction(current, action.id, by);
    if (!result.ok) setProblems([result.error]);
    else applyPatch(edit(session, result.patch));
  };

  const setActionValue = (key: string, value: FieldValue | undefined) => setActionPanel((p) => (p ? { ...p, values: { ...p.values, [key]: value ?? null } } : p));

  const actionProperty = (field: Field): ReactNode => propertyInput(registry, `${base}-action-prop-${field.id}`, field, actionPanel?.values[field.id] ?? undefined, (v) => setActionValue(field.id, v));

  const actionPanelFields: readonly Field[] = actionPanel?.editing === undefined ? ACTION_PANEL_PROPERTIES : ACTION_PANEL_PROPERTIES.filter((p) => p.id !== "id");

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

  /** The panel's type-specific properties; a reference's target and display become pickers when the entities are known. */
  const propertiesFor = (type: FieldType): readonly Field[] => {
    if (type !== "reference" || !entities || !panel) return FIELD_PROPERTIES[type];
    const targets = [current, ...entities.filter((e) => e.id !== current.id)];
    const chosen = panel.values["entity"];
    const target = typeof chosen === "string" ? targets.find((e) => e.id === chosen) : undefined;
    const labelFields = (target?.fields ?? []).filter((f) => f.type === "text" || f.type === "select").map((f) => f.id);
    return [
      { id: "entity", type: "select", label: "Target entity", required: true, options: { source: "static", values: targets.map((e) => e.id) } },
      ...(labelFields.length > 0
        ? [{ id: "display", type: "select", label: "Display field (default: the first text field)", options: { source: "static", values: labelFields } } satisfies Field]
        : []),
    ];
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
      {propertiesFor(panel.type).map(property)}
      <Button label={panel.editing ? "Apply changes" : "Add field"} type="button" variant="primary" disabled={false} onPress={applyPanel} />
      <Button label="Close" type="button" variant="secondary" disabled={false} onPress={() => setPanel(undefined)} />
    </Section>
  );

  const actionPanelView = actionPanel && (
    <Section id="action-panel" title={actionPanel.editing ? `Edit action "${actionPanel.editing}"` : "Add an action"}>
      {actionPanel.editing !== undefined && (
        <p>
          Id: {actionPanel.editing} (fixed: views offer actions by id; input fields and visibility come in the next card)
        </p>
      )}
      {actionPanelFields.map(actionProperty)}
      <Button label={actionPanel.editing ? "Apply changes" : "Add action"} type="button" variant="primary" disabled={false} onPress={applyActionPanel} />
      <Button label="Close" type="button" variant="secondary" disabled={false} onPress={() => setActionPanel(undefined)} />
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
      <span key="actions" style={{ display: "inline-flex", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
        <Button label={`Edit ${field.label}`} type="button" variant="secondary" disabled={false} onPress={() => setPanel({ editing: field.id, type: field.type, values: propertiesFromField(field) })} />
        <Button label={`Remove ${field.label}`} type="button" variant="secondary" disabled={false} onPress={() => remove(field)} />
      </span>,
    ],
  }));

  const actionColumns = ["Label", "Id", "Confirm", "Actions"].map((label) => ({ id: `action-${label.toLowerCase()}`, headerId: `${base}-action-col-${label}`, label, sortable: false }));
  const actionRows = (current.actions ?? []).map((action, i) => ({
    id: action.id,
    cells: [
      action.label,
      action.id,
      action.confirm === undefined ? "Runs on press" : action.confirm.tone === "danger" ? `Danger: ${action.confirm.message}` : action.confirm.message,
      <span key="actions" style={{ display: "inline-flex", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
        <Button label={`Edit ${action.label}`} type="button" variant="secondary" disabled={false} onPress={() => setActionPanel(panelFromAction(action))} />
        <Button label={`Move ${action.label} up`} type="button" variant="secondary" disabled={i === 0} onPress={() => moveActionRow(action, -1)} />
        <Button label={`Move ${action.label} down`} type="button" variant="secondary" disabled={i === (current.actions ?? []).length - 1} onPress={() => moveActionRow(action, 1)} />
        <Button label={`Remove ${action.label}`} type="button" variant="secondary" disabled={false} onPress={() => removeActionRow(action)} />
      </span>,
    ],
  }));

  return (
    <div data-yadad-entity-editor={entity.id}>
      <div data-yadad-editor-toolbar="" style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockEnd: "var(--yadad-toolbar-gap, 0.5rem)" }}>
        <Button label="New field" type="button" variant="secondary" disabled={false} onPress={() => setPanel({ type: "text", values: {} })} />
        <Button label="New action" type="button" variant="secondary" disabled={false} onPress={() => setActionPanel({ values: {} })} />
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save fields" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {problems.length > 0 && <ErrorSummary errors={problems} />}
      {warningList(current)}
      {panelView}
      {actionPanelView}
      <Table caption={`Fields of ${entity.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No fields yet." />
      <Table caption={`Actions of ${entity.id}`} columns={actionColumns} rows={actionRows} onSort={() => {}} empty="No actions yet. An action is a command the server runs on a record, offered by a view's recordActions." />
    </div>
  );
}
