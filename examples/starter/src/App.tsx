import { useEffect, useMemo, useState } from "react";
import type { DataAdapter, DataRecord, ViewDocument } from "@yadad/core";
import { baseRegistry } from "@yadad/components";
import { BoardRenderer, CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer } from "@yadad/renderer";
import { docSet, entities, navViews, titleOf } from "./documents";

const fromHash = (): string => window.location.hash.replace(/^#\/?/, "") || navViews[0]!.id;
const prefersDark = (): boolean => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

type Registry = typeof baseRegistry;

/** One view document, drawn by the renderer for its kind. The registry is injectable so tests can pass a mock. */
export function View({ view, dataSources, registry = baseRegistry }: { view: ViewDocument; dataSources: Map<string, DataAdapter>; registry?: Registry }) {
  const [saves, setSaves] = useState(0);
  const [filter, setFilter] = useState<string | undefined>(); // which saved filter chip is lit is the host's state
  const [saved, setSaved] = useState<DataRecord | undefined>();
  const shared = { registry, dataSources, entities, documents: docSet };
  if (view.kind === "dashboard") return <DashboardRenderer dashboard={view} {...shared} />;
  const entity = entities.get(view.entity)!;
  const bump = () => setSaves((n) => n + 1);
  switch (view.kind) {
    case "form":
      // After a save the checklist hangs off the saved record (a sub-record needs a parent).
      return <FormRenderer entity={entity} view={view} {...shared} {...(saved ? { parent: saved } : {})} onSaved={setSaved} />;
    case "table":
      return <TableRenderer entity={entity} view={view} {...shared} reloadKey={saves} onChanged={bump} {...(filter ? { savedFilter: filter } : {})} onSavedFilterChange={setFilter} />;
    case "calendar":
      return <CalendarRenderer entity={entity} view={view} {...shared} reloadKey={saves} onChanged={bump} />;
    case "board":
      return <BoardRenderer entity={entity} view={view} {...shared} reloadKey={saves} onChanged={bump} />;
  }
}

export function App({ adapter }: { adapter: DataAdapter }) {
  const [id, setId] = useState(fromHash);
  const [dark, setDark] = useState(prefersDark);
  useEffect(() => {
    const onHash = () => setId(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.documentElement.dataset["theme"] = dark ? "dark" : "light";
  }, [dark]);
  const dataSources = useMemo(() => new Map([["default", adapter]]), [adapter]);
  const view = navViews.find((v) => v.id === id) ?? navViews[0]!;
  return (
    <div className="starter-shell">
      <nav aria-label="Views">
        {navViews.map((v) => (
          <a key={v.id} href={`#/${v.id}`} aria-current={v.id === view.id ? "page" : undefined}>{titleOf(v)}</a>
        ))}
        <button type="button" onClick={() => setDark(!dark)} aria-pressed={dark}>{dark ? "Light" : "Dark"} theme</button>
      </nav>
      <main key={view.id}><View view={view} dataSources={dataSources} /></main>
    </div>
  );
}
