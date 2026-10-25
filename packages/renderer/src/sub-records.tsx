import type { DataAdapter, DataRecord, DocumentError, EntityDocument, RecordActionItem, RecordValues, ReferenceField, Registry, SubRecordSection } from "@yadad/core";
import { canEditField, sortRecords, submitEdit, submitForm } from "@yadad/runtime";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DocumentSet } from "./document-set.js";
import { renderInput } from "./fields.js";
import type { CommonInputProps } from "./fields.js";
import { useReferences } from "./references.js";
import { replaceSavedRecord } from "./saved-record.js";

/**
 * A declared sub-record section (RFC 0009 item 3): the form hosts an inline
 * checklist whose rows are **ordinary records of the child entity**. Each row
 * carries its own id, version and `can`; every write goes through the same
 * adapter verbs the table's inline editor uses — `create` for an added row,
 * `update` for a typed title, `delete` for a removed row, all under
 * `baseVersion`. Nothing here is a field value, and the checklist never opens
 * a dialog: the row being typed stays on screen and keeps focus, the way the
 * table keeps focus after an action, and an added row lands focused.
 */
export interface SubRecordSectionProps {
  readonly entity: EntityDocument;
  /** The declared section: names the child entity, the back-reference and the row's fields. */
  readonly sub: SubRecordSection;
  readonly registry: Registry<ReactNode>;
  readonly adapter: DataAdapter;
  /** The documents of reference targets, by id — the same map the form is given. */
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  readonly documents?: DocumentSet;
  /** Change to reload the rows (the host's own reload signal, added to the renderer's own). */
  readonly reloadKey?: unknown;
  /** The record the rows hang off; a new, unsaved parent has none, and the section waits. */
  readonly parent?: DataRecord;
}

/** The row being edited: its id, the values typed so far, and the errors of the last try. */
interface EditingRow {
  readonly id: string;
  readonly values: RecordValues;
  readonly errors: readonly DocumentError[];
}

