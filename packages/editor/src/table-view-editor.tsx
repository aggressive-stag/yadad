import type { DocumentError, EntityDocument, FieldValue, Registry, TableView } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { asText, choiceField, describeCondition, propertyInput, toolbarStyle } from "./ui.js";
import { addColumn, fieldsNotInTable, moveColumn, removeColumn, setColumnEditable, setPageSize, setQuickFilter, setTableSort, setTableTitle } from "./views.js";

export interface TableViewEditorProps {
  readonly view: TableView;
  /** The view's entity, for field labels and the fields not shown yet. */
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /** Receives the edited table with its revision bumped. */
  readonly onSave: (view: TableView) => void;
  readonly onCancel: () => void;
}

type Result = PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

const NO_SORT = "(none)";
const DIRECTIONS = { Ascending: "asc", Descending: "desc" } as const;
type DirectionLabel = keyof typeof DIRECTIONS;

interface Settings {
  readonly title: string;
  readonly pageSize: number | undefined;
  readonly sortField: string | undefined;
  readonly sortDir: "asc" | "desc";
}

const settingsOf = (view: TableView): Settings => ({
  title: view.title ?? "",
  pageSize: view.pageSize,
  sortField: view.sort?.[0]?.field,
  sortDir: view.sort?.[0]?.dir ?? "asc",
});

/**
 * Sets up a table: choose and order its columns, which ones rows can edit in
 * place, which fields viewers can quick-filter on, and its title, page size
 * and initial sort. A fixed filter, if the table has one, is kept and shown.
 */
export function TableViewEditor({ view, entity, registry, onSave, onCancel }: TableViewEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<TableView>>(() => startSession(view));
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [settings, setSettings] = useState<Settings>(() => settingsOf(view));
  const [adding, setAdding] = useState<string | undefined>(undefined);
  const { Table, Button, Section, ErrorSummary } = registry.layout;
  const current = session.current;

  const label = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const byLabel = (ids: readonly string[], v: FieldValue | undefined) => ids.find((id) => label(id) === v);

  const run = (result: Result, onOk?: () => void) => {
    if (!Array.isArray(result) && !result.ok) return setProblems([result.error]);
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return onOk?.();
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length === 0) onOk?.();
  };

  // Title, page size and sort apply together, as one undoable edit.
  const applySettings = () =>
    run([
      ...setTableTitle(current, settings.title),
      ...setPageSize(current, settings.pageSize),
      ...setTableSort(current, settings.sortField ? { field: settings.sortField, dir: settings.sortDir } : undefined),
    ]);

  const entityIds = entity.fields.map((f) => f.id);
  const missing = fieldsNotInTable(entity, current);
  const addChoice = adding && missing.includes(adding) ? adding : missing[0];
  const filtered = new Set(current.filters?.map((f) => f.field));
  const fieldType = (id: string) => entity.fields.find((f) => f.id === id)?.type;

  const columns = ["Column", "Edit in place", "Quick filter", "Actions"].map((name) => ({ id: name.toLowerCase().replace(/ /g, "_"), headerId: `${base}-col-${name}`, label: name, sortable: false }));
  const rows = current.columns.map((column, i) => {
    const name = label(column.field);
    const editable = column.editable === true;
    const quick = filtered.has(column.field);
    // Quick filters match select and boolean fields exactly and text by substring.
    const canFilter = ["select", "boolean", "text"].includes(fieldType(column.field) ?? "");
    return {
      id: column.field,
      cells: [
        name,
        editable ? "Yes" : "No",
        quick ? "Yes" : canFilter ? "No" : "Not available",
        <span key="actions" style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <Button label={`Move ${name} left`} type="button" variant="secondary" disabled={i === 0} onPress={() => run(moveColumn(current, column.field, -1))} />
          <Button label={`Move ${name} right`} type="button" variant="secondary" disabled={i === current.columns.length - 1} onPress={() => run(moveColumn(current, column.field, 1))} />
          <Button label={editable ? `Make ${name} read-only` : `Make ${name} editable`} type="button" variant="secondary" disabled={false} onPress={() => run(setColumnEditable(current, column.field, !editable))} />
          {(canFilter || quick) && (
            <Button label={quick ? `Remove ${name} filter` : `Filter by ${name}`} type="button" variant="secondary" disabled={false} onPress={() => run(setQuickFilter(current, column.field, !quick))} />
          )}
          <Button label={`Remove ${name}`} type="button" variant="secondary" disabled={current.columns.length === 1} onPress={() => run(removeColumn(current, column.field))} />
        </span>,
      ],
    };
  });

  const sortPicker = choiceField("sort_field", "Sort by", [NO_SORT, ...entityIds.map(label)]);
  const dirPicker = choiceField("sort_dir", "Direction", Object.keys(DIRECTIONS));
  const dirLabel = (Object.keys(DIRECTIONS) as DirectionLabel[]).find((k) => DIRECTIONS[k] === settings.sortDir);

  return (
    <div data-yadad-table-editor={view.id}>
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save table" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {problems.length > 0 && <ErrorSummary errors={problems} />}
      <Section id={`${base}-settings`} title="Table settings">
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {propertyInput(registry, `${base}-title`, { id: "title", type: "text", label: "Title" }, settings.title, (v) => setSettings((s) => ({ ...s, title: asText(v) })))}
          {propertyInput(registry, `${base}-page`, { id: "page_size", type: "number", label: "Rows per page", min: 1, max: 1000, step: 1 }, settings.pageSize, (v) =>
            setSettings((s) => ({ ...s, pageSize: typeof v === "number" ? v : undefined })),
          )}
          {propertyInput(registry, `${base}-sort`, sortPicker, settings.sortField ? label(settings.sortField) : NO_SORT, (v) => setSettings((s) => ({ ...s, sortField: byLabel(entityIds, v) })))}
          {settings.sortField &&
            propertyInput(registry, `${base}-dir`, dirPicker, dirLabel, (v) => {
              const key = (Object.keys(DIRECTIONS) as DirectionLabel[]).find((k) => k === v);
              setSettings((s) => ({ ...s, sortDir: key ? DIRECTIONS[key] : "asc" }));
            })}
          <Button label="Apply settings" type="button" variant="secondary" disabled={false} onPress={applySettings} />
        </div>
        {current.filter && <p>Rows always match: {describeCondition(current.filter, label)}.</p>}
      </Section>
      <Section id={`${base}-columns`} title="Columns">
        {missing.length > 0 && (
          <div data-yadad-editor-toolbar="" style={toolbarStyle}>
            <p>Not shown yet: {missing.map(label).join(", ")}.</p>
            {propertyInput(registry, `${base}-add`, choiceField("add_column", "Column to add", missing.map(label)), addChoice ? label(addChoice) : undefined, (v) => setAdding(byLabel(missing, v)))}
            <Button label="Add column" type="button" variant="primary" disabled={!addChoice} onPress={() => addChoice && run(addColumn(current, addChoice), () => setAdding(undefined))} />
          </div>
        )}
        <Table caption={`Columns of ${current.title ?? current.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No columns." />
      </Section>
    </div>
  );
}
