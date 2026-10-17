import type { DocumentError, EntityDocument, Field, FieldValue, Registry, RowAction, TableView, ViewerDocument } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import type { DropTarget, ReorderableRow } from "./drag.js";
import { flatIndex } from "./drag.js";
import { useReportChange } from "./report-change.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { arrowStep, DropIndicator, ReorderGrip, useReorder } from "./reorder.js";
import { builtOf, ConditionBuilder, draftFor } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { asText, choiceField, describeCondition, propertyInput, toolbarStyle } from "./ui.js";
import { ViewerRule } from "./viewer-rule.js";
import { rowActionTargets, setColumnEditableWhen, setColumnVisibleWhen, setRowAction, setRowActionVisibleWhen, addColumn, canQuickFilter, fieldsNotInTable, moveColumn, moveColumnTo, removeColumn, setColumnEditable, setPageSize, setQuickFilter, setTableFilter, setTableSort, setTableTitle, QUICK_FILTER_REASON } from "./views.js";
import type { RowActionContext } from "./views.js";

export interface TableViewEditorProps {
  readonly view: TableView;
  /** The view's entity, for field labels and the fields not shown yet. */
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /**
   * The other documents in the set (table views and their entities), for the
   * row action: it can open any other table. Without it the editor offers no
   * row action, and a table's existing one is kept.
   */
  readonly context?: RowActionContext;
  /** The set's viewer document: with it, each column can be shown and edited only for some viewers, and the row action opened only for some (RFC 0006). */
  readonly viewer?: ViewerDocument;
  /** Receives the edited table with its revision bumped. */
  readonly onSave: (view: TableView) => void;
  /** Called with the document as it is edited, after every edit, undo or redo; a states preview next to the editor follows it. */
  readonly onChange?: (view: TableView) => void;
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
 * and initial sort. A column can be dragged by its grip — the drag shows
 * where it will land — or moved one step with the arrow keys; each move is
 * one undoable patch, and where it lands is announced. A fixed filter, if
 * the table has one, is kept and shown.
 */
export function TableViewEditor({ view, entity, registry, context, viewer, onSave, onChange, onCancel }: TableViewEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<TableView>>(() => startSession(view));
  useReportChange(session.current, onChange);
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [settings, setSettings] = useState<Settings>(() => settingsOf(view));
  const [adding, setAdding] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");
  const { Table, Button, Section, ErrorSummary } = registry.layout;
  const current = session.current;

  const label = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const byLabel = (ids: readonly string[], v: FieldValue | undefined) => ids.find((id) => label(id) === v);
  const announce = (message: string) => {
    setProblems([]);
    setStatus(message);
  };

  const run = (result: Result, onOk?: () => void): boolean => {
    if (!Array.isArray(result) && !result.ok) return setProblems([result.error]), false;
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return onOk?.(), true;
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length === 0) onOk?.();
    return next.rejected.length === 0;
  };

