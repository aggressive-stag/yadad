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
  StatWidget,
  TableView,
  ViewDocument,
} from "@yadad/core";
import { conditionFields, jsonPointer } from "@yadad/core";
import { aggregate } from "@yadad/runtime";
import type { AggregateResult } from "@yadad/runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { FormRenderer } from "./form-renderer.js";
import type { FormRendererProps } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

/** The documents a dashboard can refer to, by id. */
export interface DocumentSet {
  readonly entities: ReadonlyMap<string, EntityDocument>;
  readonly views: ReadonlyMap<string, ViewDocument>;
}

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
export function DashboardRenderer({ dashboard, documents, registry, dataSources, stackBelow = DEFAULT_STACK_BELOW, drafts }: DashboardRendererProps): ReactNode {
  const [rootRef, width] = useWidth();
  const [selected, setSelected] = useState(dashboard.tabs[0]?.id ?? "");
  const [reloadKey, setReloadKey] = useState(0);
  const { Tabs, Panel, ErrorSummary } = registry.layout;

  const setupErrors = checkDashboard(dashboard, documents, dataSources);
  if (setupErrors.length > 0) return <ErrorSummary errors={setupErrors} />;

  const tab = dashboard.tabs.find((t) => t.id === selected) ?? dashboard.tabs[0];
  if (!tab) return null;
  const stacked = width !== undefined && width < stackBelow;
  const columns = stacked ? 1 : (tab.columns ?? DEFAULT_COLUMNS);

  const renderWidget = (item: GridItem): ReactNode => {
    const view = documents.views.get(item.view);
    const entity = view && view.kind !== "dashboard" ? documents.entities.get(view.entity) : undefined;
    if (!view || !entity) return null; // reported by checkDashboard
    if (item.widget === "count" || item.widget === "stat") {
      return view.kind === "table" ? <CountLoader widget={item} view={view} entity={entity} registry={registry} dataSources={dataSources} reloadKey={reloadKey} /> : null;
    }
    if (view.kind === "form") {
      return <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={documents.entities} onSaved={() => setReloadKey((k) => k + 1)} {...(drafts ? { drafts } : {})} />;
    }
    if (view.kind === "table") {
      return <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={documents.entities} reloadKey={reloadKey} />;
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
      {[...tab.items].sort(readingOrder).map((item) => (
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
      <Tabs label={dashboard.title ?? dashboard.id} tabs={dashboard.tabs.map((t) => ({ id: t.id, title: t.title }))} selected={tab.id} onSelect={setSelected} panel={grid} />
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
    return <ErrorSummary errors={[{ path: "", code: "invalid-value", message: `Could not load records: ${failure}`, hint: "Reload the page or try again later." }]} />;
  }
  if (widget.widget === "count") return <Count label={widget.label} value={result?.total} />;
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

/** Every widget must point at a view that exists and fits it, with its entity and data source. */
function checkDashboard(dashboard: DashboardView, documents: DocumentSet, dataSources: ReadonlyMap<string, DataAdapter>): DocumentError[] {
  const errors: DocumentError[] = [];
  const add = (path: (string | number)[], message: string, hint: string) => errors.push({ path: jsonPointer(path), code: "invalid-value", message, hint });
  dashboard.tabs.forEach((tab, i) =>
    tab.items.forEach((item, j) => {
      const path = ["tabs", i, "items", j];
      const view = documents.views.get(item.view);
      if (!view) return add([...path, "view"], `No view with id "${item.view}".`, `Use one of: ${[...documents.views.keys()].join(", ")}.`);
      if (view.kind === "dashboard") return add([...path, "view"], `"${item.view}" is a dashboard; dashboards cannot be nested.`, "Embed a form or table view.");
      if ((item.widget === "count" || item.widget === "stat") && view.kind !== "table") return add([...path, "view"], `A ${item.widget} widget needs a table view; "${item.view}" is a ${view.kind}.`, "Point it at a table view.");
      const entity = documents.entities.get(view.entity);
      if (!entity) return add([...path, "view"], `View "${view.id}" is for entity "${view.entity}", which is not loaded.`, "Load that entity document.");
      if (!dataSources.has(view.dataSource)) add([...path, "view"], `View "${view.id}" uses data source "${view.dataSource}", which was not provided.`, "Add it to the dataSources the host passes in.");
      if ((item.widget === "count" || item.widget === "stat") && item.filter) {
        for (const field of conditionFields(item.filter)) {
          if (!entity.fields.some((f) => f.id === field)) add([...path, "filter"], `Field "${field}" does not exist on entity "${entity.id}".`, `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`);
        }
      }
      if (item.widget === "stat") {
        for (const field of measureFields(item.measure)) {
          if (!entity.fields.some((f) => f.id === field)) add([...path, "measure"], `Field "${field}" does not exist on entity "${entity.id}".`, `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`);
        }
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
