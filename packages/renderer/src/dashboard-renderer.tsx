import type {
  Condition,
  CountWidget,
  DashboardView,
  DataAdapter,
  DocumentError,
  EntityDocument,
  GridItem,
  Registry,
  TableView,
  ViewDocument,
} from "@yadad/core";
import { conditionFields, jsonPointer } from "@yadad/core";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FormRenderer } from "./form-renderer";
import { TableRenderer } from "./table-renderer";

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
}

const DEFAULT_COLUMNS = 12;

/**
 * Renders a dashboard: tabs from the registry, each a CSS grid of widgets
 * placed by x, y, w, h. Rows have a fixed height (--yadad-grid-row-height,
 * default 4rem), so h is a real number of rows as in react-grid-layout; a
 * widget taller than its area scrolls inside its Panel. The gap is
 * --yadad-grid-gap. Saving a form anywhere on the dashboard reloads its
 * tables and counts.
 */
export function DashboardRenderer({ dashboard, documents, registry, dataSources }: DashboardRendererProps): ReactNode {
  const [selected, setSelected] = useState(dashboard.tabs[0]?.id ?? "");
  const [reloadKey, setReloadKey] = useState(0);
  const { Tabs, Panel, ErrorSummary } = registry.layout;

  const setupErrors = checkDashboard(dashboard, documents, dataSources);
  if (setupErrors.length > 0) return <ErrorSummary errors={setupErrors} />;

  const tab = dashboard.tabs.find((t) => t.id === selected) ?? dashboard.tabs[0];
  if (!tab) return null;
  const columns = tab.columns ?? DEFAULT_COLUMNS;

  const renderWidget = (item: GridItem): ReactNode => {
    const view = documents.views.get(item.view);
    const entity = view && view.kind !== "dashboard" ? documents.entities.get(view.entity) : undefined;
    if (!view || !entity) return null; // reported by checkDashboard
    if (item.widget === "count") {
      return view.kind === "table" ? <CountLoader widget={item} view={view} entity={entity} registry={registry} dataSources={dataSources} reloadKey={reloadKey} /> : null;
    }
    if (view.kind === "form") {
      return <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} onSaved={() => setReloadKey((k) => k + 1)} />;
    }
    if (view.kind === "table") {
      return <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} reloadKey={reloadKey} />;
    }
    return null;
  };

  const grid = (
    <div
      data-yadad-grid={tab.id}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: "var(--yadad-grid-row-height, 4rem)",
        gap: "var(--yadad-grid-gap, 1rem)",
      }}
    >
      {tab.items.map((item) => (
        <div key={item.id} data-yadad-grid-item={item.id} style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}`, minWidth: 0 }}>
          <Panel>{renderWidget(item)}</Panel>
        </div>
      ))}
    </div>
  );

  return (
    <div data-yadad-dashboard={dashboard.id}>
      <Tabs label={dashboard.title ?? dashboard.id} tabs={dashboard.tabs.map((t) => ({ id: t.id, title: t.title }))} selected={tab.id} onSelect={setSelected} panel={grid} />
    </div>
  );
}

function CountLoader({
  widget,
  view,
  entity,
  registry,
  dataSources,
  reloadKey,
}: {
  widget: CountWidget;
  view: TableView;
  entity: EntityDocument;
  registry: Registry<ReactNode>;
  dataSources: ReadonlyMap<string, DataAdapter>;
  reloadKey: number;
}): ReactNode {
  const [value, setValue] = useState<number | undefined>(undefined);
  const adapter = dataSources.get(view.dataSource);
  const filter = useMemo((): Condition | undefined => {
    const parts = [view.filter, widget.filter].filter((c): c is Condition => c !== undefined);
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", conditions: parts };
  }, [view.filter, widget.filter]);

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    adapter
      .find(entity.id, { page: { offset: 0, limit: 0 }, ...(filter ? { filter } : {}) })
      .then((page) => current && setValue(page.total))
      .catch(() => current && setValue(undefined));
    return () => {
      current = false;
    };
  }, [adapter, entity.id, filter, reloadKey]);

  const Count = registry.widgets.count;
  return <Count label={widget.label} value={value} />;
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
      if (view.kind === "dashboard") return add([...path, "view"], `"${item.view}" is a dashboard; dashboards cannot be nested.`, "Embed a form or table view.");
      if (item.widget === "count" && view.kind !== "table") return add([...path, "view"], `A count widget needs a table view; "${item.view}" is a ${view.kind}.`, "Point it at a table view.");
      const entity = documents.entities.get(view.entity);
      if (!entity) return add([...path, "view"], `View "${view.id}" is for entity "${view.entity}", which is not loaded.`, "Load that entity document.");
      if (!dataSources.has(view.dataSource)) add([...path, "view"], `View "${view.id}" uses data source "${view.dataSource}", which was not provided.`, "Add it to the dataSources the host passes in.");
      if (item.widget === "count" && item.filter) {
        for (const field of conditionFields(item.filter)) {
          if (!entity.fields.some((f) => f.id === field)) add([...path, "filter"], `Field "${field}" does not exist on entity "${entity.id}".`, `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`);
        }
      }
      return undefined;
    }),
  );
  return errors;
}
