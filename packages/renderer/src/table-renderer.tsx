import { conditionFields, jsonPointer } from "@yadad/core";
import type { Condition, DataAdapter, DataRecord, EntityDocument, Field, FieldValue, RecordValues, Registry, SortSpec, TableColumnHeader, TableRow, TableView } from "@yadad/core";
import { emptyFormState, resolveRelativeDates, setFieldValue, submitEdit } from "@yadad/runtime";
import type { FormState } from "@yadad/runtime";
import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { checkViewSetup } from "./setup.js";
import { renderDisplay, renderInput } from "./fields.js";

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
  const [quick, setQuick] = useState<RecordValues>({});

  const adapter = dataSources.get(view.dataSource);
  const pageSize = view.pageSize ?? DEFAULT_PAGE_SIZE;
  const filter = useMemo(() => combineFilters(view, entity, quick), [view, entity, quick]);

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    // Relative dates become fixed ones here, on every load, so adapters never see them and "today" stays today.
    const fixed = filter ? resolveRelativeDates(filter) : undefined;
    adapter.find(entity.id, { sort, page: { offset: page * pageSize, limit: pageSize }, ...(fixed ? { filter: fixed } : {}) }).then(
      (result) => current && setRows({ status: "loaded", items: result.items, total: result.total }),
      (error: unknown) => current && setRows({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [adapter, entity.id, sort, page, pageSize, filter, reloadKey, reloads]);

  // Entering edit mode moves focus to the row's first editable input.
  const editingId = editing?.record.id;
  useEffect(() => {
    if (editingId === undefined) return;
    const first = view.columns.find((c) => c.editable === true);
    if (!first) return;
    document.getElementById(`${tableId}-${editingId}-${first.field}`)?.focus();
  }, [editingId, tableId, view.columns]);

  const refs = [
    ...view.columns.map((c, i) => ({ field: c.field, path: ["columns", i, "field"] })),
    ...(view.sort ?? []).map((s, i) => ({ field: s.field, path: ["sort", i, "field"] })),
    ...(view.filter ? conditionFields(view.filter).map((field) => ({ field, path: ["filter"] })) : []),
    ...(view.quickFilters ?? []).map((f, i) => ({ field: f.field, path: ["quickFilters", i, "field"] })),
  ];
  const setupErrors = checkViewSetup(entity, view, adapter, refs);
  const { Table, Button, ErrorSummary, Section, FieldFrame } = registry.layout;
  if (setupErrors.length > 0) return <ErrorSummary errors={setupErrors} />;

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

  const quickFields = (view.quickFilters ?? []).flatMap((f) => {
    const field = entity.fields.find((x) => x.id === f.field);
    return field ? [field] : [];
  });

  return (
    <div data-yadad-table-view={view.id}>
      {quickFields.length > 0 && (
        <Section id={`${view.id}-filters`} title="Filter">
          {quickFields.map((field) =>
            isRangeFilter(field) ? (
              RANGE_ENDS.map(({ end, word }) => {
                const control = { ...filterControl(field), label: `${field.label} ${word}` };
                const key = rangeKey(end, field.id);
                const inputId = `${tableId}-filter-${field.id}-${end}`;
                return (
                  <FieldFrame key={key} inputId={inputId} errorId={`${inputId}-errors`} label={control.label} required={false} errors={[]}>
                    {renderInput(registry, control, quick[key], { inputId, invalid: false }, (v) => {
                      setQuick((q) => ({ ...q, [key]: v ?? null }));
                      setPage(0);
                    })}
                  </FieldFrame>
                );
              })
            ) : (
              <FieldFrame key={field.id} inputId={`${tableId}-filter-${field.id}`} errorId={`${tableId}-filter-${field.id}-errors`} label={field.label} required={false} errors={[]}>
                {renderInput(registry, filterControl(field), quick[field.id], { inputId: `${tableId}-filter-${field.id}`, invalid: false }, (v) => {
                  setQuick((q) => ({ ...q, [field.id]: v ?? null }));
                  setPage(0);
                })}
              </FieldFrame>
            ),
          )}
        </Section>
      )}
      <Table
        caption={view.title ?? entity.id}
        columns={headers}
        rows={tableRows}
        onSort={onSort}
        empty={rows.status === "loading" ? "Loading…" : rows.status === "failed" ? `Could not load records: ${rows.message}` : filter ? "No records match the filters." : "No records yet."}
      />
      {editErrors.length > 0 && <ErrorSummary id={editErrorsId} errors={editErrors} />}
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

const BOOLEAN_CHOICES = ["Yes", "No"];

/** Number and date fields filter as a from/to range; the other types match one value. */
const isRangeFilter = (field: Field): boolean => field.type === "number" || field.type === "date";

const RANGE_ENDS = [
  { end: "from", word: "from", op: "gte" },
  { end: "to", word: "to", op: "lte" },
] as const;

/** Where a range end is kept among the quick values. A colon can never be in a field id, so it cannot collide with one. */
const rangeKey = (end: "from" | "to", fieldId: string): string => `${end}:${fieldId}`;

/** The control a quick filter shows: the field itself (never required), or Yes/No for a checkbox. */
function filterControl(field: Field): Field {
  if (field.type === "boolean") return { id: field.id, type: "select", label: field.label, options: { source: "static", values: BOOLEAN_CHOICES } };
  return { ...field, required: false };
}

/** The view's fixed filter and every quick filter the viewer has set, combined with "and". */
function combineFilters(view: TableView, entity: EntityDocument, quick: RecordValues): Condition | undefined {
  const parts: Condition[] = view.filter ? [view.filter] : [];
  for (const { field: id } of view.quickFilters ?? []) {
    const field = entity.fields.find((f) => f.id === id);
    if (field && isRangeFilter(field)) {
      // A range filter is a from and a to bound; either end may stay empty.
      for (const { end, op } of RANGE_ENDS) {
        const bound = quick[rangeKey(end, id)];
        if ((field.type === "number" && typeof bound === "number") || (field.type === "date" && typeof bound === "string" && bound !== "")) parts.push({ op, field: id, value: bound });
      }
      continue;
    }
    const value = quick[id];
    if (!field || value === undefined || value === null || value === "") continue;
    // An untouched checkbox is never saved, so "No" also matches a missing value.
    if (field.type === "boolean")
      parts.push(value === "Yes" ? { op: "eq", field: id, value: true } : { op: "or", conditions: [{ op: "eq", field: id, value: false }, { op: "empty", field: id }] });
    else if (field.type === "text" && typeof value === "string") parts.push({ op: "contains", field: id, value });
    else if (typeof value === "string") parts.push({ op: "eq", field: id, value });
  }
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", conditions: parts };
}
