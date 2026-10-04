import type { DataAdapter, Document, Registry } from "@yadad/core";
import { DashboardLayoutEditor, EntityFieldsEditor } from "@yadad/editor";
import { DashboardRenderer, FormRenderer, TableRenderer } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";
import { createMemoryAdapter } from "@yadad/runtime";
import { useState } from "react";
import type { ReactNode } from "react";
import dashboardTraining from "../../../fixtures/valid/dashboard-training.json?raw";
import entityHello from "../../../fixtures/valid/entity-hello.json?raw";
import entityWorkoutSet from "../../../fixtures/valid/entity-workout-set.json?raw";
import formHello from "../../../fixtures/valid/form-hello.json?raw";
import formLogSet from "../../../fixtures/valid/form-log-set.json?raw";
import tableSets from "../../../fixtures/valid/table-sets.json?raw";
import { loadDocumentSet } from "./documents";

// The host decides which adapter backs each dataSource key.
const dataSources: ReadonlyMap<string, DataAdapter> = new Map([["default", createMemoryAdapter()]]);

/** The fixture documents, as raw JSON. Edit those files and the page follows. */
export const defaultSources: readonly string[] = [entityWorkoutSet, formLogSet, tableSets, dashboardTraining, entityHello, formHello];

/** Views rendered at the top level of the page, by id. */
export const defaultRoots: readonly string[] = ["training", "hello_form"];

export interface AppProps {
  /** Injected by the host: the mock registry, or a real component set. */
  readonly registry: Registry<ReactNode>;
  readonly sources?: readonly string[];
  readonly roots?: readonly string[];
}

type Mode = { readonly kind: "view" } | { readonly kind: "layout"; readonly id: string } | { readonly kind: "fields"; readonly id: string };

export function App({ registry, sources = defaultSources, roots = defaultRoots }: AppProps): ReactNode {
  // Documents saved from the editors replace the loaded ones (in memory for now).
  const [edited, setEdited] = useState<ReadonlyMap<string, Document>>(new Map());
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const loaded = loadDocumentSet(sources);
  const documents = overlay(loaded.documents, edited);
  const save = (doc: Document) => {
    setEdited((m) => new Map(m).set(doc.id, doc));
    setMode({ kind: "view" });
  };
  const close = () => setMode({ kind: "view" });
  const { Button } = registry.layout;

  return (
    <main>
      <h1>yadad showcase</h1>
      {loaded.errors.length > 0 && (
        <ul role="alert" data-testid="document-errors">
          {loaded.errors.map((e) => (
            <li key={`${e.source} ${e.path} ${e.code}`}>
              {e.source}
              {e.path}: {e.message} {e.hint}
            </li>
          ))}
        </ul>
      )}
      {roots.map((id) => {
        const view = documents.views.get(id);
        const entityId = view?.kind === "dashboard" ? firstEntity(view.id, documents) : view?.entity;
        const entity = entityId ? documents.entities.get(entityId) : undefined;
        const editing = mode.kind !== "view" && (mode.id === id || mode.id === entityId);
        return (
          <section key={id} aria-label={id}>
            {!editing && view && (
              <div data-showcase-toolbar="">
                {view.kind === "dashboard" && <Button label="Edit layout" type="button" variant="secondary" disabled={false} onPress={() => setMode({ kind: "layout", id })} />}
                {entity && <Button label={`Edit ${entity.id} fields`} type="button" variant="secondary" disabled={false} onPress={() => setMode({ kind: "fields", id: entity.id })} />}
              </div>
            )}
            {mode.kind === "layout" && mode.id === id && view?.kind === "dashboard" ? (
              <DashboardLayoutEditor dashboard={view} registry={registry} onSave={save} onCancel={close} describeView={(v) => describe(v, documents)} />
            ) : mode.kind === "fields" && entity && mode.id === entity.id ? (
              <EntityFieldsEditor entity={entity} views={[...documents.views.values()]} registry={registry} onSave={save} onCancel={close} />
            ) : (
              renderRoot(id, documents, registry)
            )}
          </section>
        );
      })}
    </main>
  );
}

function overlay(base: DocumentSet, edited: ReadonlyMap<string, Document>): DocumentSet {
  if (edited.size === 0) return base;
  const entities = new Map(base.entities);
  const views = new Map(base.views);
  for (const doc of edited.values()) {
    if (doc.kind === "entity") entities.set(doc.id, doc);
    else views.set(doc.id, doc);
  }
  return { entities, views };
}

/** The entity behind a dashboard's first view widget, for its "Edit fields" button. */
function firstEntity(dashboardId: string, documents: DocumentSet): string | undefined {
  const dashboard = documents.views.get(dashboardId);
  if (dashboard?.kind !== "dashboard") return undefined;
  for (const item of dashboard.tabs.flatMap((t) => t.items)) {
    const view = documents.views.get(item.view);
    if (view && view.kind !== "dashboard") return view.entity;
  }
  return undefined;
}

function describe(viewId: string, documents: DocumentSet): string {
  const view = documents.views.get(viewId);
  if (!view) return viewId;
  if (view.kind === "table") return `Table: ${view.title ?? view.id}`;
  if (view.kind === "form") return `Form: ${view.sections[0]?.title ?? view.id}`;
  return view.id;
}

function renderRoot(id: string, documents: DocumentSet, registry: Registry<ReactNode>): ReactNode {
  const view = documents.views.get(id);
  if (!view) return null;
  if (view.kind === "dashboard") return <DashboardRenderer dashboard={view} documents={documents} registry={registry} dataSources={dataSources} />;
  const entity = documents.entities.get(view.entity);
  if (!entity) return null;
  return view.kind === "form" ? (
    <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} />
  ) : (
    <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} />
  );
}
