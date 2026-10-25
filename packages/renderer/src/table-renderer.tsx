import { MAX_ROW_ACTION_DEPTH, conditionFields, jsonPointer } from "@yadad/core";
import type { Condition, DataAdapter, DataRecord, DocumentError, EntityDocument, Field, FieldValue, RecordValues, ReferenceField, Registry, ResolvedViewer, SortSpec, TableColumnHeader, TableRow, TableView } from "@yadad/core";
import { bindFilter, canEditField, canUpdate, columnEditable, compareCells, emptyFormState, neighbourQuery, resolveRelativeDates, restoreDraft, rowActionVisible, setFieldValue, submitEdit, visibleColumns } from "@yadad/runtime";
import type { CompareCell, CompareEdge, DraftStore, FormState, RestoredDraft } from "@yadad/runtime";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FormRenderer } from "./form-renderer.js";
import { loadFailure } from "./load-state.js";
import type { DocumentSet } from "./document-set.js";
import { checkViewSetup } from "./setup.js";
import { instantRangeBounds, localToInstant, LOCAL_DATETIME_PATTERN } from "@yadad/runtime";
import { renderDisplay, renderInput } from "./fields.js";
import type { FieldFormatting } from "./fields.js";
import { useReferences } from "./references.js";
import { useViewerSetup } from "./viewer.js";
import { recordActionSetupErrors, useRecordActions } from "./record-actions.js";
import { replaceSavedRecord } from "./saved-record.js";

export interface TableRendererProps {
  readonly entity: EntityDocument;
  readonly view: TableView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  /**
   * The documents of the target entities of the entity's reference fields,
   * by id. Labels and picker options are loaded from the table's own data source.
   */
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  /** Change this to reload rows, e.g. after a form saves a record. */
  readonly reloadKey?: unknown;
  /**
   * The other documents in the set. Needed when the view has a `rowAction`: the
   * target table and its entity are looked up here.
   */
  readonly documents?: DocumentSet;
  /**
   * Who is viewing (RFC 0006), from `resolveViewer`. Columns, in-place editing
   * and the row action the viewer may not use are not offered. Without it, a
   * renderer with `documents` uses the viewer document's defaults; a table that
   * reads a viewer fact and cannot find the document shows an error.
   */
  readonly viewer?: ResolvedViewer;
  /** The viewer's locale and zone for datetime fields (RFC 0007); absent, the environment's. */
  readonly formatting?: FieldFormatting;
  /**
   * Called once after each **successful user-initiated write** made inside this
   * renderer: an in-place edit, a record action. Never on load or reload. A
   * dashboard passes it to every widget in a cell so the others (counts, stats)
   * can refresh — a reload does not call it, so passing a bump down cannot loop.
   */
  readonly onChanged?: () => void;
  /**
   * Opt-in drafts for in-place edits, the same shape and meaning as the
   * form's: unsaved input in an open row edit is kept in the store
   * (debounced, default 400 ms) under the view id and the record id, and
   * restored when that row's edit is opened again, until it is saved or
   * cancelled. A refused save keeps the draft.
   */
  readonly drafts?: { readonly store: DraftStore; readonly debounceMs?: number };
  /**
   * Which named saved filter (RFC 0009 item 5) is lit: one of the view's
   * `filters` ids. The renderer never stores it — the host owns which chip is
   * pressed and persists that choice; this is query shape joined to the query.
   * Its condition is ANDed with the view's fixed filter and the quick filters.
   */
  readonly savedFilter?: string;
  /** Called with the chip's id, or undefined when the lit chip is pressed again. */
  readonly onSavedFilterChange?: (id: string | undefined) => void;
}

/** What the table shows for a row's action: its accessible name and what happens on activation. */
interface RowActionHandle {
  readonly label: (record: DataRecord) => string;
  readonly open: (record: DataRecord) => void;
}

interface TableBodyProps extends Omit<TableRendererProps, "documents" | "viewer"> {
  /** RFC 0008 item 4: the "Add" control for the view's `addForm` (top level only); the panel opens under the table. */
  readonly add?: ReactNode;
  /** The add form's panel, when open. */
  readonly addPanel?: ReactNode;
  /** Bumped when the add form saves: reloads rows beside the host's reloadKey. */
  readonly reloadSignal?: number;
  readonly viewer: ResolvedViewer;
  /** Replaces the view's own fixed filter: the target's filter with the row bindings applied. */
  readonly baseFilter?: Condition | undefined;
  /** Fields whose quick filters are hidden because a row action fixed them. */
  readonly lockedFields?: readonly string[];
  readonly rowAction?: RowActionHandle | undefined;
  /** Problems with the row action itself (unknown or non-table target). */
  readonly extraErrors?: readonly DocumentError[];
}

