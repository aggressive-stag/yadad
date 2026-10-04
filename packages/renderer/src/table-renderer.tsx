import { jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, EntityDocument, Field, FieldValue, Registry, SortSpec, TableColumnHeader, TableRow, TableView } from "@yadad/core";
import { emptyFormState, setFieldValue, submitEdit } from "@yadad/runtime";
import type { FormState } from "@yadad/runtime";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { checkViewSetup, ErrorList } from "./errors";
import { renderDisplay, renderInput } from "./fields";

export interface TableRendererProps {
  readonly entity: EntityDocument;
  readonly view: TableView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  /** Change this to reload rows, e.g. after a form saves a record. */
  readonly reloadKey?: unknown;
}

const DEFAULT_PAGE_SIZE = 25;
/** Not a valid field id (they start with a letter), so it can never collide with one. */
const ACTIONS_COLUMN = "_actions";

interface Editing {
  readonly record: DataRecord;
  readonly state: FormState;
}

type Rows = { readonly status: "loading" } | { readonly status: "loaded"; readonly items: readonly DataRecord[]; readonly total: number } | { readonly status: "failed"; readonly message: string };

/**
 * Renders a table view: rows from the data adapter, sortable column headers,
 * paging, and in-place editing of the columns the view marks editable. The
 * table chrome, cells, editors and buttons all come from the registry.
 */
export function TableRenderer({ entity, view, registry, dataSources, reloadKey }: TableRendererProps): ReactNode {
  const tableId = useId();
  const [sort, setSort] = useState<readonly SortSpec[]>(view.sort ?? []);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Rows>({ status: "loading" });
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [reloads, setReloads] = useState(0);

  const adapter = dataSources.get(view.dataSource);
  const pageSize = view.pageSize ?? DEFAULT_PAGE_SIZE;

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    adapter.find(entity.id, { sort, page: { offset: page * pageSize, limit: pageSize } }).then(
      (result) => current && setRows({ status: "loaded", items: result.items, total: result.total }),
      (error: unknown) => current && setRows({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [adapter, entity.id, sort, page, pageSize, reloadKey, reloads]);

  const refs = [
    ...view.columns.map((c, i) => ({ field: c.field, path: ["columns", i, "field"] })),
    ...(view.sort ?? []).map((s, i) => ({ field: s.field, path: ["sort", i, "field"] })),
  ];
  const setupErrors = checkViewSetup(entity, view, adapter, refs);
  if (setupErrors.length > 0) return <ErrorList errors={setupErrors} />;

  const { Table, Button } = registry.layout;
  const columns = view.columns.flatMap((c) => {
    const field = entity.fields.find((f) => f.id === c.field);
    return field ? [{ field, editable: c.editable === true }] : [];
  });
  const hasActions = columns.some((c) => c.editable);
  const headerId = (columnId: string) => `${tableId}-col-${columnId}`;
  const editErrorsId = `${tableId}-edit-errors`;

  const headers: TableColumnHeader[] = [
    ...columns.map(({ field }) => {
      const active = sort[0]?.field === field.id ? { sort: sort[0].dir } : {};
      return { id: field.id, headerId: headerId(field.id), label: field.label, sortable: true, ...active };
    }),
    ...(hasActions ? [{ id: ACTIONS_COLUMN, headerId: headerId(ACTIONS_COLUMN), label: "Actions", sortable: false }] : []),
  ];

  /** First click sorts ascending; clicking the sorted column again flips it. */
  const onSort = (columnId: string): void => {
    const dir = sort[0]?.field === columnId && sort[0].dir === "asc" ? "desc" : "asc";
    setSort([{ field: columnId, dir }]);
    setPage(0);
  };

  async function saveEdit(): Promise<void> {
    if (!adapter || !editing || saving) return;
    setSaving(true);
    const result = await submitEdit(entity, editing.record, editing.state.values, adapter);
    setSaving(false);
    if (result.ok) {
      // Show the saved record right away, then refresh (the sort order may change).
      const saved = result.record;
      setRows((r) => (r.status === "loaded" ? { ...r, items: r.items.map((x) => (x.id === saved.id ? saved : x)) } : r));
      setEditing(undefined);
      setReloads((n) => n + 1);
    } else {
      setEditing({ ...editing, state: { ...editing.state, errors: result.errors } });
    }
  }

  const renderCell = (record: DataRecord, field: Field, editable: boolean): ReactNode => {
    if (!editable || editing?.record.id !== record.id) return renderDisplay(registry, field, record.values[field.id]);
    const state = editing.state;
    const errors = state.errors.filter((e) => e.path === jsonPointer([field.id]));
    const value = field.id in state.values ? state.values[field.id] : record.values[field.id];
    const onChange = (v: FieldValue | undefined) =>
      setEditing((e) => (e ? { ...e, state: setFieldValue(e.state, field.id, v === undefined ? null : v) } : e));
    return renderInput(
      registry,
      field,
      value,
      {
        inputId: `${tableId}-${record.id}-${field.id}`,
        labelledBy: headerId(field.id),
        invalid: errors.length > 0,
        ...(errors.length > 0 ? { describedBy: editErrorsId } : {}),
      },
      onChange,
    );
  };

  const renderActions = (record: DataRecord): ReactNode =>
    editing?.record.id === record.id ? (
      <>
        <Button label="Save" type="button" variant="primary" disabled={saving} onPress={() => void saveEdit()} />
        <Button label="Cancel" type="button" variant="secondary" disabled={saving} onPress={() => setEditing(undefined)} />
      </>
    ) : (
      <Button label="Edit" type="button" variant="secondary" disabled={saving} onPress={() => setEditing({ record, state: emptyFormState })} />
    );

  const items = rows.status === "loaded" ? rows.items : [];
  const tableRows: TableRow<ReactNode>[] = items.map((record) => ({
    id: record.id,
    cells: [...columns.map(({ field, editable }) => renderCell(record, field, editable)), ...(hasActions ? [renderActions(record)] : [])],
  }));
  const total = rows.status === "loaded" ? rows.total : 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const editErrors = editing?.state.errors ?? [];

  return (
    <div data-yadad-table-view={view.id}>
      <Table
        caption={view.title ?? entity.id}
        columns={headers}
        rows={tableRows}
        onSort={onSort}
        empty={rows.status === "loading" ? "Loading…" : rows.status === "failed" ? `Could not load records: ${rows.message}` : "No records yet."}
      />
      {editErrors.length > 0 && <ErrorList id={editErrorsId} errors={editErrors} />}
      {pages > 1 && (
        <nav aria-label={`${view.title ?? entity.id} pages`} data-yadad-pager="">
          <Button label="Previous" type="button" variant="secondary" disabled={page === 0} onPress={() => setPage((p) => p - 1)} />
          <span>
            Page {page + 1} of {pages}
          </span>
          <Button label="Next" type="button" variant="secondary" disabled={page >= pages - 1} onPress={() => setPage((p) => p + 1)} />
        </nav>
      )}
    </div>
  );
}
