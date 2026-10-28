import { AdapterError, CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT, RecordValidationError, conditionFields, optionLabel, optionValue } from "@yadad/core";
import type { CalendarEntry, CalendarMode, CalendarView, DataAdapter, DataRecord, DocumentError, EntityDocument, Field, ReferenceField, Registry, ResolvedViewer, TableView } from "@yadad/core";
import { bindFilter, bindingValues, calendarToday, canEditField, canMoveColumn, colorSlot, dayLabel, groupByDay, loadCalendarRange, moveDay, periodTitle, rowActionVisible, shiftAnchor, visibleDays, visibleRange, viewEditable, weekdayLabels } from "@yadad/runtime";
import type { CalendarLoad, DateRange } from "@yadad/runtime";
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
import { useContentStable } from "./use-stable.js";

export interface CalendarRendererProps {
  readonly entity: EntityDocument;
  readonly view: CalendarView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  /** The documents of the entities that the entity's reference fields point at, by id (for labels). */
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  /** Change this to reload the visible range, e.g. after a form saves a record. */
  readonly reloadKey?: unknown;
  /** The other documents in the set. Needed when the view has a `rowAction`. */
  readonly documents?: DocumentSet;
  /** The clock for "today" and relative dates in the view's filter. Defaults to the current time. */
  readonly now?: Date;
  /**
   * Who is viewing (RFC 0006), from `resolveViewer`. Moving and opening are
   * offered only where this viewer may use them. Without it, a renderer with
   * `documents` uses the viewer document's defaults; a view that reads a viewer
   * fact and cannot find the document shows an error.
   */
  readonly viewer?: ResolvedViewer;
  /**
   * The mode the calendar opens on. Only the first render reads it: after
   * that the viewer's choice (the mode switcher) wins. A mode that is not one
   * of the view's `modes` falls back to the first of them.
   */
  readonly initialMode?: CalendarMode;
  /** The day ("YYYY-MM-DD") whose month or week the calendar opens on; defaults to today. Read on the first render only. An invalid date falls back to today. */
  readonly initialAnchor?: string;
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

const DEFAULT_MODES: readonly CalendarMode[] = ["month", "week"];
const MODE_LABELS: Record<CalendarMode, string> = { month: "Month", week: "Week" };
const UNTITLED = "(untitled)";

type Loaded = { readonly status: "loaded"; readonly records: readonly DataRecord[]; readonly total: number; readonly truncated: boolean };
/** The state of one range load; `key` names the range it is for, so a stale one is never shown on another range. */
type RangeState = ({ readonly status: "failed"; readonly message: string } | Loaded) & { readonly key: string };

/** An open entry: the target table, with the clicked record's bindings applied, replacing the calendar. */
interface Opened {
  readonly view: TableView;
  readonly heading: string;
}

/**
 * Renders a calendar view: the records of one entity on the days of a month
 * or week, placed by one date field. It loads the visible range through the
 * runtime, builds entries with the fields' Display components and hands days,
 * entries and callbacks to the registry's `layout.Calendar`. There is no drag
 * code here: the component calls `onMove`, and so does its "Move to day…"
 * action. A move is optimistic; any failure puts the entry back, shows the
 * adapter's message and reloads the range (RFC 0004).
 *
 * With a `rowAction`, activating an entry replaces the calendar, in the same
 * container, with the target table filtered by that record and a Back button.
 * The calendar stays mounted (hidden), so Back returns to the same period.
 */
export function CalendarRenderer({ entity: entityProp, view: viewProp, registry, dataSources: dataSourcesProp, entities: entitiesProp, reloadKey, documents: documentsProp, now, viewer: viewerProp, initialMode, initialAnchor, formatting, onChanged }: CalendarRendererProps): ReactNode {
  const entity = useContentStable(entityProp);
  const view = useContentStable(viewProp);
  const dataSources = useContentStable(dataSourcesProp);
  const entities = useContentStable(entitiesProp);
  const documents = useContentStable(documentsProp);
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
      const value = bindingValues(record, entity)[field];
      return value === undefined || value === null || value === "" ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
    };
    const locked = action.bind.map((b) => b.to);
    // The bound fields are fixed by the clicked entry, so their quick filters are not offered (as in a table drill-down).
    const quickFilters = target.quickFilters?.filter((q) => !locked.includes(q.field));
    const { quickFilters: _dropped, filter: _filter, ...rest } = target;
    const filter = bindFilter(bindingValues(record, entity), action.bind, target.filter);
    const chips = action.bind.map((b) => `${targetEntity.fields.find((f) => f.id === b.to)?.label ?? b.to} = ${text(b.field) || "(empty)"}`);
    afterRender.current = () => containerRef.current?.querySelector<HTMLElement>("[data-yadad-drill-heading]")?.focus();
    setOpened({
      view: { ...rest, ...(filter ? { filter } : {}), ...(quickFilters && quickFilters.length > 0 ? { quickFilters } : {}) },
      heading: `${target.title ?? target.id}: ${chips.join(", ")}`,
    });
  };

  const back = (): void => {
    afterRender.current = () => containerRef.current?.querySelector<HTMLElement>("[data-yadad-calendar-view]")?.focus();
    setOpened(undefined);
  };

  if (viewerError) return <ErrorSummary errors={[viewerError]} />;

  return (
    <div ref={containerRef} data-yadad-drill={view.id}>
      <div data-yadad-drill-level={0} {...(opened ? { hidden: true } : {})}>
        <CalendarBody
          entity={entity}
          view={view}
          registry={registry}
          dataSources={dataSources}
          {...(refEntities ? { entities: refEntities } : {})}
          reloadKey={reloadKey}
          {...(now ? { now } : {})}
          extraErrors={actionErrors}
          viewer={viewer}
          {...(initialMode ? { initialMode } : {})}
          {...(initialAnchor !== undefined ? { initialAnchor } : {})}
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

interface CalendarBodyProps {
  readonly entity: EntityDocument;
  readonly view: CalendarView;
  readonly registry: Registry<ReactNode>;
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  readonly reloadKey?: unknown;
  readonly now?: Date;
  readonly extraErrors: readonly DocumentError[];
  readonly viewer: ResolvedViewer;
  readonly onOpen?: (record: DataRecord) => void;
  readonly initialMode?: CalendarMode;
  readonly initialAnchor?: string;
  readonly formatting?: FieldFormatting;
  readonly onChanged?: () => void;
}

const rangeKey = (range: DateRange): string => `${range.first}/${range.last}`;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failed update as the core error list: a 400's issues as they are, anything else one message. */
function moveErrors(error: unknown): DocumentError[] {
  if (error instanceof RecordValidationError) return [...error.issues];
  const code = error instanceof AdapterError ? (error.code === "validation" ? "invalid-value" : error.code) : "invalid-value";
  return [{ path: "", code, message: failureMessage(error), hint: "The entry is back on its day. Reload if the problem stays." }];
}

function CalendarBody({ entity, view, registry, dataSources, entities, reloadKey, now, extraErrors, viewer, onOpen, initialMode, initialAnchor, formatting, onChanged }: CalendarBodyProps): ReactNode {
  const clock = (): Date => now ?? new Date();
  const modes = view.modes ?? DEFAULT_MODES;
  const weekStartsOn = view.weekStartsOn ?? 1;
  const [mode, setMode] = useState<CalendarMode>(() => (initialMode && modes.includes(initialMode) ? initialMode : (modes[0] ?? "month")));
  const [anchor, setAnchor] = useState(() => {
    const today = calendarToday(clock());
    if (initialAnchor === undefined) return today;
    try {
      visibleRange(initialAnchor, "month", 1);
      return initialAnchor;
    } catch {
      return today;
    }
  });
  const [state, setState] = useState<RangeState | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  /** Records whose move is in flight, with the day they were moved to. */
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(new Map());
  /** Records whose completion toggle is in flight, with the value being written (RFC 0008 item 3). */
  const [toggling, setToggling] = useState<ReadonlyMap<string, boolean>>(new Map());
  const inFlight = useRef(new Set<string>());
  const [errors, setErrors] = useState<readonly DocumentError[]>([]);
  const [announcement, setAnnouncement] = useState<{ readonly seq: number; readonly text: string } | undefined>(undefined);

  const adapter = dataSources.get(view.dataSource);
  const editable = viewEditable(view, viewer);
  const range = useMemo(() => visibleRange(anchor, mode, weekStartsOn), [anchor, mode, weekStartsOn]);
  const key = rangeKey(range);

  // One load per range. A response for a range that is no longer current is discarded.
  useEffect(() => {
    if (!adapter) return;
    let current = true;
    loadCalendarRange(adapter, view, range, { entity, now: clock() }).then(
      (load: CalendarLoad) => current && setState({ status: "loaded", key, records: load.records, total: load.total, truncated: load.truncated }),
      (error: unknown) => current && setState({ status: "failed", key, message: failureMessage(error) }),
    );
    return () => {
      current = false;
    };
    // `clock` reads `now`, which is a stable input in practice; the range key stands for `range`.
  }, [adapter, entity, view, key, reloadKey, reloads]);

  // Only a load for the range on screen counts; anything else is "still loading" and shows no entries.
  const here = state && state.key === key ? state : undefined;
  const loadedRecords = here?.status === "loaded" ? here.records : undefined;
  const records = useMemo(
    () =>
      (loadedRecords ?? []).map((r) => {
        const day = pending.get(r.id);
        const done = view.doneField === undefined ? undefined : toggling.get(r.id);
        if (day === undefined && done === undefined) return r;
        const values = { ...r.values };
        if (day !== undefined) values[view.dateField] = day;
        if (done !== undefined && view.doneField !== undefined) values[view.doneField] = done;
        return { ...r, values };
      }),
    [loadedRecords, pending, toggling, view.dateField, view.doneField],
  );

  const titleField = view.titleField ?? entity.fields.find((f) => f.type === "text")?.id;
  const detailFields = (view.detailFields ?? []).flatMap((id) => entity.fields.filter((f) => f.id === id));
  const colorField = view.colorField === undefined ? undefined : entity.fields.find((f) => f.id === view.colorField);
  const referenceFields = [...detailFields, ...(colorField ? [colorField] : [])].filter((f): f is ReferenceField => f.type === "reference");
  const wants = records.flatMap((r) =>
    referenceFields.flatMap((field) => {
      const value = r.values[field.id];
      return typeof value === "string" && value !== "" ? [{ field, id: value }] : [];
    }),
  );
  const references = useReferences(adapter, entities, [], wants, reloadKey);

  const refs = [
    { field: view.dateField, path: ["dateField"] },
    ...(view.titleField ? [{ field: view.titleField, path: ["titleField"] }] : []),
    ...(view.colorField ? [{ field: view.colorField, path: ["colorField"] }] : []),
    ...(view.doneField ? [{ field: view.doneField, path: ["doneField"] }] : []),
    ...(view.detailFields ?? []).map((field, i) => ({ field, path: ["detailFields", i] })),
    ...(view.sort ?? []).map((s, i) => ({ field: s.field, path: ["sort", i, "field"] })),
    ...(view.filter ? conditionFields(view.filter).map((field) => ({ field, path: ["filter"] })) : []),
  ];
  const setupErrors: DocumentError[] = [...checkViewSetup(entity, view, adapter, refs), ...extraErrors, ...recordActionSetupErrors(entity, view, adapter, registry)];
  const dateDef = entity.fields.find((f) => f.id === view.dateField);
  if (dateDef && dateDef.type !== "date") {
    setupErrors.push({ path: "/dateField", code: "invalid-value", message: `Field "${dateDef.id}" is a ${dateDef.type} field, not a date field.`, hint: "Use a date field as dateField." });
  }
  const { Calendar, ErrorSummary, Button } = registry.layout;
  if (!Calendar) {
    setupErrors.push({
      path: "/layout/Calendar",
      code: "required",
      message: `This registry has no layout.Calendar component, so the calendar view ${view.id} cannot be shown.`,
      hint: "Add a layout.Calendar component to the registry.",
    });
  }
  const announce = (text: string): void => setAnnouncement((a) => ({ seq: (a?.seq ?? 0) + 1, text }));
  const recordActions = useRecordActions({ entity, view, viewer, registry, adapter, reload: () => setReloads((n) => n + 1), ...(entities ? { entities } : {}), ...(formatting ? { formatting } : {}), announce, ...(onChanged ? { onChanged } : {}) });
  if (setupErrors.length > 0 || !Calendar) return <ErrorSummary errors={setupErrors} />;

  const navigate = (next: () => void): void => {
    setErrors([]);
    next();
  };

  const recordTitle = (record: DataRecord): string => {
    const field = titleField === undefined ? undefined : entity.fields.find((f) => f.id === titleField);
    const value = field ? record.values[field.id] : undefined;
    return typeof value === "string" && value.trim() !== "" ? value : UNTITLED;
  };

  const plain = (field: Field, record: DataRecord): string => plainText(field, record.values[field.id], references);

  const byDay = groupByDay(records, view.dateField);
  const today = calendarToday(clock());
  const colorOptions = colorField?.type === "select" ? colorField.options.values.map(optionValue) : []; // RFC 0008: card 47a
  const colorOf = (record: DataRecord): { slot: number; label: string; color?: string } | undefined => {
    if (!colorField || (colorField.type !== "select" && colorField.type !== "reference")) return undefined;
    const value = record.values[colorField.id];
    const label = plainText(colorField, value, references);
    // RFC 0008 item 8: a reference colour field with `colorFrom` paints the target's own colour;
    // the stable hash stays the fallback when colorFrom is absent or the record did not load.
    if (colorField.type === "reference" && typeof value === "string" && colorField.colorFrom !== undefined) {
      const resolved = references.display(colorField, value).color;
      if (resolved !== undefined) {
        const slot = colorSlot(value, "reference");
        return slot === undefined ? undefined : { slot, label, color: resolved };
      }
    }
    const slot = colorSlot(value, colorField.type, { options: colorOptions });
    return slot === undefined ? undefined : { slot, label };
  };

  const doneDef = view.doneField === undefined ? undefined : entity.fields.find((f) => f.id === view.doneField && f.type === "boolean");
  const toggleDone = (record: DataRecord): void => {
    if (!doneDef || !adapter || !editable || inFlight.current.has(record.id)) return;
    const title = recordTitle(record);
    const next = record.values[doneDef.id] !== true;
    if (!canEditField(record, doneDef.id)) return; // the server withheld this field (can.fields)
    inFlight.current.add(record.id);
    const endHold = recordActions.holdFocus(record); // the checkbox is disabled while the save runs: give focus back after
    setErrors([]);
    setToggling((t) => new Map(t).set(record.id, next));
    const settle = (): void => {
      endHold();
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
          setState((s) => (s?.status === "loaded" ? { ...s, records: replaceSavedRecord(s.records, record.id, saved) } : s));
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

  const entry = (record: DataRecord): CalendarEntry<ReactNode> => {
    const title = recordTitle(record);
    const color = colorOf(record);
    const isPending = pending.has(record.id);
    const details = detailFields.filter((f) => record.values[f.id] !== undefined && record.values[f.id] !== null && record.values[f.id] !== "");
    return {
      id: record.id,
      content: (
        <>
          <span data-yadad-calendar-title="" data-yadad-record={record.id} data-yadad-record-view={recordActions.viewKey}>{title}</span>
          {details.map((field) => (
            // RFC 0008 item 7: detail lines are labelled by default ("Assignee: Dana").
            <small key={field.id} data-yadad-calendar-detail={field.id}>
              <span data-yadad-calendar-detail-label="">{`${field.label}: `}</span>
              {renderDisplay(registry, field, record.values[field.id], references, formatting)}
            </small>
          ))}
        </>
      ),
      label: [title, ...details.map((f) => `${f.label}: ${plain(f, record)}`), ...(color ? [color.label] : [])].join(", "),
      ...(color ? { color } : {}),
      movable: editable && canMoveColumn(record, view.dateField) && !isPending, // RFC 0008 item 9: can.fields narrows the drag
      pending: isPending,
      ...(doneDef === undefined
        ? {}
        : { done: { checked: record.values[doneDef.id] === true, disabled: !editable || !canEditField(record, doneDef.id) || toggling.has(record.id), toggle: () => toggleDone(record) } }),
      actions: recordActions.items(record, String(record.values[view.dateField] ?? "")),
    };
  };

  // RFC 0008 item 7: the renderer resolves maxEntriesPerDay (default 3) into the day's overflow
  // policy; the entries stay all there — slicing and the "+N more" disclosure are the component's.
  const maxEntries = view.maxEntriesPerDay ?? CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT;
  const days = visibleDays(anchor, mode, weekStartsOn, today).map((day) => {
    const entries = (byDay.get(day.date) ?? []).map(entry);
    const hidden = Math.max(0, entries.length - maxEntries);
    return {
      ...day,
      label: dayLabel(day.date),
      entries,
      ...(hidden > 0 ? { overflow: { shown: maxEntries, hidden } } : {}),
    };
  });

  // The legend lists what is on screen: select values in option order, references by label.
  const legend = (() => {
    if (!colorField) return [];
    const shown = days.flatMap((d) => d.entries).flatMap((e) => (e.color ? [e.color] : []));
    const unique = [...new Map(shown.map((c) => [c.label, c])).values()];
    if (colorField.type === "select") {
      const labels = colorField.options.values.map(optionLabel);
      return unique.sort((a, b) => labels.indexOf(a.label) - labels.indexOf(b.label));
    }
    return unique.sort((a, b) => a.label.localeCompare(b.label));
  })();

  const move = (recordId: string, day: string): void => {
    const record = loadedRecords?.find((r) => r.id === recordId);
    if (!record || !adapter || !editable || !canMoveColumn(record, view.dateField) || inFlight.current.has(recordId)) return;
    const title = recordTitle(record);
    let plan;
    try {
      plan = moveDay(view, entity, record, day);
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
    setPending((p) => new Map(p).set(recordId, day));
    const endHold = recordActions.holdFocus(record, { moved: true }); // a deliberate move: focus follows the entry to its new day
    const settle = (): void => {
      endHold();
      inFlight.current.delete(recordId);
      setPending((p) => {
        const next = new Map(p);
        next.delete(recordId);
        return next;
      });
    };
    adapter.update(plan.entity, plan.id, plan.patch, plan.meta).then(
      (saved) => {
        setState((s) => (s?.status === "loaded" ? { ...s, records: replaceSavedRecord(s.records, recordId, saved) } : s));
        settle();
        announce(`Moved ${title} to ${dayLabel(day)}`);
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

  const offersWeek = modes.includes("week") && mode !== "week";
  const notice =
    here?.status === "loaded" && here.truncated ? (
      <p data-yadad-calendar-notice="">
        Showing the first {NUMBER.format(here.records.length)} of {NUMBER.format(here.total)} entries in this range. {offersWeek ? "Switch to a week or narrow the filter." : "Narrow the filter."}
      </p>
    ) : undefined;

  // Opens on today: once, when the first range has loaded, bring today's cell into
  // view (on a phone the row is often below the fold). The component owns the
  // scroll container, so the renderer asks the browser to scroll the cell's own
  // ancestors, and never again: navigation and the viewer's scrolling are left alone.
  const viewRef = useRef<HTMLDivElement>(null);
  const scrolledToToday = useRef(false);
  const firstLoaded = here?.status === "loaded";
  useEffect(() => {
    if (!firstLoaded || scrolledToToday.current) return;
    scrolledToToday.current = true;
    const todayCell = viewRef.current?.querySelector<HTMLElement>('[aria-current="date"], [data-today="true"]');
    if (typeof todayCell?.scrollIntoView === "function") todayCell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [firstLoaded]);

  return (
    <div ref={viewRef} data-yadad-calendar-view={view.id} tabIndex={-1}>
      {here?.status === "failed" && (
        <div data-yadad-calendar-load-error="">
          <ErrorSummary errors={[loadFailure(here.message)]} />
          <Button label="Retry" type="button" variant="secondary" disabled={false} onPress={() => setReloads((n) => n + 1)} />
        </div>
      )}
      {errors.length > 0 && <ErrorSummary errors={[...errors]} />}
      <Calendar
        label={view.title ?? entity.id}
        title={periodTitle(anchor, mode, weekStartsOn)}
        mode={mode}
        modes={modes.map((m) => ({ mode: m, label: MODE_LABELS[m] }))}
        weekdays={weekdayLabels(weekStartsOn)}
        days={days}
        legend={legend.map(({ slot, label, color }) => (color === undefined ? { slot, label } : { slot, label, color }))}
        loading={here === undefined}
        {...(notice ? { notice } : {})}
        {...(announcement ? { announcement } : {})}
        onModeChange={(next) => navigate(() => setMode(next))}
        onPrevious={() => navigate(() => setAnchor((a) => shiftAnchor(a, mode, -1)))}
        onNext={() => navigate(() => setAnchor((a) => shiftAnchor(a, mode, 1)))}
        onToday={() => navigate(() => setAnchor(calendarToday(clock())))}
        {...(onOpen
          ? {
              onOpenEntry: (id: string) => {
                const record = loadedRecords?.find((r) => r.id === id);
                if (record) onOpen(record);
              },
            }
          : {})}
        {...(editable ? { onMove: move } : {})}
      />
      {recordActions.failures !== undefined && <ErrorSummary errors={recordActions.failures} />}
      {recordActions.dialog}
    </div>
  );
}

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

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
