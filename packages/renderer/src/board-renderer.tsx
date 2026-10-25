import { AdapterError, RecordValidationError, conditionFields, optionLabel, optionValue } from "@yadad/core";
import type { BoardCard, BoardColumn, BoardView, DataAdapter, DataRecord, DocumentError, EntityDocument, Field, FieldValue, ReferenceField, ReferenceOption, Registry, ResolvedViewer, TableView } from "@yadad/core";
import { BOARD_OTHER_LABEL, bindFilter, boardColumns, boardGroupField, boardRecordColumns, canEditField, canMoveColumn, groupByColumn, loadBoardCards, loadBoardTargets, moveCard, rowActionVisible, viewEditable } from "@yadad/runtime";
import type { BoardColumnDef, BoardLoad } from "@yadad/runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadFailure } from "./load-state.js";
import type { DocumentSet } from "./document-set.js";
import { renderDisplay } from "./fields.js";
import type { FieldFormatting } from "./fields.js";
import { useReferences } from "./references.js";
import type { ReferenceSupport } from "./references.js";
import { checkViewSetup } from "./setup.js";
import { recordActionSetupErrors, useRecordActions } from "./record-actions.js";
import { replaceSavedRecord } from "./saved-record.js";
import { TableRenderer } from "./table-renderer.js";
import { useViewerSetup } from "./viewer.js";

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const OTHER_COLUMN_DEF: BoardColumnDef = { id: "other", kind: "other", label: BOARD_OTHER_LABEL, value: null };
const UNTITLED = "(untitled)";

export interface BoardRendererProps {
  readonly entity: EntityDocument;
  readonly view: BoardView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  /** The documents of the entities that the entity's reference fields point at, by id (for labels and reference columns). */
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  /** Change this to reload the cards and the reference columns, e.g. after a form saves a record. */
  readonly reloadKey?: unknown;
  /** The other documents in the set. Needed when the view has a `rowAction`. */
  readonly documents?: DocumentSet;
  /** The clock for relative dates in the view's filter. */
  readonly now?: Date;
  /**
   * Host-controlled grouping: the field id in use. When set it wins over the
   * viewer's choice, which is still reported through `onGroupByChange`. An id
   * that is not one of the view's `groupBy` fields falls back to the default.
   */
  readonly groupBy?: string;
  /**
   * The grouping the board opens on. Only the first render reads it: after
   * that the viewer's choice wins. Ignored when `groupBy` is passed. An id
   * that is not one of the view's `groupBy` fields falls back to the default,
   * as `groupBy` does. This is what a state grid passes to open a board in
   * another grouping without taking control of it.
   */
  readonly initialGroupBy?: string;
  /** Called on every viewer choice, controlled or not. */
  readonly onGroupByChange?: (field: string) => void;
  /**
   * Who is viewing (RFC 0006), from `resolveViewer`. Moving and opening are
   * offered only where this viewer may use them. Without it, a renderer with
   * `documents` uses the viewer document's defaults; a view that reads a viewer
   * fact and cannot find the document shows an error.
   */
  readonly viewer?: ResolvedViewer;
  /** The viewer's locale and zone for datetime fields (RFC 0007); absent, the environment's. */
  readonly formatting?: FieldFormatting;
  /**
   * Called once after each **successful user-initiated write** made inside this
   * renderer: a move, a record action. Never on load or reload. A dashboard
   * passes it to every widget in a cell so the others (counts, stats) can
   * refresh — a reload does not call it, so passing a bump down cannot loop.
   */
  readonly onChanged?: () => void;
}

type CardState =
  | ({ readonly status: "loaded"; readonly records: readonly DataRecord[]; readonly total: number; readonly truncated: boolean } & Pick<BoardLoad, "records" | "total" | "truncated">)
  | { readonly status: "failed"; readonly message: string };

type TargetState =
  | { readonly status: "loaded"; readonly options: readonly ReferenceOption[]; readonly more: boolean; readonly total: number }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string };