  /** Applies a patch through the session and reports it in the status line. */
  const applyAndAnnounce = (patch: PatchOperation[], message: (doc: TableView) => string): void => {
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length > 0) return announce(`Not moved: ${next.rejected[0]?.message ?? "invalid table"}.`);
    announce(message(next.current));
  };

  /** A one-step move of a column from the keyboard, announced. */
  const keyMoveColumn = (fieldId: string, step: -1 | 1) => {
    const result = moveColumn(current, fieldId, step);
    if (!Array.isArray(result) && !result.ok) return announce(`Not moved: ${result.error.message}`);
    const patch = Array.isArray(result) ? result : result.patch;
    applyAndAnnounce(patch, (doc) => `${label(fieldId)} moved ${step < 0 ? "left" : "right"} to position ${doc.columns.findIndex((c) => c.field === fieldId) + 1}.`);
  };

  /** A drag drop of a column: one validated patch, so one Undo reverts it. */
  const dropColumn = (fieldId: string, target: DropTarget) => {
    const result = moveColumnTo(current, fieldId, target.index);
    if (!Array.isArray(result) && !result.ok) return announce(`Not moved: ${result.error.message}`);
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return; // a no-op drop: no undo step, nothing to say
    applyAndAnnounce(patch, (doc) => `${label(fieldId)} moved to position ${doc.columns.findIndex((c) => c.field === fieldId) + 1}.`);
  };

  // Drag geometry over the laid-out DOM: the columns are a flat list of
  // rows in the editor's table; a row's element is the closest <tr> of its
  // first cell's marker.
  const columnRows = (): readonly ReorderableRow[] => {
    const rows: ReorderableRow[] = [];
    for (const column of current.columns) {
      const marker = document.querySelector<HTMLElement>(`[data-yadad-column-row="${column.field}"]`);
      const el = (marker?.closest("tr") as HTMLElement | null) ?? marker ?? undefined;
      if (el) rows.push({ id: column.field, sectionId: "", el });
    }
    return rows;
  };
  const columnDrag = useReorder((y, id) => ({ sectionId: "", index: flatIndex(columnRows(), y, id) }), dropColumn);

  // Where the indicator sits: inside the cell of the column row the dragged
  // one will precede, or after the table at the end.
  const columnOthers = current.columns.filter((c) => c.field !== columnDrag.active);
  const columnIndicatorBefore = (field: string): boolean => columnDrag.target !== undefined && columnOthers.findIndex((c) => c.field === field) === columnDrag.target.index;
  const columnIndicatorAfterTable = columnDrag.target !== undefined && columnDrag.target.index >= columnOthers.length;

  // Title, page size and sort apply together, as one undoable edit.
  const applySettings = () =>
    run([
      ...setTableTitle(current, settings.title),
      ...setPageSize(current, settings.pageSize),
      ...setTableSort(current, settings.sortField ? { field: settings.sortField, dir: settings.sortDir } : undefined),
    ]);

  // A reference holds a record id, which says nothing about order, so it is not offered as a sort key.
  const entityIds = entity.fields.filter((f) => f.type !== "reference").map((f) => f.id);
  const missing = fieldsNotInTable(entity, current);
  const addChoice = adding && missing.includes(adding) ? adding : missing[0];
  const filtered = new Set(current.quickFilters?.map((f) => f.field));
  const fieldType = (id: string) => entity.fields.find((f) => f.id === id)?.type;

  const columns = ["Column", "Edit in place", "Quick filter", ...(viewer ? ["Viewers"] : []), "Actions"].map((name) => ({ id: name.toLowerCase().replace(/ /g, "_"), headerId: `${base}-col-${name}`, label: name, sortable: false }));
  const rows = current.columns.map((column, i) => {
    const name = label(column.field);
    const editable = column.editable === true;
    const quick = filtered.has(column.field);
    // Select and boolean match exactly, text by substring, number and date as a from/to range.
    const canFilter = canQuickFilter(fieldType(column.field));
    return {
      id: column.field,
      cells: [
        <span key="column" data-yadad-column-row={column.field} style={{ display: "flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
          {columnIndicatorBefore(column.field) && <DropIndicator />}
          <ReorderGrip
            label={`Drag the column ${name}`}
            dragging={columnDrag.active === column.field}
            onPointerDown={(e) => columnDrag.start(e, column.field)}
            onPointerMove={columnDrag.move}
            onPointerUp={columnDrag.drop}
            onPointerCancel={columnDrag.cancel}
            onKeyDown={(e) => {
              const step = arrowStep(e);
              if (step === 0) return;
              e.preventDefault();
              keyMoveColumn(column.field, step);
            }}
          />
          {name}
        </span>,
        editable ? "Yes" : "No",
        quick ? "Yes" : canFilter ? "No" : <span key="quick" title={QUICK_FILTER_REASON}>Not available. {QUICK_FILTER_REASON}</span>,
        ...(viewer
          ? [
              <span key="viewers">
                <ViewerRule registry={registry} viewer={viewer} rule="Show" target={name} condition={column.visibleWhen} otherwise="Shown to everyone" onSet={(c) => run(setColumnVisibleWhen(current, column.field, c), () => announce(`${name}: ${c === undefined ? "shown to everyone" : "shown by a viewer condition"}.`))} />
                {editable && <ViewerRule registry={registry} viewer={viewer} rule="Allow editing" target={name} condition={column.editableWhen} otherwise="Editable for everyone who may edit" onSet={(c) => run(setColumnEditableWhen(current, column.field, c), () => announce(`${name}: editing ${c === undefined ? "for everyone" : "limited by a viewer condition"}.`))} />}
              </span>,
            ]
          : []),
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

  // The fixed filter ("rows always match"), edited in place with the condition
  // builder; any field of the entity may appear in it, the table's own columns
  // included. Deeper conditions stay intact in words and are replaced, never
  // edited half-way.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<ConditionDraft | undefined>(undefined);
  const openFilter = () => {
    setFilterOpen(true);
    setFilterDraft(draftFor(entity, current.filter));
  };
  const sameFilter = JSON.stringify(builtOf(filterDraft)) === JSON.stringify(current.filter);
  const applyFilter = () => {
    const built = builtOf(filterDraft);
    if (sameFilter) return;
    run(setTableFilter(current, built), () => {
      setFilterOpen(false);
      setFilterDraft(undefined);
      announce(built === undefined ? "Rows always match: cleared." : `Rows always match: ${describeCondition(built, label)}.`);
    });
  };
  const removeFilter = () => {
    run(setTableFilter(current, undefined), () => {
      setFilterOpen(false);
      setFilterDraft(undefined);
      announce("Rows always match: cleared.");
    });
  };

  // The row action ("click a row to open another table, scoped to it"): one
  // target table and one pair of same-typed fields, checked by the validator.
  const targets = context ? rowActionTargets(current, context) : [];
  const targetLabel = (t: TableView) => (t.title ? `${t.title} (${t.id})` : t.id);
  const targetEntity = (t: TableView | undefined) => context?.entities.find((e) => e.id === t?.entity);
  const [rowTarget, setRowTarget] = useState<string | undefined>(undefined);
  const [rowFrom, setRowFrom] = useState<string | undefined>(undefined);
  const [rowTo, setRowTo] = useState<string | undefined>(undefined);
  const pickedTarget = targets.find((t) => t.id === rowTarget) ?? targets[0];
  const pickedFrom = entity.fields.find((f) => f.id === rowFrom) ?? entity.fields[0];
  const sameKind = (a: Field | undefined, b: Field): boolean => a?.type === b.type && (a.type !== "reference" || (b.type === "reference" && a.entity === b.entity));
  const toFields = targetEntity(pickedTarget)?.fields.filter((f) => sameKind(pickedFrom, f)) ?? [];
  const pickedTo = toFields.find((f) => f.id === rowTo) ?? toFields[0];
  const action = current.rowAction;
  const describeAction = (a: RowAction): string => {
    const t = context?.tables.find((x) => x.id === a.open);
    const te = targetEntity(t);
    const pairs = a.bind.map((b) => `${label(b.field)} to ${te?.fields.find((f) => f.id === b.to)?.label ?? b.to}`);
    return `Clicking a row opens ${t ? targetLabel(t) : a.open}, matching ${pairs.join(", ")}.`;
  };
  const applyRowAction = () => {
    if (!pickedTarget || !pickedFrom || !pickedTo) return;
    run(setRowAction(current, entity, context ?? { tables: [], entities: [] }, { open: pickedTarget.id, bind: [{ field: pickedFrom.id, to: pickedTo.id }], mode: "replace" }), () =>
      announce(`Row action set: opens ${targetLabel(pickedTarget)}.`),
    );
  };

  return (
    <div data-yadad-table-editor={view.id}>
      <p id={`${base}-help`}>Drag a column by its grip to reorder it; with the keyboard, focus a grip and use the arrow keys (Left back, Right forward). Esc cancels a drag. The Move buttons step one place.</p>
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
        {current.filter ? (
          <p>
            Rows always match: {describeCondition(current.filter, label)}.
            <Button label="Edit rows always match" type="button" variant="secondary" disabled={false} onPress={openFilter} />
          </p>
        ) : (
          <p>
            Rows always match: none.
            <Button label="Set rows always match" type="button" variant="secondary" disabled={false} onPress={openFilter} />
          </p>
        )}
        {filterOpen && (
          <div data-yadad-filter-builder="" style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
            <ConditionBuilder
              id={`${base}-filter`}
              label="rows always match"
              registry={registry}
              entity={entity}
              draft={filterDraft}
              onChange={setFilterDraft}
              current={current.filter}
              onReplace={() => setFilterDraft(draftFor(entity, undefined))}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
              <Button label="Apply rows always match" type="button" variant="primary" disabled={builtOf(filterDraft) === undefined || sameFilter} onPress={applyFilter} />
              {current.filter !== undefined && <Button label="Remove rows always match" type="button" variant="secondary" disabled={false} onPress={removeFilter} />}
              <Button label="Cancel rows always match" type="button" variant="secondary" disabled={false} onPress={() => setFilterOpen(false)} />
            </div>
          </div>
        )}
      </Section>
      {context && (
        <Section id={`${base}-row-action`} title="Row action">
          {action ? <p>{describeAction(action)}</p> : <p>Clicking a row does nothing.</p>}
          {action && viewer && <ViewerRule registry={registry} viewer={viewer} rule="Open rows" target="row action" condition={action.visibleWhen} otherwise="Rows open for everyone" onSet={(c) => run(setRowActionVisibleWhen(current, c), () => announce("Row action: updated who it opens for."))} />}
          {targets.length === 0 ? (
            <p>There is no other table view to open.</p>
          ) : (
            <div data-yadad-editor-toolbar="" style={toolbarStyle}>
              {propertyInput(registry, `${base}-ra-open`, choiceField("row_action_open", "Open table", targets.map(targetLabel)), pickedTarget ? targetLabel(pickedTarget) : undefined, (v) => {
                setRowTarget(targets.find((t) => targetLabel(t) === v)?.id);
                setRowTo(undefined);
              })}
              {propertyInput(registry, `${base}-ra-from`, choiceField("row_action_from", "Match this field", entityIds.map(label)), pickedFrom ? label(pickedFrom.id) : undefined, (v) => {
                setRowFrom(byLabel(entityIds, v));
                setRowTo(undefined);
              })}
              {toFields.length === 0 ? (
                <p>{`${pickedTarget ? targetLabel(pickedTarget) : "The target"} has no ${pickedFrom?.type ?? "matching"} field to match.`}</p>
              ) : (
                propertyInput(registry, `${base}-ra-to`, choiceField("row_action_to", "With this field of the target", toFields.map((f) => f.label)), pickedTo?.label, (v) => setRowTo(toFields.find((f) => f.label === v)?.id))
              )}
              <Button label="Set row action" type="button" variant="secondary" disabled={!pickedTarget || !pickedFrom || !pickedTo} onPress={applyRowAction} />
              {action && <Button label="Remove row action" type="button" variant="secondary" disabled={false} onPress={() => run(setRowAction(current, entity, context, undefined), () => announce("Row action removed."))} />}
            </div>
          )}
        </Section>
      )}
      <Section id={`${base}-columns`} title="Columns">
        {missing.length > 0 && (
          <div data-yadad-editor-toolbar="" style={toolbarStyle}>
            <p>Not shown yet: {missing.map(label).join(", ")}.</p>
            {propertyInput(registry, `${base}-add`, choiceField("add_column", "Column to add", missing.map(label)), addChoice ? label(addChoice) : undefined, (v) => setAdding(byLabel(missing, v)))}
            <Button label="Add column" type="button" variant="primary" disabled={!addChoice} onPress={() => addChoice && run(addColumn(current, addChoice), () => setAdding(undefined))} />
          </div>
        )}
        <Table caption={`Columns of ${current.title ?? current.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No columns." />
        {columnIndicatorAfterTable && <DropIndicator />}
      </Section>
      <p aria-live="polite" data-yadad-editor-status="">
        {status}
      </p>
    </div>
  );
}