export function SubRecordChecklist({ entity, sub, registry, adapter, entities, documents, reloadKey, parent }: SubRecordSectionProps): ReactNode {
  const uid = useId();
  const refEntities = entities ?? documents?.entities;
  const { Table, Button, ErrorSummary } = registry.layout;
  const [rows, setRows] = useState<readonly DataRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<RecordValues>({});
  const [draftErrors, setDraftErrors] = useState<readonly DocumentError[]>([]);
  const [editing, setEditing] = useState<EditingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<{ readonly seq: number; readonly text: string } | undefined>(undefined);
  // The row whose input takes focus when it next renders: an added row lands
  // focused, and a row that starts editing takes focus like the table does.
  const focusRow = useRef<string | undefined>(undefined);

  const child = refEntities?.get(sub.entity);
  const viaField = child?.fields.find((f): f is ReferenceField => f.type === "reference" && f.id === sub.via);
  const titleField = child?.fields.find((f) => f.id === sub.titleField && f.type === "text");
  const doneField = child?.fields.find((f) => f.id === sub.doneField && f.type === "boolean");
  const orderField = sub.orderField === undefined ? undefined : child?.fields.find((f) => f.id === sub.orderField && f.type === "number");

  const references = useReferences(adapter, refEntities, viaField ? [viaField] : [], []);
  const announce = useCallback((text: string): void => setAnnouncement((a) => ({ seq: (a?.seq ?? 0) + 1, text })), []);

  // One load per parent: the rows are the child records whose `via` names it,
  // in `orderField` order — the same filter the server scopes by.
  useEffect(() => {
    if (!child || !viaField || !parent) {
      setStatus("loaded");
      setRows([]);
      return;
    }
    let live = true;
    setStatus("loading");
    void adapter
      .find(child.id, { filter: { op: "eq", field: viaField.id, value: parent.id } })
      .then((page) => {
        if (!live) return;
        setRows(orderField === undefined ? page.items : sortRecords(page.items, [{ field: orderField.id, dir: "asc" }]));
        setStatus("loaded");
      })
      .catch((error: unknown) => {
        if (!live) return;
        setFailure(error instanceof Error ? error.message : String(error));
        setStatus("failed");
      });
    return () => {
      live = false;
    };
  }, [adapter, child, viaField, parent, orderField, reloadKey]);

  // An added row or a row that entered editing gets its input focused once,
  // the same rule the table follows for the field it starts editing.
  useEffect(() => {
    const rowId = focusRow.current;
    if (rowId === undefined) return;
    focusRow.current = undefined;
    document.getElementById(`${uid}-${rowId}-${sub.titleField}`)?.focus();
  });

  const settle = useCallback((saved: DataRecord, added: boolean): void => {
    setRows((r) => (added ? [...r, saved] : replaceSavedRecord(r, saved.id, saved)));
  }, []);

  const refuse = useCallback((errors: readonly DocumentError[]): void => {
    announce(errors.map((e) => e.message).join(" ") || "The write was refused.");
  }, [announce]);

  const titleOf = (row: DataRecord): string => {
    const value = row.values[sub.titleField];
    return typeof value === "string" && value !== "" ? value : "(untitled)";
  };

  async function addRow(): Promise<void> {
    if (!child || !viaField || !parent || busy) return;
    setBusy(true);
    const values: RecordValues = { ...draft, [viaField.id]: parent.id };
    const result = await submitForm(child, values, adapter);
    setBusy(false);
    if (result.ok) {
      // An added row lands focused (RFC 0009 item 3): it opens in edit mode with
      // what was typed, and its input takes focus the way the table's does.
      focusRow.current = result.record.id;
      setEditing({ id: result.record.id, values: {}, errors: [] });
      settle(result.record, true);
      setDraft({});
      setDraftErrors([]);
      announce(`Added ${titleOf(result.record)}.`);
    } else {
      setDraftErrors(result.errors);
      refuse(result.errors);
    }
  }

  async function saveRow(row: DataRecord): Promise<void> {
    if (!child || busy || editing === null || editing.id !== row.id) return;
    setBusy(true);
    const result = await submitEdit(child, row, editing.values, adapter);
    setBusy(false);
    if (result.ok) {
      setEditing(null);
      settle(result.record, false);
      announce(`Saved ${titleOf(result.record)}.`);
    } else {
      setEditing({ ...editing, errors: result.errors });
      refuse(result.errors);
    }
  }

  async function toggleDone(row: DataRecord): Promise<void> {
    if (!child || !doneField || busy) return;
    setBusy(true);
    const result = await submitEdit(child, row, { [doneField.id]: row.values[doneField.id] !== true }, adapter);
    setBusy(false);
    if (result.ok) {
      settle(result.record, false);
      announce(`${titleOf(result.record)}: ${result.record.values[doneField.id] === true ? "done" : "not done"}.`);
    } else {
      refuse(result.errors);
    }
  }

  async function removeRow(row: DataRecord): Promise<void> {
    if (!child || busy) return;
    setBusy(true);
    try {
      await adapter.delete(child.id, row.id, { entityRevision: child.revision, baseVersion: row.version });
      setRows((r) => r.filter((x) => x.id !== row.id));
      announce(`Removed ${titleOf(row)}.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!child) {
    return <ErrorSummary errors={[{ path: "/subRecords/entity", code: "invalid-value", message: `Sub-record entity "${sub.entity}" was not given to this form.`, hint: "Pass the child entity in `entities` (or the set in `documents`)." }]} />;
  }
  const problems = setupProblems(child, sub, entity);
  if (problems.length > 0) return <ErrorSummary errors={problems} />;
  if (!parent) return <p data-yadad-sub-records={sub.entity}>Save the {entity.id} first, then add its rows.</p>;

  const cells = (row: DataRecord): readonly ReactNode[] => {
    const inEdit = editing !== null && editing.id === row.id;
    const editable = canEditField(row, sub.titleField);
    const inputId = `${uid}-${row.id}-${sub.titleField}`;
    const errorId = `${inputId}-errors`;
    const titleErrors = inEdit && titleField ? editing.errors.filter((e) => e.path === `/${sub.titleField}`) : [];
    // The row's inputs are labelled by the column headers, the table's own pattern.
    const common: CommonInputProps = { inputId, invalid: titleErrors.length > 0, labelledBy: `${uid}-col-title`, ...(titleErrors.length > 0 ? { describedBy: errorId } : {}) };
    const title = titleField === undefined ? null : inEdit && titleField
      ? renderInput(registry, titleField, editing.values[sub.titleField], common, (v) => setEditing({ ...editing, values: { ...editing.values, [sub.titleField]: v ?? null }, errors: [] }), references)
      : editable
        ? <button type="button" data-yadad-sub-record-edit={row.id} onClick={() => { focusRow.current = row.id; setEditing({ id: row.id, values: {}, errors: [] }); }}>{titleOf(row)}</button>
        : <span>{titleOf(row)}</span>;
    const done = doneField === undefined ? null : renderInput(registry, doneField, row.values[doneField.id], { inputId: `${uid}-${row.id}-${doneField.id}`, invalid: false, labelledBy: `${uid}-col-done` }, () => void toggleDone(row), references);
    return [done, title, ...(titleErrors.length > 0 ? [<span key="err" role="alert" id={errorId}>{titleErrors.map((e) => e.message).join(" ")}</span>] : [])];
  };

  const actionsFor = (row: DataRecord): readonly RecordActionItem[] | undefined => {
    const inEdit = editing !== null && editing.id === row.id;
    if (inEdit) {
      return [
        { id: "save", label: "Save", tone: "neutral", pending: busy, onPress: () => void saveRow(row) },
        { id: "cancel", label: "Cancel", tone: "neutral", pending: false, onPress: () => setEditing(null) },
      ];
    }
    return canEditField(row, sub.titleField)
      ? [{ id: "remove", label: "Remove", tone: "danger", pending: busy, onPress: () => void removeRow(row) }]
      : undefined;
  };

  const draftValue = draft[sub.titleField];
  return (
    <div data-yadad-sub-records={sub.entity}>
      {announcement !== undefined && <p role="status" data-yadad-sub-records-status="">{announcement.text}</p>}
      {status === "failed" && <ErrorSummary errors={[{ path: "", code: "type", message: failure ?? "The rows could not be loaded.", hint: "Retry." }]} />}
      {draftErrors.length > 0 && <ErrorSummary errors={draftErrors} />}
      <Table
        caption={`${child.id} rows`}
        columns={[
          { id: doneField?.id ?? "done", headerId: `${uid}-col-done`, label: doneField?.label ?? "Done", sortable: false },
          { id: sub.titleField, headerId: `${uid}-col-title`, label: titleField?.label ?? "Title", sortable: false },
        ]}
        rows={rows.map((row) => {
          const actions = actionsFor(row);
          return { id: row.id, cells: cells(row), ...(actions !== undefined ? { actions } : {}) };
        })}
        onSort={() => undefined}
        empty={<span>No rows yet.</span>}
        {...(rows.some((r) => actionsFor(r) !== undefined) ? { actionsLabel: "Actions" } : {})}
      />
      <div data-yadad-sub-record-add="">
        {titleField !== undefined && (
          <input
            id={`${uid}-new-${sub.titleField}`}
            data-testid={`sub-record-input-${sub.entity}`}
            type="text"
            value={typeof draftValue === "string" ? draftValue : ""}
            disabled={busy}
            placeholder={titleField.label}
            aria-label={titleField.label}
            onChange={(e) => setDraft(e.target.value === "" ? Object.fromEntries(Object.entries(draft).filter(([k]) => k !== sub.titleField)) : { ...draft, [sub.titleField]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addRow();
              }
            }}
          />
        )}
        <Button label={sub.addLabel ?? `Add ${child.id}`} type="button" variant="secondary" disabled={busy} onPress={() => void addRow()} />
      </div>
    </div>
  );
}

/** The render-blocking problems with a declared section's field names (the set validator checks the rest). */
function setupProblems(child: EntityDocument, sub: SubRecordSection, parentEntity: EntityDocument): DocumentError[] {
  const errors: DocumentError[] = [];
  const via = child.fields.find((f) => f.id === sub.via);
  if (!via || via.type !== "reference") errors.push({ path: "/subRecords/via", code: "invalid-value", message: `Field "${sub.via}" on "${child.id}" is not a reference field.`, hint: "Name the reference that points back at the form's entity." });
  else if (via.entity !== parentEntity.id) errors.push({ path: "/subRecords/via", code: "invalid-value", message: `Reference "${sub.via}" on "${child.id}" points at "${via.entity}", not at "${parentEntity.id}".`, hint: "The back-reference is what scopes the rows." });
  const title = child.fields.find((f) => f.id === sub.titleField);
  if (!title || title.type !== "text") errors.push({ path: "/subRecords/titleField", code: "invalid-value", message: `Field "${sub.titleField}" on "${child.id}" is not a text field.`, hint: "The row's input edits a text field." });
  const done = child.fields.find((f) => f.id === sub.doneField);
  if (!done || done.type !== "boolean") errors.push({ path: "/subRecords/doneField", code: "invalid-value", message: `Field "${sub.doneField}" on "${child.id}" is not a boolean field.`, hint: "The row's checkbox needs a boolean field." });
  return errors;
}