/** An open card: the target table, with the clicked card's bindings applied, replacing the board. */
interface Opened {
  readonly view: TableView;
  readonly heading: string;
}

/**
 * Renders a board view: the records of one entity as cards in columns, one
 * column per value of the grouping field, with the viewer's choice of field
 * switchable. It loads the cards through the runtime (one query, grouped on
 * the client, so switching the grouping never refetches), loads a reference
 * grouping's target records for its columns, and hands columns, card nodes,
 * group-by choices and callbacks to the registry's `layout.Board`. There is no
 * drag code here: the component calls `onMove`, and so does its "Move to…"
 * action. A move is optimistic; any failure puts the card back, shows the
 * adapter's message, announces it and reloads the cards (RFC 0005).
 *
 * With a `rowAction`, activating a card replaces the board, in the same
 * container, with the target table filtered by that card and a Back button.
 * The board stays mounted (hidden), so Back returns to the same grouping.
 */
export function BoardRenderer({ entity, view, registry, dataSources, entities, reloadKey, documents, now, groupBy, initialGroupBy, onGroupByChange, viewer: viewerProp, formatting, onChanged }: BoardRendererProps): ReactNode {
  const { viewer, error: viewerError } = useViewerSetup(viewerProp, view, documents);
  const [opened, setOpened] = useState<Opened | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const afterRender = useRef<(() => void) | undefined>(undefined);
  const { Button, ErrorSummary } = registry.layout;
  const refEntities = entities ?? documents?.entities;

  useEffect(() => {
    const run = afterRender.current;
    afterRender.current = undefined;
    run?.();
  }, [opened]);

  const action = view.rowAction;
  const target = action ? documents?.views.get(action.open) : undefined;
  const targetEntity = target && target.kind === "table" ? documents?.entities.get(target.entity) : undefined;
  const actionErrors: DocumentError[] = [];
  if (action) {
    const fail = (message: string, hint: string) => actionErrors.push({ path: "/rowAction/open", code: "invalid-value", message, hint });
    if (!documents) fail(`View "${view.id}" has a row action, but no documents were passed to look up "${action.open}".`, "Pass the document set as the documents prop.");
    else if (!target || target.kind !== "table") fail(`Row action opens "${action.open}", which is not a table view in the document set.`, "Point rowAction.open at a table view, or load that view.");
    else if (!targetEntity) fail(`View "${target.id}" is for entity "${target.entity}", which is not loaded.`, "Load that entity document.");
  }

  const open = (record: DataRecord): void => {
    if (!action || !target || target.kind !== "table" || !targetEntity) return;
    const text = (field: string): string => {
      const value = record.values[field];
      return value === undefined || value === null || value === "" ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
    };
    const locked = action.bind.map((b) => b.to);
    const quickFilters = target.quickFilters?.filter((q) => !locked.includes(q.field));
    const { quickFilters: _dropped, filter: _filter, ...rest } = target;
    const filter = bindFilter(record.values, action.bind, target.filter);
    const chips = action.bind.map((b) => `${targetEntity.fields.find((f) => f.id === b.to)?.label ?? b.to} = ${text(b.field) || "(empty)"}`);
    afterRender.current = () => containerRef.current?.querySelector<HTMLElement>("[data-yadad-drill-heading]")?.focus();
    setOpened({
      view: { ...rest, ...(filter ? { filter } : {}), ...(quickFilters && quickFilters.length > 0 ? { quickFilters } : {}) },
      heading: `${target.title ?? target.id}: ${chips.join(", ")}`,
    });
  };

  const back = (): void => {
    afterRender.current = () => containerRef.current?.querySelector<HTMLElement>("[data-yadad-board-view]")?.focus();
    setOpened(undefined);
  };

  if (viewerError) return <ErrorSummary errors={[viewerError]} />;

  return (
    <div ref={containerRef} data-yadad-drill={view.id}>
      <div data-yadad-drill-level={0} {...(opened ? { hidden: true } : {})}>
        <BoardBody
          entity={entity}
          view={view}
          registry={registry}
          dataSources={dataSources}
          {...(refEntities ? { entities: refEntities } : {})}
          reloadKey={reloadKey}
          {...(now ? { now } : {})}
          extraErrors={actionErrors}
          viewer={viewer}
          {...(groupBy !== undefined ? { groupBy } : {})}
          {...(initialGroupBy !== undefined ? { initialGroupBy } : {})}
          {...(onGroupByChange ? { onGroupByChange } : {})}
          {...(formatting ? { formatting } : {})}
          {...(action && actionErrors.length === 0 && rowActionVisible(action, viewer) ? { onOpen: open } : {})}
          {...(onChanged ? { onChanged } : {})}
        />
      </div>
      {opened && targetEntity && documents && (
        <div data-yadad-drill-level={1}>
          <div data-yadad-drill-header="">
            <Button label="Back" type="button" variant="secondary" disabled={false} onPress={back} />
            <h2 tabIndex={-1} data-yadad-drill-heading="">
              {opened.heading}
            </h2>
          </div>
          <TableRenderer entity={targetEntity} view={opened.view} registry={registry} dataSources={dataSources} entities={refEntities ?? documents.entities} documents={documents} reloadKey={reloadKey} viewer={viewer} {...(formatting ? { formatting } : {})} {...(onChanged ? { onChanged } : {})} />
        </div>
      )}
    </div>
  );
}

