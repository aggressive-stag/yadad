import type { DataAdapter, Registry } from "@yadad/core";
import { DashboardRenderer, FormRenderer, TableRenderer } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";
import { createMemoryAdapter } from "@yadad/runtime";
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

export function App({ registry, sources = defaultSources, roots = defaultRoots }: AppProps): ReactNode {
  const { documents, errors } = loadDocumentSet(sources);
  return (
    <main>
      <h1>yadad showcase</h1>
      {errors.length > 0 && (
        <ul role="alert" data-testid="document-errors">
          {errors.map((e) => (
            <li key={`${e.source} ${e.path} ${e.code}`}>
              {e.source}
              {e.path}: {e.message} {e.hint}
            </li>
          ))}
        </ul>
      )}
      {roots.map((id) => (
        <section key={id} aria-label={id}>
          {renderRoot(id, documents, registry)}
        </section>
      ))}
    </main>
  );
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