/** One level of the in-container back stack: the table shown, and how the viewer got here. */
interface Level {
  readonly view: TableView;
  readonly entity: EntityDocument;
  /** The target's own filter with the clicked row's bindings applied. */
  readonly baseFilter?: Condition | undefined;
  readonly lockedFields: readonly string[];
  /** The heading: what this level shows. */
  readonly heading?: string;
  /** The record whose action opened this level, to return focus to on Back. */
  readonly originRow?: string;
}

const DEFAULT_PAGE_SIZE = 25;
/** Not a valid field id (they start with a letter), so it can never collide with one. */
const ACTIONS_COLUMN = "_actions";

interface Editing {
  readonly record: DataRecord;
  readonly state: FormState;
}

type Rows = { readonly status: "loading" } | { readonly status: "loaded"; readonly items: readonly DataRecord[]; readonly total?: number; readonly next?: string | null } | { readonly status: "failed"; readonly message: string };

/**
 * Renders a table view: rows from the data adapter, sortable column headers,
 * paging, and in-place editing of the columns the view marks editable. The
 * table chrome, cells, editors and buttons all come from the registry.
 *
 * With a `rowAction`, every row gets an "Open ..." button that replaces the
 * table, in the same container, with the target table filtered by that row
 * and a Back button. Earlier tables stay mounted (hidden), so Back restores
 * their page, sort and quick filters.
 */