interface BoardBodyProps {
  readonly entity: EntityDocument;
  readonly view: BoardView;
  readonly registry: Registry<ReactNode>;
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  readonly reloadKey?: unknown;
  readonly now?: Date;
  readonly extraErrors: readonly DocumentError[];
  readonly viewer: ResolvedViewer;
  readonly groupBy?: string;
  readonly initialGroupBy?: string;
  readonly onGroupByChange?: (field: string) => void;
  readonly onOpen?: (record: DataRecord) => void;
  readonly formatting?: FieldFormatting;
  readonly onChanged?: () => void;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failed update as the core error list: a 400's issues as they are, anything else one message. */
function moveErrors(error: unknown): DocumentError[] {
  if (error instanceof RecordValidationError) return [...error.issues];
  const code = error instanceof AdapterError ? (error.code === "validation" ? "invalid-value" : error.code) : "invalid-value";
  return [{ path: "", code, message: failureMessage(error), hint: "The card is back in its column. Reload if the problem stays." }];
}

function BoardBody({ entity, view, registry, dataSources, entities, reloadKey, now, extraErrors, viewer, groupBy, initialGroupBy, onGroupByChange, onOpen, formatting, onChanged }: BoardBodyProps): ReactNode {
  const clock = (): Date => now ?? new Date();

  // The grouping choice: uncontrolled state by default, host-controlled when `groupBy` is set.
  // `initialGroupBy` only seeds the uncontrolled state; an unknown id falls back below.
  const ids = view.groupBy.map((g) => g.field);
  const defaultId = ids[0] ?? "";
  const [choice, setChoice] = useState(() => groupBy ?? initialGroupBy ?? defaultId);
  const controlled = groupBy !== undefined;
  const activeId = controlled ? (groupBy !== undefined && ids.includes(groupBy) ? groupBy : defaultId) : ids.includes(choice) ? choice : defaultId;
  const groupField = boardGroupField(view, entity, activeId);

  const [cards, setCards] = useState<CardState | undefined>(undefined);
  const [targets, setTargets] = useState<ReadonlyMap<string, TargetState>>(new Map());
  const [reloads, setReloads] = useState(0);
  const [targetReloads, setTargetReloads] = useState(0);
  /** Records whose move is in flight, with the value the move writes. */
  const [pending, setPending] = useState<ReadonlyMap<string, FieldValue>>(new Map());
  /** Records whose completion toggle is in flight, with the value being written (RFC 0008 item 3). */
  const [toggling, setToggling] = useState<ReadonlyMap<string, boolean>>(new Map());
  const inFlight = useRef(new Set<string>());
  const [errors, setErrors] = useState<readonly DocumentError[]>([]);
  const [announcement, setAnnouncement] = useState<{ readonly seq: number; readonly text: string } | undefined>(undefined);

  const adapter = dataSources.get(view.dataSource);
  const editable = viewEditable(view, viewer);

  // One card load per (view, data source, reloadKey, reload). The query carries
  // no grouping, so switching the grouping never refetches. A reload starts
  // from scratch: the previous cards are not kept (RFC 0005).
  useEffect(() => {
    if (!adapter) return;
    let current = true;
    setCards(undefined);
    loadBoardCards(adapter, view, { entity, now: clock() }).then(
      (load: BoardLoad) => current && setCards({ status: "loaded", records: load.records, total: load.total, truncated: load.truncated }),
      (error: unknown) => current && setCards({ status: "failed", message: failureMessage(error) }),
    );
    return () => {
      current = false;
    };
    // `clock` reads `now`, which is a stable input in practice.
  }, [adapter, entity, view, reloadKey, reloads]);

  const isReference = groupField.type === "reference";
  const targetEntity = isReference ? entities?.get(groupField.entity) : undefined;
  // RFC 0008 item 10: columnsFrom "options" builds the columns from the target
  // entity's records; the default "records" derives them from the loaded page
  // and never fetches targets (a huge or slow target pays nothing).
  const fromOptions = isReference && view.columnsFrom === "options" && groupField.type === "reference";

  // A reference grouping in options mode: one find, sorted by the display
  // field, capped at the column cap. Loaded once per target entity and data
  // source, not on every switch.
  useEffect(() => {
    if (!fromOptions || !targetEntity || !adapter) return;
    const key = targetEntity.id;
    let current = true;
    setTargets((prev) => {
      const next = new Map(prev);
      if (!next.has(key)) next.set(key, { status: "loading" });
      return next;
    });
    loadBoardTargets(adapter, targetEntity, groupField).then(
      (result) =>
        current &&
        setTargets((prev) => {
          const next = new Map(prev);
          next.set(key, { status: "loaded", options: result.options, more: result.more, total: result.total });
          return next;
        }),
      (error: unknown) =>
        current &&
        setTargets((prev) => {
          const next = new Map(prev);
          next.set(key, { status: "failed", message: failureMessage(error) });
          return next;
        }),
    );
    return () => {
      current = false;
    };
  }, [adapter, groupField, fromOptions, targetEntity, reloadKey, reloads, targetReloads]);

  const targetState = fromOptions && targetEntity ? targets.get(targetEntity.id) : undefined;

  const loadedRecords = cards?.status === "loaded" ? cards.records : undefined;

  // A pending card shows its move's target value (the empty column clears it
  // to null). It keeps its query-sort position, so it sits where the sort
  // gives it in the new column (RFC 0005, answer 3).
  const records = useMemo(
    () =>
      (loadedRecords ?? []).map((r) => {
        const done = view.doneField === undefined ? undefined : toggling.get(r.id);
        if (!pending.has(r.id) && done === undefined) return r;
        const values = { ...r.values };
        if (pending.has(r.id)) values[groupField.id] = pending.get(r.id) ?? null;
        if (done !== undefined && view.doneField !== undefined) values[view.doneField] = done;
        return { ...r, values };
      }),
    [loadedRecords, pending, toggling, groupField, view.doneField],
  );

  const titleField = view.titleField ?? entity.fields.find((f) => f.type === "text")?.id;
  const detailFields = (view.cardFields ?? []).flatMap((id) => entity.fields.filter((f) => f.id === id));
  const referenceFields = detailFields.filter((f): f is ReferenceField => f.type === "reference");
  const wants = records.flatMap((r) =>
    [...referenceFields, ...(isReference && !fromOptions && groupField.type === "reference" ? [groupField] : [])].flatMap((field) => {
      const value = r.values[field.id];
      return typeof value === "string" && value !== "" ? [{ field, id: value }] : [];
    }),
  );
  const references = useReferences(adapter, entities, [], wants, reloadKey);

  // The columns shown (RFC 0008 item 10): options mode uses the target records
  // loaded above; the default records mode derives one column per value present
  // in the loaded page, labelled the way the card labels the same reference.
  // Records-derived columns are only built once cards are loaded, so the empty
  // board shows the empty column alone (and no phantom drop targets).
  const columnDefs: BoardColumnDef[] = useMemo(() => {
    if (!isReference) return boardColumns(groupField);
    if (groupField.type !== "reference") return [];
    if (fromOptions) return targetState?.status === "loaded" ? boardColumns(groupField, targetState.options) : [];
    if (loadedRecords === undefined) return [];
    return boardRecordColumns(groupField, records, (id) => references.display(groupField, id).label);
  }, [isReference, fromOptions, groupField, targetState, loadedRecords, records, references]);

  const refs = [
    ...view.groupBy.map((g, i) => ({ field: g.field, path: ["groupBy", i, "field"] as const })),
    ...(view.titleField ? [{ field: view.titleField, path: ["titleField"] as const }] : []),
    ...(view.cardFields ?? []).map((field, i) => ({ field, path: ["cardFields", i] as const })),
    ...(view.sort ?? []).map((s, i) => ({ field: s.field, path: ["sort", i, "field"] as const })),
    ...(view.filter ? conditionFields(view.filter).map((field) => ({ field, path: ["filter"] as const })) : []),
  ];
  const setupErrors: DocumentError[] = [...checkViewSetup(entity, view, adapter, refs), ...extraErrors, ...recordActionSetupErrors(entity, view, adapter, registry)];
  if (groupField && groupField.type !== "select" && groupField.type !== "boolean" && groupField.type !== "reference") {
    setupErrors.push({
      path: `/groupBy/0/field`,
      code: "invalid-value",
      message: `Field "${groupField.id}" is a ${groupField.type} field, not a groupable field.`,
      hint: "Use a select, boolean or reference field as a group-by field.",
    });
  }
  const { Board, ErrorSummary, Button } = registry.layout;
  if (!Board) {
    setupErrors.push({
      path: "/layout/Board",
      code: "required",
      message: `This registry has no layout.Board component, so the board view ${view.id} cannot be shown.`,
      hint: "Add a layout.Board component to the registry.",
    });
  }
  const announce = (text: string): void => setAnnouncement((a) => ({ seq: (a?.seq ?? 0) + 1, text }));
  const recordActions = useRecordActions({ entity, view, viewer, registry, adapter, reload: () => setReloads((n) => n + 1), announce, ...(onChanged ? { onChanged } : {}) });
  if (setupErrors.length > 0 || !Board) return <ErrorSummary errors={setupErrors} />;

  const cardsLoading = cards === undefined;
  const targetsLoading = isReference && (!targetEntity || !targetState || targetState.status === "loading");
  const loading = cardsLoading || targetsLoading;

  const recordTitle = (record: DataRecord): string => {
    const field = titleField === undefined ? undefined : entity.fields.find((f) => f.id === titleField);
    const value = field ? record.values[field.id] : undefined;
    return typeof value === "string" && value.trim() !== "" ? value : UNTITLED;
  };

  const plain = (field: Field, record: DataRecord): string => plainText(field, record.values[field.id], references);

  const doneDef = view.doneField === undefined ? undefined : entity.fields.find((f) => f.id === view.doneField && f.type === "boolean");
  const toggleDone = (record: DataRecord): void => {
    if (!doneDef || !adapter || !editable || inFlight.current.has(record.id)) return;
    const title = recordTitle(record);
    const next = record.values[doneDef.id] !== true;
    if (!canEditField(record, doneDef.id)) return; // the server withheld this field (can.fields)
    inFlight.current.add(record.id);
    setErrors([]);
    setToggling((t) => new Map(t).set(record.id, next));
    const settle = (): void => {
      inFlight.current.delete(record.id);
      setToggling((t) => {
        const m = new Map(t);
        m.delete(record.id);
        return m;
      });
    };
    adapter
      .update(view.entity, record.id, { [doneDef.id]: next }, { entityRevision: entity.revision, baseVersion: record.version })
      .then(
        (saved) => {
          setCards((s) => (s?.status === "loaded" ? { ...s, records: replaceSavedRecord(s.records, record.id, saved) } : s));
          settle();
          announce(`${title} marked ${next ? "done" : "not done"}`);
          onChanged?.();
        },
        (error: unknown) => {
          settle();
          setErrors(moveErrors(error));
          announce(`Could not update ${title}: ${failureMessage(error)}`);
          setReloads((n) => n + 1);
        },
      );
  };

  const grouped = groupByColumn(groupField, columnDefs, records);
  const hasOther = grouped.has(OTHER_COLUMN_DEF.id);
  const cardsOf = (columnId: string): BoardCard<ReactNode>[] =>
    (grouped.get(columnId) ?? []).map((record) => {
      const title = recordTitle(record);
      const isPending = pending.has(record.id);
      const details = detailFields.filter((f) => record.values[f.id] !== undefined && record.values[f.id] !== null && record.values[f.id] !== "");
      return {
        id: record.id,
        content: (
          <>
            <span data-yadad-board-title="">{title}</span>
            {details.map((field) => (
              <small key={field.id} data-yadad-board-detail={field.id}>
                {renderDisplay(registry, field, record.values[field.id], references, formatting)}
              </small>
            ))}
          </>
        ),
        label: [title, ...details.map((f) => `${f.label}: ${plain(f, record)}`)].join(", "),
        movable: editable && canMoveColumn(record, groupField.id) && !isPending, // RFC 0008 item 9: can.fields narrows the drag
        pending: isPending,
        ...(doneDef === undefined
          ? {}
          : { done: { checked: record.values[doneDef.id] === true, disabled: !editable || !canEditField(record, doneDef.id) || toggling.has(record.id), toggle: () => toggleDone(record) } }),
        actions: recordActions.items(record),
      };
    });
  const columns: BoardColumn<ReactNode>[] = [
    ...columnDefs.map((def): BoardColumn<ReactNode> => ({ id: def.id, label: def.label, ...(def.color === undefined ? {} : { color: def.color }), count: grouped.get(def.id)?.length ?? 0, droppable: true, cards: cardsOf(def.id) })),
    ...(hasOther
      ? [{ id: OTHER_COLUMN_DEF.id, label: OTHER_COLUMN_DEF.label, count: grouped.get(OTHER_COLUMN_DEF.id)?.length ?? 0, droppable: false, cards: cardsOf(OTHER_COLUMN_DEF.id) }]
      : []),
  ];

  const changeGroup = (fieldId: string): void => {
    const field = entity.fields.find((f) => f.id === fieldId);
    const label = field?.label ?? fieldId;
    let count: number | undefined;
    if (field) {
      if (field.type === "select" || field.type === "boolean") count = boardColumns(field).length;
      else if (field.type === "reference") {
        const state = targets.get(field.entity);
        if (state?.status === "loaded") count = boardColumns(field, state.options).length;
      }
    }
    setChoice(fieldId);
    onGroupByChange?.(fieldId);
    announce(`Grouped by ${label}${count !== undefined ? `, ${count} columns` : ""}`);
  };

  const move = (recordId: string, columnId: string): void => {
    const record = loadedRecords?.find((r) => r.id === recordId);
    if (!record || !adapter || !editable || !canMoveColumn(record, groupField.id) || inFlight.current.has(recordId)) return;
    const title = recordTitle(record);
    const def = columnId === OTHER_COLUMN_DEF.id ? OTHER_COLUMN_DEF : columnDefs.find((c) => c.id === columnId);
    if (!def) return; // a stale column id (the grouping changed mid-gesture): ignore
    let plan;
    try {
      plan = moveCard(view, entity, groupField, record, def);
    } catch (error) {
      announce(`Could not move ${title}: ${failureMessage(error)}`);
      return;
    }
    if (plan.kind === "none") return;
    if (plan.kind === "blocked") {
      announce(`Could not move ${title}: ${plan.message}`);
      return;
    }
    inFlight.current.add(recordId);
    setErrors([]);
    setPending((p) => new Map(p).set(recordId, def.value));
    const settle = (): void => {
      inFlight.current.delete(recordId);
      setPending((p) => {
        const next = new Map(p);
        next.delete(recordId);
        return next;
      });
    };
    adapter.update(plan.entity, plan.id, plan.patch, plan.meta).then(
      (saved) => {
        setCards((s) => (s?.status === "loaded" ? { ...s, records: replaceSavedRecord(s.records, recordId, saved) } : s));
        settle();
        announce(`Moved ${title} to ${def.label}`);
        onChanged?.(); // neighbours (a dashboard's counts and stats) refresh too
      },
      (error: unknown) => {
        settle();
        setErrors(moveErrors(error));
        announce(`Could not move ${title}: ${failureMessage(error)}`);
        setReloads((n) => n + 1); // show the server's state
      },
    );
  };

  const notices: string[] = [];
  if (cards?.status === "loaded" && cards.truncated) {
    notices.push(`Showing the first ${NUMBER.format(cards.records.length)} of ${NUMBER.format(cards.total)} cards. Narrow the filter.`);
  }
  if (isReference && targetState?.status === "loaded" && targetState.more) {
    notices.push(`Showing ${NUMBER.format(targetState.options.length)} of ${NUMBER.format(targetState.total)} ${groupField.label} columns. Cards for the others are in Other.`);
  }
  const notice = notices.length > 0 ? <p data-yadad-board-notice="">{notices.join(" ")}</p> : undefined;

  if (cards?.status === "failed") {
    return (
      <div data-yadad-board-view={view.id} tabIndex={-1}>
        <div data-yadad-board-load-error="">
          <ErrorSummary errors={[loadFailure(cards.message)]} />
          <Button label="Retry" type="button" variant="secondary" disabled={false} onPress={() => setReloads((n) => n + 1)} />
        </div>
      </div>
    );
  }

  const referenceFailed = isReference && targetState?.status === "failed";

  return (
    <div data-yadad-board-view={view.id} tabIndex={-1}>
      {referenceFailed && (
        <div data-yadad-board-targets-error="">
          <ErrorSummary errors={[{ path: "", code: "invalid-value", message: `Could not load the ${groupField.label} columns: ${targetState.message}`, hint: "Retry, or switch to another grouping." }]} />
          <Button label="Retry" type="button" variant="secondary" disabled={false} onPress={() => setTargetReloads((n) => n + 1)} />
        </div>
      )}
      {errors.length > 0 && <ErrorSummary errors={[...errors]} />}
      <Board
        label={view.title ?? entity.id}
        groupChoices={view.groupBy.map((g) => {
          const field = entity.fields.find((f) => f.id === g.field);
          return { field: g.field, label: field?.label ?? g.field };
        })}
        groupField={activeId}
        columns={referenceFailed ? [] : columns}
        loading={loading}
        {...(notice ? { notice } : {})}
        {...(announcement ? { announcement } : {})}
        onGroupBy={changeGroup}
        {...(onOpen ? { onOpenCard: (id: string) => { const record = loadedRecords?.find((r) => r.id === id); if (record) onOpen(record); } } : {})}
        {...(editable ? { onMove: move } : {})}
      />
      {recordActions.failures !== undefined && <ErrorSummary errors={recordActions.failures} />}
      {recordActions.dialog}
    </div>
  );
}

/** A field value as plain text, for accessible names: references by their loaded label. */
function plainText(field: Field, value: unknown, references: ReferenceSupport): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.type === "reference" && typeof value === "string") return references.display(field, value).label;
  if (field.type === "select" && typeof value === "string") {
    const option = field.options.values.find((o) => optionValue(o) === value);
    if (option !== undefined) return optionLabel(option); // RFC 0008 item 5
  }
  return String(value);
}
