import type {
  Condition,
  CountWidget,
  DashboardView,
  DataAdapter,
  DocumentError,
  EntityDocument,
  GridItem,
  Measure,
  Registry,
  ResolvedViewer,
  SeriesWidget,
  StatWidget,
  TableView,
} from "@yadad/core";
import { conditionFields, jsonPointer } from "@yadad/core";
import { AGGREGATE_MAX_RECORDS, aggregate, aggregateSeries, visibleItems, visibleTabs } from "@yadad/runtime";
import type { AggregateResult, SeriesResult, SeriesSpec } from "@yadad/runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadFailure } from "./load-state.js";
import type { ReactNode, RefObject } from "react";
import type { DocumentSet } from "./document-set.js";
import type { FieldFormatting } from "./fields.js";
import { BoardRenderer } from "./board-renderer.js";
import { CalendarRenderer } from "./calendar-renderer.js";
import { FormRenderer } from "./form-renderer.js";
import type { FormRendererProps } from "./form-renderer.js";
import { useReferences } from "./references.js";
import type { DrillStep } from "./table-renderer.js";
import { TableRenderer } from "./table-renderer.js";
import { useViewerSetup } from "./viewer.js";
import { useContentStable } from "./use-stable.js";

export interface DashboardRendererProps {
  readonly dashboard: DashboardView;
  readonly documents: DocumentSet;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by each view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  /** Below this width in pixels the grid stacks into one full-width column. Defaults to 640. */
  readonly stackBelow?: number;
  /** Passed to every embedded form: opt-in drafts of unsaved input. */
  readonly drafts?: FormRendererProps["drafts"];
  /**
   * Who is viewing (RFC 0006), from `resolveViewer`. Tabs and widgets the viewer
   * may not see are not rendered, and the viewer is passed unchanged to every
   * view the dashboard embeds. Without it, the document set's viewer document
   * is used at its defaults; a dashboard that reads a viewer fact and cannot
   * find the document shows an error.
   */
  readonly viewer?: ResolvedViewer;
  /** The viewer's locale and zone for datetime fields (RFC 0007), passed to every embedded view; absent, the environment's. */
  readonly formatting?: FieldFormatting;
  /**
   * The tab selected on the first render. Only the first render reads it:
   * after that the viewer's choice wins. An id that names no tab, or a tab
   * this viewer may not see, falls back to the first visible tab. This is
   * what a states preview passes to open a dashboard on another tab without
   * taking control of the selection.
   */
  readonly initialTab?: string;
  /**
   * The selected tab, controlled (RFC 0011 item 1), shaped like `drills`: the
   * host owns it and the renderer shows it, so update it in `onTabChange`.
   * Unset, the renderer keeps its own selection, seeded by `initialTab`. An id
   * that names no tab, or a tab this viewer may not see, falls back to the
   * first visible tab and the fallback is reported through `onTabChange`.
   * Restoring a drill never changes the tab; the host owns both.
   */
  readonly tab?: string;
  /** Called with the tab id when the viewer picks a tab, and when a supplied `tab` fell back to the first visible one. */
  readonly onTabChange?: (tab: string) => void;
  /**
   * Controlled drill-downs of the table widgets (RFC 0010 item 1), keyed by
   * grid item id: each entry is that widget's `drill` as `TableRenderer`
   * takes it. A widget with no entry keeps its private stack, unless
   * `onDrillChange` is set; then it starts at the top level. Entries for
   * widgets on other tabs are left alone.
   */
  readonly drills?: Readonly<Record<string, readonly DrillStep[]>>;
  /** Called with the grid item id and that widget's whole new drill. */
  readonly onDrillChange?: (itemId: string, drill: readonly DrillStep[]) => void;
}

const DEFAULT_COLUMNS = 12;
const DEFAULT_STACK_BELOW = 640;

/** Reading order: top to bottom, then left to right. DOM order follows it, so screen readers and Tab do too. */
const readingOrder = (a: GridItem, b: GridItem) => a.y - b.y || a.x - b.x;