export function TableRenderer({ entity, view, registry, dataSources, entities, reloadKey, documents, viewer: viewerProp, formatting, onChanged, drafts, savedFilter, onSavedFilterChange }: TableRendererProps): ReactNode {
  const { viewer, error: viewerError } = useViewerSetup(viewerProp, view, documents);
  const [stack, setStack] = useState<readonly Level[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const afterRender = useRef<(() => void) | undefined>(undefined);
  const { Button, ErrorSummary } = registry.layout;
  const refEntities = entities ?? documents?.entities;

  useEffect(() => {
    const run = afterRender.current;
    afterRender.current = undefined;
    run?.();
  }, [stack]);

  const levels: readonly Level[] = [{ view, entity, baseFilter: view.filter, lockedFields: [] }, ...stack];
  const top = levels.length - 1;

  /** The row action of the table at `index` in the stack, with problems found while resolving its target. */
  const resolveAction = (index: number): Pick<TableBodyProps, "rowAction" | "extraErrors"> => {
    const level = levels[index];
    const action = level?.view.rowAction;
    if (!level || !action) return {};
    const fail = (message: string, hint: string): Pick<TableBodyProps, "extraErrors"> => ({ extraErrors: [{ path: "/rowAction/open", code: "invalid-value", message, hint }] });
    const target = documents?.views.get(action.open);
    if (!documents) return fail(`View "${level.view.id}" has a row action, but no documents were passed to look up "${action.open}".`, "Pass the document set as the documents prop.");
    if (!target || target.kind !== "table") return fail(`Row action opens "${action.open}", which is not a table view in the document set.`, "Point rowAction.open at a table view, or load that view.");
    const targetEntity = documents.entities.get(target.entity);
    if (!targetEntity) return fail(`View "${target.id}" is for entity "${target.entity}", which is not loaded.`, "Load that entity document.");
    if (index >= MAX_ROW_ACTION_DEPTH) return {}; // the validator caps chains; never nest deeper at run time
    if (!rowActionVisible(action, viewer)) return {}; // hidden for this viewer: rows are plain rows
    const text = (record: DataRecord, field: string): string => {
      const value = record.values[field];
      return value === undefined || value === null || value === "" ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
    };
    const first = action.bind[0];
    return {
      rowAction: {
        label: (record) => {
          const bound = first ? text(record, first.field) : "";
          const here = text(record, level.view.columns[0]?.field ?? "");
          const name = target.title ?? target.id;
          return `Open ${name}${bound ? ` — ${bound}` : ""}${here && here !== bound ? ` (${here})` : ""}`;
        },
        open: (record) => {
          const chips = action.bind.map((b) => `${targetEntity.fields.find((f) => f.id === b.to)?.label ?? b.to} = ${text(record, b.field) || "(empty)"}`);
          const next: Level = {
            view: target,
            entity: targetEntity,
            baseFilter: bindFilter(record.values, action.bind, target.filter),
            lockedFields: action.bind.map((b) => b.to),
            heading: `${target.title ?? target.id}: ${chips.join(", ")}`,
            originRow: record.id,
          };
          afterRender.current = () => {
            const headings = containerRef.current?.querySelectorAll<HTMLElement>("[data-yadad-drill-heading]");
            headings?.[headings.length - 1]?.focus();
          };
          setStack((s) => [...s, next]);
        },
      },
    };
  };

  const back = (): void => {
    const closing = levels[top];
    const index = top - 1;
    if (!closing || index < 0) return;
    const rowId = closing.originRow;
    afterRender.current = () => {
      const buttons = containerRef.current?.querySelectorAll<HTMLElement>(`[data-yadad-drill-level="${index}"] [data-yadad-row-open="${rowId}"] button`);
      buttons?.[0]?.focus();
    };
    setStack((s) => s.slice(0, -1));
  };

  // RFC 0008 item 4 (addForm): "Add" under the top-level table opens the named form view inline;
  // a save closes the panel and reloads the rows. It is rowAction.open in the create direction.
  const [adding, setAdding] = useState(false);
  const [addSaves, setAddSaves] = useState(0);
  if (viewerError) return <ErrorSummary errors={[viewerError]} />;

  const addControl = (): { add: ReactNode; addPanel?: ReactNode } | undefined => {
    if (view.addForm === undefined) return undefined;
    const fail = (message: string, hint: string): { add: ReactNode } => ({ add: <ErrorSummary errors={[{ path: "/addForm", code: "invalid-value", message, hint }]} /> });
    const formView = documents?.views.get(view.addForm);
    if (!documents) return fail(`View "${view.id}" offers an add form, but no documents were passed to look up "${view.addForm}".`, "Pass the document set as the documents prop.");
    if (!formView || formView.kind !== "form") return fail(`Add form opens "${view.addForm}", which is not a form view in the document set.`, "Point addForm at a form view, or drop it.");
    if (formView.entity !== entity.id) return fail(`Add form "${formView.id}" is for entity "${formView.entity}", not "${entity.id}".`, "The add form must be over the table's own entity.");
    if (!dataSources.has(formView.dataSource)) return fail(`Add form "${formView.id}" uses data source "${formView.dataSource}", which was not provided.`, "Provide that data source in dataSources.");
    return {
      add: (
        // The card's `view.addForm.button` premise rotted (addForm is the form view's id, a string);
        // the RFC body's own affordance is "Add {entity}".
        <Button label={`Add ${entity.id}`} type="button" variant="secondary" disabled={false} aria-expanded={adding} onPress={() => setAdding((a) => !a)} />
      ),
      ...(adding
        ? {
            addPanel: (
              <div data-yadad-add-form={formView.id}>
                <FormRenderer
                  entity={entity}
                  view={formView}
                  registry={registry}
                  dataSources={dataSources}
                  {...(refEntities ? { entities: refEntities } : {})}
                  documents={documents}
                  {...(formatting ? { formatting } : {})}
                  onSaved={() => {
                    setAdding(false);
                    setAddSaves((n) => n + 1);
                    onChanged?.();
                  }}
                />
              </div>
            ),
          }
        : {}),
    };
  };
  const addParts = levels.length === 1 ? addControl() : undefined;

  return (
    <div ref={containerRef} data-yadad-drill={view.id}>
      {levels.map((level, i) => (
        <div key={`${i}:${level.view.id}`} data-yadad-drill-level={i} {...(i === top ? {} : { hidden: true })}>
          {i > 0 && (
            <div data-yadad-drill-header="">
              <Button label="Back" type="button" variant="secondary" disabled={false} onPress={back} />
              <h2 tabIndex={-1} data-yadad-drill-heading="">
                {level.heading}
              </h2>
            </div>
          )}
          <TableBody
            entity={level.entity}
            view={level.view}
            registry={registry}
            dataSources={dataSources}
            viewer={viewer}
            {...(refEntities ? { entities: refEntities } : {})}
            reloadKey={reloadKey}
            {...(i === 0 && addParts ? { ...addParts, reloadSignal: addSaves } : {})}
            baseFilter={level.baseFilter}
            lockedFields={level.lockedFields}
            {...(formatting ? { formatting } : {})}
            {...(onChanged ? { onChanged } : {})}
            {...(drafts !== undefined ? { drafts } : {})}
            {...(savedFilter !== undefined ? { savedFilter } : {})}
            {...(onSavedFilterChange !== undefined ? { onSavedFilterChange } : {})}
            {...resolveAction(i)}
          />
        </div>
      ))}
    </div>
  );
}

function TableBody({ entity, view, viewer, registry, dataSources, entities, reloadKey, reloadSignal, baseFilter, lockedFields = [], rowAction, extraErrors = [], formatting, onChanged, drafts, add, addPanel, savedFilter, onSavedFilterChange }: TableBodyProps): ReactNode {
  const tableId = useId();
  const [sort, setSort] = useState<readonly SortSpec[]>(view.sort ?? []);
  const [page, setPage] = useState(0);
  // RFC 0007 cursor paging: the cursors visited so Previous works without backward cursors.
  // Keyed by the query signature; a sort, quick filter or page-size change is a new signature and clears the stack.
  const [paging, setPaging] = useState<{ readonly sig: string; readonly cursors: readonly (string | undefined)[]; readonly mode: "offset" | "cursor" }>({ sig: "", cursors: [undefined], mode: "offset" });
  // Read in the load effect without re-triggering it: the stack updates after every load.
  const pagingRef = useRef(paging);
  pagingRef.current = paging;
  const [rows, setRows] = useState<Rows>({ status: "loading" });
  // One extra row beyond the page edge per `to` compare column (RFC 0007), loaded beside the page and never displayed.
  const [edges, setEdges] = useState<Readonly<Record<string, CompareEdge | undefined>>>({});
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const store = drafts?.store;
  const debounceMs = drafts?.debounceMs ?? 400;
  const [restored, setRestored] = useState<RestoredDraft | undefined>(undefined);
  // Only input typed in this session is written back, so restoring alone never touches the stored draft (the form's rule).
  const typed = useRef(false);
  const [saving, setSaving] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [quick, setQuick] = useState<RecordValues>({});
  const shownColumns = useMemo(() => visibleColumns(view, viewer), [view, viewer]);

  const adapter = dataSources.get(view.dataSource);
  const pageSize = view.pageSize ?? DEFAULT_PAGE_SIZE;
  // Record actions (RFC 0007): buttons the component draws from TableRow.actions.
  const recordActions = useRecordActions({ entity, view, viewer, registry, adapter, reload: () => setReloads((n) => n + 1), ...(onChanged ? { onChanged } : {}) });
  const zone = viewerZone(formatting);
  // RFC 0009 item 5: the lit named filter joins the base before the quick filters do —
  // one `and` over the view's fixed filter and the saved condition, then combineFilters as-is.
  const savedCondition = savedFilter === undefined ? undefined : view.filters?.find((x) => x.id === savedFilter)?.condition;
  const joinedBase: Condition | undefined = savedCondition === undefined ? baseFilter
    : baseFilter === undefined ? savedCondition
      : { op: "and", conditions: [baseFilter, savedCondition] };
  const filter = useMemo(() => combineFilters(view, entity, quick, joinedBase, zone), [view, entity, quick, joinedBase, zone]);
  // The query signature: sort, filter and page size. A change is a new question — the cursor stack is cleared (RFC 0007).
  const sig = JSON.stringify([sort, filter, pageSize]);

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    // Relative dates become fixed ones here, on every load, so adapters never see them and "today" stays today.
    const fixed = filter ? resolveRelativeDates(filter) : undefined;
    // RFC 0007: the first request has no cursor and offset 0; a visited page goes by its saved cursor.
    const visited = pagingRef.current;
    const cursor = page > 0 && visited.sig === sig ? visited.cursors[page] : undefined;
    const mainQuery = { sort, page: cursor !== undefined ? { cursor, limit: pageSize } : { offset: page * pageSize, limit: pageSize }, ...(fixed ? { filter: fixed } : {}) };
    // A `to` compare column needs the row just outside the page edge (RFC 0007): neighbourQuery widens the query,
    // and the extra row is kept for compareCells only — the page itself never shows it.
    const compareCols = shownColumns.filter((c) => c.compare !== undefined && entity.fields.some((f) => f.id === c.field && f.type === "text"));
    const prevCol = compareCols.find((c) => c.compare?.to === "previousRow");
    const nextCol = compareCols.find((c) => c.compare?.to === "nextRow");
    const prevLoad = prevCol !== undefined && page > 0 ? adapter.find(entity.id, neighbourQuery(mainQuery, prevCol)) : undefined;
    const nextLoad = nextCol !== undefined ? adapter.find(entity.id, neighbourQuery(mainQuery, nextCol)) : undefined;
    Promise.all([adapter.find(entity.id, mainQuery), prevLoad, nextLoad]).then(
      ([result, prev, next]) => {
        if (!current) return;
        setRows({ status: "loaded", items: result.items, ...(result.total !== undefined ? { total: result.total } : {}), ...(result.next !== undefined ? { next: result.next } : {}) });
        // The response decides: total keeps offset paging; next with no total switches to cursors (RFC 0007).
        setPaging((prev) => {
          const base = prev.sig === sig ? prev : { sig, cursors: [undefined] as (string | undefined)[], mode: "offset" as "offset" | "cursor" };
          if (result.total !== undefined) return base.mode === "offset" && base === prev ? prev : { ...base, mode: "offset" };
          const mode = result.next != null || base.mode === "cursor" ? "cursor" : "offset";
          const cursors = [...base.cursors];
          cursors[page + 1] = result.next ?? undefined;
          return { sig, cursors, mode };
        });
        const nextEdgeRow = next?.items[pageSize];
        setEdges({
          ...(prevCol !== undefined ? { [prevCol.field]: prev !== undefined && prev.items[0] !== undefined && prev.items[0].id !== result.items[0]?.id ? { items: prev.items } : undefined } : {}),
          ...(nextCol !== undefined ? { [nextCol.field]: nextEdgeRow !== undefined ? { items: [nextEdgeRow] } : undefined } : {}),
        });
      },
      (error: unknown) => current && setRows({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [adapter, entity.id, sort, page, pageSize, filter, reloadKey, reloadSignal, reloads, shownColumns]);

  // Labels for the references on the loaded page; picker options only while a row is being edited.
  const referenceColumns = shownColumns.flatMap((c) => entity.fields.filter((f): f is ReferenceField => f.type === "reference" && f.id === c.field));
  const wants = rows.status !== "loaded" ? [] : rows.items.flatMap((record) => referenceColumns.flatMap((field) => {
    const value = (editing?.record.id === record.id && field.id in editing.state.values ? editing.state.values[field.id] : undefined) ?? record.values[field.id];
    return typeof value === "string" && value !== "" ? [{ field, id: value }] : [];
  }));
  const editableReferences = editing ? referenceColumns.filter((f) => shownColumns.some((c) => c.field === f.id && columnEditable(c, viewer))) : [];
  const references = useReferences(adapter, entities, editableReferences, wants, reloadKey);

  // Entering edit mode moves focus to the row's first editable input.
  const editingId = editing?.record.id;
  useEffect(() => {
    if (editingId === undefined) return;
    const first = shownColumns.find((c) => columnEditable(c, viewer));
    if (!first) return;
    document.getElementById(`${tableId}-${editingId}-${first.field}`)?.focus();
  }, [editingId, tableId, shownColumns, viewer]);

  // Drafts (the form's rule): typed input in the open row edit is stored after a pause; a
  // restored draft alone never rewrites the store. An emptied edit clears the stored draft.
  useEffect(() => {
    if (!store || !editing || !typed.current) return;
    const { record, state } = editing;
    const timer = setTimeout(() => {
      if (Object.keys(state.values).length === 0) store.clear(view.id, record.id);
      else store.save(view.id, record.id, { values: state.values, entityRevision: entity.revision, savedAt: Date.now(), recordVersion: record.version });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [store, debounceMs, view.id, entity.revision, editing]);

  const refs = [
    ...view.columns.map((c, i) => ({ field: c.field, path: ["columns", i, "field"] })),
    ...(view.sort ?? []).map((s, i) => ({ field: s.field, path: ["sort", i, "field"] })),
    ...(view.filter ? conditionFields(view.filter).map((field) => ({ field, path: ["filter"] })) : []),
    ...(view.quickFilters ?? []).map((f, i) => ({ field: f.field, path: ["quickFilters", i, "field"] })),
  ];
  const setupErrors = [...checkViewSetup(entity, view, adapter, refs), ...extraErrors, ...recordActionSetupErrors(entity, view, adapter, registry)];
  const { Table, Button, ErrorSummary, Section, FieldFrame, Pager } = registry.layout;
  if (setupErrors.length > 0) return <ErrorSummary errors={setupErrors} />;
  // RFC 0008 item 11: the registry's styled pager when it has one, today's nav otherwise.
  const pager = (label: string, hasPrevious: boolean, hasNext: boolean, pageCount: number | undefined): ReactNode =>
    Pager ? (
      <Pager
        label={label}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        page={page + 1}
        {...(pageCount === undefined ? {} : { pageCount })}
        onPrevious={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
      />
    ) : (
      <nav aria-label={label} data-yadad-pager="">
        <Button label="Previous" type="button" variant="secondary" disabled={!hasPrevious} onPress={() => setPage((p) => p - 1)} />
        <span>{pageCount === undefined ? `Page ${page + 1}` : `Page ${page + 1} of ${pageCount}`}</span>
        <Button label="Next" type="button" variant="secondary" disabled={!hasNext} onPress={() => setPage((p) => p + 1)} />
      </nav>
    );

  const columns = shownColumns.flatMap((c) => {
    const field = entity.fields.find((f) => f.id === c.field);
    return field ? [{ field, editable: columnEditable(c, viewer), ...(c.compare !== undefined ? { compare: c.compare } : {}) }] : [];
  });
  if (shownColumns.length === 0) return <p data-yadad-table-view={view.id} data-yadad-table-nothing="">There is nothing to show you here.</p>;
  const hasActions = columns.some((c) => c.editable) || rowAction !== undefined;
  const headerId = (columnId: string) => `${tableId}-col-${columnId}`;
  const editErrorsId = `${tableId}-edit-errors`;

  const headers: TableColumnHeader[] = [
    ...columns.map(({ field }) => {
      const active = sort[0]?.field === field.id ? { sort: sort[0].dir } : {};
      // A reference holds a record id, which says nothing about order.
      return { id: field.id, headerId: headerId(field.id), label: field.label, sortable: field.type !== "reference", ...active };
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
      const movedId = editing.record.id;
      typed.current = false;
      store?.clear(view.id, movedId);
      setRestored(undefined);
      setRows((r) => (r.status === "loaded" ? { ...r, items: replaceSavedRecord(r.items, movedId, saved) } : r));
      setEditing(undefined);
      setReloads((n) => n + 1);
      onChanged?.(); // neighbours (a dashboard's counts and stats) refresh too
    } else {
      // A refused save keeps the draft: the text is still there to fix and retry.
      setEditing({ ...editing, state: { ...editing.state, errors: result.errors } });
      // A refusal may mean the record's permissions changed: reload to refresh `can` (RFC 0006).
      if (result.errors.some((e) => e.code === "forbidden")) setReloads((n) => n + 1);
    }
  }

  /** Open a row's in-place edit, restoring its unsaved draft when one is stored. */
  const openEdit = (record: DataRecord): void => {
    typed.current = false;
    const draft = store?.load(view.id, record.id);
    const restoredDraft = draft ? restoreDraft(entity, draft, record.version) : null;
    setRestored(restoredDraft ?? undefined);
    setEditing({ record, state: restoredDraft ? { values: restoredDraft.values, errors: restoredDraft.invalidFields } : emptyFormState });
  };

  const cancelEdit = (): void => {
    typed.current = false;
    store?.clear(view.id, editing?.record.id);
    setRestored(undefined);
    setEditing(undefined);
  };

  const discardDraft = (): void => {
    typed.current = false;
    store?.clear(view.id, editing?.record.id);
    setRestored(undefined);
    setEditing((e) => (e ? { ...e, state: emptyFormState } : e));
  };

  const isEditing = (record: DataRecord): boolean => editing?.record.id === record.id && canUpdate(record);

  const renderCell = (record: DataRecord, field: Field, editable: boolean, diff?: CompareCell): ReactNode => {
    // RFC 0008 item 9: can.fields narrows inline edit per field — a locked field
    // stays read-only inside an open edit; the server remains the authority.
    if (!editable || !editing || !isEditing(record) || !canEditField(record, field.id)) return renderDisplay(registry, field, record.values[field.id], references, formatting, diff);
    const state = editing.state;
    const errors = state.errors.filter((e) => e.path === jsonPointer([field.id]));
    const value = field.id in state.values ? state.values[field.id] : record.values[field.id];
    const onChange = (v: FieldValue | undefined) =>
      setEditing((e) => {
        if (e) typed.current = true;
        return e ? { ...e, state: setFieldValue(e.state, field.id, v === undefined ? null : v) } : e;
      });
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
      references,
      formatting,
    );
  };

  const renderActions = (record: DataRecord): ReactNode =>
    isEditing(record) ? (
      <>
        <Button label="Save" type="button" variant="primary" disabled={saving} onPress={() => void saveEdit()} />
        <Button label="Cancel" type="button" variant="secondary" disabled={saving} onPress={cancelEdit} />
      </>
    ) : (
      <>
        {columns.some((c) => c.editable && canEditField(record, c.field.id)) && <Button label="Edit" type="button" variant="secondary" disabled={saving} onPress={() => openEdit(record)} />}
        {rowAction && (
          <span data-yadad-row-open={record.id}>
            <Button label={rowAction.label(record)} type="button" variant="secondary" disabled={saving} onPress={() => rowAction.open(record)} />
          </span>
        )}
      </>
    );

  const items = rows.status === "loaded" ? rows.items : [];
  // RFC 0007 compare columns: the word diff of each row against its comparator; undefined for a row without a neighbour.
  const columnDiffs = columns.map((c) => (c.compare !== undefined && c.field.type === "text" ? compareCells(items, { field: c.field.id, compare: c.compare }, edges[c.field.id]) : undefined));
  // Record actions (RFC 0007): the component draws these buttons; the renderer never builds one.
  const rowActions = items.map((record) => recordActions.items(record));
  const tableRows: TableRow<ReactNode>[] = items.map((record, rowIndex) => ({
    id: record.id,
    cells: [...columns.map(({ field, editable }, colIndex) => renderCell(record, field, editable, columnDiffs[colIndex]?.[rowIndex])), ...(hasActions ? [renderActions(record)] : [])],
    ...(rowActions[rowIndex]!.length > 0 ? { actions: rowActions[rowIndex] } : {}),
  }));
  // A server that returns neither total nor next cannot say "there is more": its page is the last (RFC 0007).
  const cursorMode = paging.mode === "cursor" && paging.sig === sig;
  const total = rows.status === "loaded" ? rows.total ?? 0 : 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const editErrors = editing?.state.errors ?? [];

  const quickFields = (view.quickFilters ?? []).flatMap((f) => {
    if (lockedFields.includes(f.field)) return [];
    // No filter control for a column this viewer cannot see (the filter itself still works).
    if (view.columns.some((c) => c.field === f.field) && !shownColumns.some((c) => c.field === f.field)) return [];
    const field = entity.fields.find((x) => x.id === f.field);
    return field && field.type !== "reference" ? [field] : []; // a reference cannot be a quick filter (the validator rejects it)
  });

  // RFC 0009 item 5: named saved filters as chips beside the quick filters. The renderer
  // draws them; which one is lit is the host's (the savedFilter prop), never renderer state.
  const savedChips = view.filters ?? [];

  return (
    <div data-yadad-table-view={view.id}>
      {savedChips.length > 0 && (
        <nav aria-label="Saved filters" data-yadad-saved-filters="">
          {savedChips.map((x) => (
            <Button
              key={x.id}
              label={x.name}
              type="button"
              variant="secondary"
              disabled={false}
              pressed={savedFilter === x.id}
              onPress={() => onSavedFilterChange?.(savedFilter === x.id ? undefined : x.id)}
            />
          ))}
        </nav>
      )}
      {editing && restored && (
        <div role="status">
          <Section id={`${view.id}-draft`} title={`Restored unsaved changes from ${new Date(restored.savedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`}>
            <>
              {restored.revisionChanged && <p>This table has changed since then. Check the restored values before saving.</p>}
              {restored.droppedFields.length > 0 && <p>Some values belong to fields this table no longer has and were left out.</p>}
              {restored.recordChanged && <p>The record changed elsewhere since then. Saving may report a conflict.</p>}
              <Button label="Discard" type="button" variant="secondary" disabled={saving} onPress={discardDraft} />
            </>
          </Section>
        </div>
      )}
      {quickFields.length > 0 && (
        <Section id={`${view.id}-filters`} title="Filter">
          {quickFields.map((field) =>
            isRangeFilter(field) ? (
              RANGE_ENDS.map(({ end, word }) => {
                const control = field.type === "datetime" && formatting?.timeZone !== undefined
                  ? { ...filterControl(field), label: `${field.label} ${word} (${formatting.timeZone})` }
                  : { ...filterControl(field), label: `${field.label} ${word}` };
                const key = rangeKey(end, field.id);
                const inputId = `${tableId}-filter-${field.id}-${end}`;
                return (
                  <FieldFrame key={key} inputId={inputId} errorId={`${inputId}-errors`} label={control.label} required={false} errors={[]}>
                    {renderInput(registry, control, quick[key], { inputId, invalid: false }, (v) => {
                      setQuick((q) => ({ ...q, [key]: v ?? null }));
                      setPage(0);
                    }, references)}
                  </FieldFrame>
                );
              })
            ) : (
              <FieldFrame key={field.id} inputId={`${tableId}-filter-${field.id}`} errorId={`${tableId}-filter-${field.id}-errors`} label={field.label} required={false} errors={[]}>
                {renderInput(registry, filterControl(field), quick[field.id], { inputId: `${tableId}-filter-${field.id}`, invalid: false }, (v) => {
                  setQuick((q) => ({ ...q, [field.id]: v ?? null }));
                  setPage(0);
                }, references)}
              </FieldFrame>
            ),
          )}
        </Section>
      )}
      {rows.status === "failed" && (
        <ErrorSummary errors={[loadFailure(rows.message)]} />
      )}
      <Table
        caption={view.title ?? entity.id}
        columns={headers}
        rows={tableRows}
        onSort={onSort}
        empty={rows.status === "loading" ? "Loading…" : rows.status === "failed" ? "No records to show." : filter ? "No records match the filters." : "No records yet."}
        {...(rowActions.some((a) => a.length > 0) ? { actionsLabel: "Actions" } : {})}
      />
      {recordActions.failures !== undefined && <ErrorSummary errors={recordActions.failures} />}
      {recordActions.announcement !== undefined && <div role="status">{recordActions.announcement.text}</div>}
      {recordActions.dialog}
      {editErrors.length > 0 && <ErrorSummary id={editErrorsId} errors={editErrors} />}
      {cursorMode ? (
        pager(`${view.title ?? entity.id} pages`, page > 0, rows.status === "loaded" && rows.next != null, undefined)
      ) : (
        pages > 1 && pager(`${view.title ?? entity.id} pages`, page > 0, page < pages - 1, pages)
      )}
      {add}
      {addPanel}
    </div>
  );
}

const BOOLEAN_CHOICES = ["Yes", "No"];

/** Number and date fields filter as a from/to range; the other types match one value. */
const isRangeFilter = (field: Field): boolean => field.type === "number" || field.type === "date" || field.type === "datetime";


const RANGE_ENDS = [
  { end: "from", word: "from", op: "gte" },
  { end: "to", word: "to", op: "lte" },
] as const;

/** Where a range end is kept among the quick values. A colon can never be in a field id, so it cannot collide with one. */
const rangeKey = (end: "from" | "to", fieldId: string): string => `${end}:${fieldId}`;

/** The control a quick filter shows: the field itself (never required), Yes/No for a checkbox, or a plain text box for a datetime range — the viewer types a local time there, and combineFilters converts it to instants. */
function filterControl(field: Field): Field {
  if (field.type === "boolean") return { id: field.id, type: "select", label: field.label, options: { source: "static", values: BOOLEAN_CHOICES } };
  if (field.type === "datetime") return { id: field.id, type: "text", label: field.label };
  return { ...field, required: false };
}

/** The zone the quick filter's local times are read in: the viewer's, else the environment's. */
const viewerZone = (formatting?: FieldFormatting): string => formatting?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The view's fixed filter and every quick filter the viewer has set, combined with "and". */
function combineFilters(view: TableView, entity: EntityDocument, quick: RecordValues, baseFilter: Condition | undefined, zone: string): Condition | undefined {
  const parts: Condition[] = baseFilter ? [baseFilter] : [];
  for (const { field: id } of view.quickFilters ?? []) {
    const field = entity.fields.find((f) => f.id === id);
    if (field && isRangeFilter(field)) {
      // A range filter is a from and a to bound; either end may stay empty.
      for (const { end, op } of RANGE_ENDS) {
        const bound = quick[rangeKey(end, id)];
        if (typeof bound === "number" && field.type === "number") parts.push({ op, field: id, value: bound });
        else if (typeof bound === "string" && bound !== "" && field.type === "date") parts.push({ op, field: id, value: bound });
        else if (field.type === "datetime" && typeof bound === "string" && LOCAL_DATETIME_PATTERN.test(bound)) {
          // The viewer typed a local time; compare instants; "to" covers its whole minute (RFC 0007).
          // With only this end set, the other bound is a placeholder — the pushed one is what filters.
          const other = quick[rangeKey(op === "gte" ? "to" : "from", id)];
          const bounds = typeof other === "string" && other !== ""
            ? instantRangeBounds(op === "gte" ? bound : other, op === "gte" ? other : bound, zone)
            : { from: localToInstant(bound, zone), to: new Date(new Date(localToInstant(bound, zone)).getTime() + 59_999).toISOString() };
          parts.push({ op, field: id, value: op === "gte" ? bounds.from : bounds.to });
        }
      }
      continue;
    }
    const value = quick[id];
    if (!field || value === undefined || value === null || value === "") continue;
    // RFC 0008 item 15: a tags quick filter is multi-chip — the viewer types
    // tags and a record matches when it carries ANY of them; no chips, no filter.
    if (field.type === "tags") {
      const tags = Array.isArray(value) ? value.filter((t) => typeof t === "string" && t !== "") : [];
      if (tags.length === 1) parts.push({ op: "contains", field: id, value: tags[0]! });
      else if (tags.length > 1) parts.push({ op: "or", conditions: tags.map((t) => ({ op: "contains" as const, field: id, value: t })) });
      continue;
    }
    // An untouched checkbox is never saved, so "No" also matches a missing value.
    if (field.type === "boolean")
      parts.push(value === "Yes" ? { op: "eq", field: id, value: true } : { op: "or", conditions: [{ op: "eq", field: id, value: false }, { op: "empty", field: id }] });
    else if (field.type === "text" && typeof value === "string") parts.push({ op: "contains", field: id, value });
    else if (typeof value === "string") parts.push({ op: "eq", field: id, value });
  }
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", conditions: parts };
}