/** The element's width, tracked with ResizeObserver; undefined where that is unavailable (e.g. jsdom without a stub). */
function useWidth(): [RefObject<HTMLDivElement | null>, number | undefined] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Renders a dashboard: tabs from the registry, each a CSS grid of widgets
 * placed by x, y, w, h. Rows have a fixed height (--yadad-grid-row-height,
 * default 4rem), so h is a real number of rows as in react-grid-layout; a
 * widget taller than its area scrolls inside its Panel. The gap is
 * --yadad-grid-gap. Narrower than `stackBelow`, the items stack into one
 * full-width column in reading order. Saving a form anywhere on the
 * dashboard reloads its tables, counts and stats.
 */
export function DashboardRenderer({ dashboard: dashboardProp, documents: documentsProp, registry, dataSources: dataSourcesProp, stackBelow = DEFAULT_STACK_BELOW, drafts, viewer: viewerProp, formatting, initialTab, tab: tabProp, onTabChange, drills: drillsProp, onDrillChange }: DashboardRendererProps): ReactNode {
  const dashboard = useContentStable(dashboardProp);
  const documents = useContentStable(documentsProp);
  const dataSources = useContentStable(dataSourcesProp);
  const drills = useContentStable(drillsProp);
  const { viewer, error: viewerError } = useViewerSetup(viewerProp, dashboard, documents);
  const tabs = useMemo(() => visibleTabs(dashboard, viewer), [dashboard, viewer]);
  const [rootRef, width] = useWidth();
  // `initialTab` seeds the selection; a name that matches no visible tab falls back to the first one below.
  const [selected, setSelected] = useState(initialTab ?? tabs[0]?.id ?? "");
  const selectedId = tabProp ?? selected;
  const shownId = tabs.find((t) => t.id === selectedId)?.id ?? tabs[0]?.id;
  // A supplied tab the viewer cannot see: report the fallback so the host's state agrees with the screen.
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  useEffect(() => {
    if (tabProp !== undefined && shownId !== undefined && shownId !== tabProp) onTabChangeRef.current?.(shownId);
  }, [tabProp, shownId]);
  const selectTab = (id: string): void => {
    if (tabProp === undefined) setSelected(id);
    onTabChange?.(id);
  };
  const [reloadKey, setReloadKey] = useState(0);
  // One bump for every successful write in any widget: a form save (onSaved)
  // and a write inside a table/board/calendar (onChanged) both go through it.
  // A reload never calls onChanged back, so this cannot loop.
  const bump = (): void => setReloadKey((k) => k + 1);
  const { Tabs, Panel, ErrorSummary } = registry.layout;

  const setupErrors = [...checkDashboard(dashboard, documents, dataSources), ...(viewerError ? [viewerError] : [])];
  if (setupErrors.length > 0) return <ErrorSummary errors={setupErrors} />;

  const tab = tabs.find((t) => t.id === selectedId) ?? tabs[0];
  if (!tab) return <p data-yadad-dashboard-nothing="">There is nothing to show you here.</p>;
  const stacked = width !== undefined && width < stackBelow;
  const columns = stacked ? 1 : (tab.columns ?? DEFAULT_COLUMNS);

  const drillProps = (id: string): { drill?: readonly DrillStep[]; onDrillChange?: (drill: readonly DrillStep[]) => void } => {
    const own = drills?.[id];
    const drill = own ?? (onDrillChange ? [] : undefined);
    return { ...(drill !== undefined ? { drill } : {}), ...(onDrillChange ? { onDrillChange: (d: readonly DrillStep[]) => onDrillChange(id, d) } : {}) };
  };
  const renderWidget = (item: GridItem): ReactNode => {
    const view = documents.views.get(item.view);
    const entity = view && view.kind !== "dashboard" ? documents.entities.get(view.entity) : undefined;
    if (!view || !entity) return null; // reported by checkDashboard
    if (item.widget === "count" || item.widget === "stat") {
      return view.kind === "table" ? <CountLoader widget={item} view={view} entity={entity} registry={registry} dataSources={dataSources} reloadKey={reloadKey} /> : null;
    }
    if (item.widget === "series") {
      return view.kind === "table" ? (
        <SeriesLoader widget={item} itemId={item.id} view={view} entity={entity} registry={registry} dataSources={dataSources} entities={documents.entities} reloadKey={reloadKey} {...(formatting ? { formatting } : {})} />
      ) : null;
    }
    if (view.kind === "form") {
      return <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} viewer={viewer} entities={documents.entities} onSaved={() => setReloadKey((k) => k + 1)} {...(drafts ? { drafts } : {})} {...(formatting ? { formatting } : {})} />;
    }
    if (view.kind === "table") {
      return <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={documents.entities} documents={documents} reloadKey={reloadKey} viewer={viewer} {...(formatting ? { formatting } : {})} onChanged={bump} {...(drafts !== undefined ? { drafts } : {})} {...drillProps(item.id)} />;
    }
    if (view.kind === "calendar") {
      return <CalendarRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={documents.entities} documents={documents} reloadKey={reloadKey} viewer={viewer} {...(formatting ? { formatting } : {})} onChanged={bump} />;
    }
    if (view.kind === "board") {
      // The group-by choice is uncontrolled inside a cell (RFC 0005).
      return <BoardRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={documents.entities} documents={documents} reloadKey={reloadKey} viewer={viewer} {...(formatting ? { formatting } : {})} onChanged={bump} />;
    }
    return null;
  };

  const grid = (
    <div
      data-yadad-grid={tab.id}
      data-yadad-grid-stacked={stacked ? "" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        // Stacked cards size to their content; fixed rows only matter side by side.
        gridAutoRows: stacked ? "auto" : "var(--yadad-grid-row-height, 4rem)",
        gap: "var(--yadad-grid-gap, 1rem)",
      }}
    >
      {[...visibleItems(tab, viewer)].sort(readingOrder).map((item) => (
        <div
          key={`${tab.id}/${item.id}`}
          data-yadad-grid-item={item.id}
          style={
            stacked
              ? { gridColumn: "1 / -1", minWidth: 0 }
              : { gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}`, minWidth: 0 }
          }
        >
          <Panel>{renderWidget(item)}</Panel>
        </div>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} data-yadad-dashboard={dashboard.id}>
      {tabs.length === 1 ? (
        // One tab: the strip would repeat the page title and push content down on a phone. The
        // grid keeps a named landmark instead, so the page does not lose the region.
        <section aria-label={dashboard.title ?? dashboard.id}>{grid}</section>
      ) : (
        <Tabs label={dashboard.title ?? dashboard.id} tabs={tabs.map((t) => ({ id: t.id, title: t.title }))} selected={tab.id} onSelect={selectTab} panel={grid} />
      )}
    </div>
  );
}

const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const NO_VALUE = "\u2014";

/** A stat's value as text: grouped digits, at most two decimals, a dash for nothing. */
function formatStat(value: AggregateResult["value"]): string {
  if (value === undefined) return NO_VALUE;
  return typeof value === "number" ? NUMBER_FORMAT.format(value) : value;
}

/** Loads a count or a stat and shows it through the registry's count component (a labelled number). */
function CountLoader({
  widget,
  view,
  entity,
  registry,
  dataSources,
  reloadKey,
}: {
  widget: CountWidget | StatWidget;
  view: TableView;
  entity: EntityDocument;
  registry: Registry<ReactNode>;
  dataSources: ReadonlyMap<string, DataAdapter>;
  reloadKey: number;
}): ReactNode {
  const [result, setResult] = useState<AggregateResult | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const adapter = dataSources.get(view.dataSource);
  const filter = useMemo((): Condition | undefined => {
    const parts = [view.filter, widget.filter].filter((c): c is Condition => c !== undefined);
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", conditions: parts };
  }, [view.filter, widget.filter]);
  const measure: Measure = widget.widget === "stat" ? widget.measure : COUNT;
  // Stable across renders while the document is unchanged.
  const measureKey = JSON.stringify(measure);

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    // aggregate() turns relative dates into fixed ones, so the adapter (and any server) never sees them.
    aggregate(adapter, entity.id, JSON.parse(measureKey) as Measure, filter ? { filter } : {})
      .then((next) => {
        if (!current) return;
        setFailure(undefined);
        setResult(next);
      })
      .catch((error: unknown) => {
        if (!current) return;
        setResult(undefined);
        setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
    };
  }, [adapter, entity.id, filter, measureKey, reloadKey]);

  const Count = registry.widgets.count;
  if (failure !== undefined) {
    const { ErrorSummary } = registry.layout;
    return <ErrorSummary errors={[loadFailure(failure)]} />;
  }
  if (widget.widget === "count") {
    // A counting server answers `total` in one read; a counting-free one walked pages up to the cap, and the cap with more pending shows "5000+" (RFC 0007).
    const capped = result !== undefined && result.partial && result.read === AGGREGATE_MAX_RECORDS;
    return <Count label={widget.label} value={result?.total} {...(capped ? { text: `${NUMBER_FORMAT.format(AGGREGATE_MAX_RECORDS)}+` } : {})} />;
  }
  const value = typeof result?.value === "number" ? result.value : undefined;
  return (
    <>
      <Count label={widget.label} value={value} {...(result ? { text: formatStat(result.value) } : {})} />
      {result?.partial ? (
        <small data-yadad-stat-partial="" role="note">
          Partial: the first {NUMBER_FORMAT.format(result.read)} of {NUMBER_FORMAT.format(result.total)} records.
        </small>
      ) : null}
    </>
  );
}

const COUNT: Measure = { op: "count" };

/** A date series' group label, formatted for the viewer (card 43f): short day, "Week of <date>", "<Month YYYY>". */
function seriesDateLabel(key: string, bucket: "day" | "week" | "month", formatting: FieldFormatting | undefined): string {
  // A date is a calendar date: format it in UTC so the host's zone cannot shift it a day.
  const locale = formatting?.locale;
  if (bucket === "month") return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
  const short = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
  return bucket === "week" ? `Week of ${short}` : short;
}

/** What each group's number is, in words — the value-axis label the chart shows (RFC 0001 slice 2, decision 6). */
export function measureLabel(measure: Measure): string {
  switch (measure.op) {
    case "count":
      return "Count";
    case "countDistinct":
      return `Distinct ${measure.field}`;
    case "min":
      return `Minimum ${measure.field}`;
    case "max":
      return `Maximum ${measure.field}`;
    case "sum":
    case "avg": {
      const what = measure.op === "sum" ? "Sum" : "Average";
      return "product" in measure ? `${what} of ${measure.product[0]} \u00d7 ${measure.product[1]}` : `${what} of ${measure.field}`;
    }
  }
}

/**
 * Loads a series and hands the registry's `widgets.series` its ready-to-draw
 * props (RFC 0001 slice 2): the engine computes groups, buckets, gaps and the
 * cap through `aggregateSeries`, and this loader adds only what needs a document
 * or a locale — group labels (select/text raw, boolean Yes/No, dates formatted,
 * reference ids resolved through the references hook) and the measure's words.
 * The component draws; nothing here does. With no `widgets.series` in the
 * registry the widget names the missing key, as a missing `layout.Calendar` does.
 */
function SeriesLoader({
  widget,
  itemId,
  view,
  entity,
  registry,
  dataSources,
  entities,
  formatting,
  reloadKey,
}: {
  widget: SeriesWidget;
  /** The grid item's id, for error paths. */
  itemId: string;
  view: TableView;
  entity: EntityDocument;
  registry: Registry<ReactNode>;
  dataSources: ReadonlyMap<string, DataAdapter>;
  entities: ReadonlyMap<string, EntityDocument>;
  formatting?: FieldFormatting;
  reloadKey: number;
}): ReactNode {
  const [result, setResult] = useState<SeriesResult | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const adapter = dataSources.get(view.dataSource);
  const filter = useMemo((): Condition | undefined => {
    const parts = [view.filter, widget.filter].filter((c): c is Condition => c !== undefined);
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", conditions: parts };
  }, [view.filter, widget.filter]);
  const groupField = entity.fields.find((f) => f.id === widget.groupBy.field);
  const spec: SeriesSpec = useMemo(
    () => ({
      groupBy: { ...widget.groupBy, type: groupField?.type === "date" ? "date" : groupField?.type === "boolean" ? "boolean" : groupField?.type === "reference" ? "reference" : "text" },
      measure: widget.measure,
      ...(widget.sort ? { sort: widget.sort } : {}),
      ...(widget.limit !== undefined ? { limit: widget.limit } : {}),
    }),
    // The document is stable; stringify keeps the effect's identity honest.
    [JSON.stringify(widget.groupBy), JSON.stringify(widget.measure), JSON.stringify(widget.sort ?? null), widget.limit ?? null, groupField?.type],
  );

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    aggregateSeries(adapter, entity.id, spec, filter ? { filter } : {})
      .then((next) => {
        if (!current) return;
        setFailure(undefined);
        setResult(next);
      })
      .catch((error: unknown) => {
        if (!current) return;
        setResult(undefined);
        setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
    };
  }, [adapter, entity.id, spec, filter, reloadKey]);

  // Reference groups label through the same hook the tables use, so the 39b
  // unwired-target warning fires the same way when the host forgot an entity.
  const referenceField = groupField?.type === "reference" ? groupField : undefined;
  const wants = useMemo(
    () => (referenceField && result ? result.groups.map((g) => ({ field: referenceField, id: g.key })) : []),
    [referenceField, result],
  );
  const references = useReferences(adapter, entities, [], wants, reloadKey);

  const { ErrorSummary } = registry.layout;
  if (failure !== undefined) {
    return <ErrorSummary errors={[loadFailure(failure)]} />;
  }
  const Series = registry.widgets.series;
  if (!Series) {
    return (
      <ErrorSummary
        errors={[{ path: "/widgets/series", code: "required", message: `This registry has no widgets.series component, so the series widget ${itemId} cannot be drawn.`, hint: "Add a widgets.series component to the registry." }]}
      />
    );
  }

  const bucket = widget.groupBy.bucket ?? "day";
  const groups = (result?.groups ?? []).map((g) => ({
    key: g.key,
    label:
      groupField?.type === "boolean"
        ? g.key === "true"
          ? "Yes"
          : "No"
        : groupField?.type === "date"
          ? seriesDateLabel(g.key, bucket, formatting)
          : referenceField
            ? references.display(referenceField, g.key).label
            : g.key,
    value: g.value,
    text: g.value === undefined ? NO_VALUE : NUMBER_FORMAT.format(g.value),
  }));

  return <Series label={widget.label} display={widget.display} groups={groups} skipped={result?.skipped ?? 0} {...(result?.partial ? { partial: result.partial } : {})} loading={result === undefined} measureLabel={measureLabel(widget.measure)} aggregation={widget.measure.op} />;
}

/** Every widget must point at a view that exists and fits it, with its entity and data source. */
function checkDashboard(dashboard: DashboardView, documents: DocumentSet, dataSources: ReadonlyMap<string, DataAdapter>): DocumentError[] {
  const errors: DocumentError[] = [];
  const add = (path: (string | number)[], message: string, hint: string) => errors.push({ path: jsonPointer(path), code: "invalid-value", message, hint });
  dashboard.tabs.forEach((tab, i) =>
    tab.items.forEach((item, j) => {
      const path = ["tabs", i, "items", j];
      const view = documents.views.get(item.view);
      if (!view) return add([...path, "view"], `No view with id "${item.view}".`, `Use one of: ${[...documents.views.keys()].join(", ")}.`);
      if (view.kind === "dashboard") return add([...path, "view"], `"${item.view}" is a dashboard; dashboards cannot be nested.`, "Embed a form, table or calendar view.");
      if ((item.widget === "count" || item.widget === "stat" || item.widget === "series") && view.kind !== "table") return add([...path, "view"], `A ${item.widget} widget needs a table view; "${item.view}" is a ${view.kind}.`, "Point it at a table view.");
      const entity = documents.entities.get(view.entity);
      if (!entity) return add([...path, "view"], `View "${view.id}" is for entity "${view.entity}", which is not loaded.`, "Load that entity document.");
      if (!dataSources.has(view.dataSource)) add([...path, "view"], `View "${view.id}" uses data source "${view.dataSource}", which was not provided.`, "Add it to the dataSources the host passes in.");
      if ((item.widget === "count" || item.widget === "stat" || item.widget === "series") && item.filter) {
        for (const field of conditionFields(item.filter)) {
          if (!entity.fields.some((f) => f.id === field)) add([...path, "filter"], `Field "${field}" does not exist on entity "${entity.id}".`, `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`);
        }
      }
      if (item.widget === "stat" || item.widget === "series") {
        for (const field of measureFields(item.measure)) {
          if (!entity.fields.some((f) => f.id === field)) add([...path, "measure"], `Field "${field}" does not exist on entity "${entity.id}".`, `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`);
        }
      }
      if (item.widget === "series" && !entity.fields.some((f) => f.id === item.groupBy.field)) {
        add([...path, "groupBy"], `Field "${item.groupBy.field}" does not exist on entity "${entity.id}".`, `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`);
      }
      return undefined;
    }),
  );
  return errors;
}

function measureFields(measure: Measure): readonly string[] {
  if (measure.op === "count") return [];
  return "product" in measure ? measure.product : [measure.field];
}
