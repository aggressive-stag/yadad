import type { DataAdapter, DataRecord, Registry } from "@yadad/core";
import { FormRenderer, TableRenderer } from "@yadad/renderer";
import { createMemoryAdapter } from "@yadad/runtime";
import { useState } from "react";
import type { ReactNode } from "react";
import entityHello from "../../../fixtures/valid/entity-hello.json?raw";
import entityWorkoutSet from "../../../fixtures/valid/entity-workout-set.json?raw";
import formHello from "../../../fixtures/valid/form-hello.json?raw";
import formLogSet from "../../../fixtures/valid/form-log-set.json?raw";
import tableSets from "../../../fixtures/valid/table-sets.json?raw";
import { loadDocuments } from "./documents";

// The host decides which adapter backs each dataSource key.
const dataSources: ReadonlyMap<string, DataAdapter> = new Map([["default", createMemoryAdapter()]]);

/** A pair of raw JSON documents: an entity and a view of it (form or table). */
export interface ViewSource {
  readonly entity: string;
  readonly view: string;
}

/** The fixture views the showcase renders. Edit those files and the page follows. */
export const defaultViews: readonly ViewSource[] = [
  { entity: entityWorkoutSet, view: formLogSet },
  { entity: entityWorkoutSet, view: tableSets },
  { entity: entityHello, view: formHello },
];

export interface AppProps {
  /** Injected by the host: the mock registry, or a real component set. */
  readonly registry: Registry<ReactNode>;
  readonly views?: readonly ViewSource[];
}

export function App({ registry, views = defaultViews }: AppProps): ReactNode {
  const [records, setRecords] = useState<readonly DataRecord[]>([]);

  return (
    <main>
      <h1>yadad showcase</h1>
      {views.map((source, i) => {
        const docs = loadDocuments(source.entity, source.view);
        return docs.ok ? (
          <section key={docs.view.id} aria-label={docs.view.id}>
            {docs.view.kind === "form" ? (
              <FormRenderer
                entity={docs.entity}
                view={docs.view}
                registry={registry}
                dataSources={dataSources}
                onSaved={(record) => setRecords((rs) => [...rs, record])}
              />
            ) : (
              // Reload whenever a form saves a record.
              <TableRenderer entity={docs.entity} view={docs.view} registry={registry} dataSources={dataSources} reloadKey={records.length} />
            )}
          </section>
        ) : (
          <ul key={i} role="alert" data-testid="document-errors">
            {docs.errors.map((e) => (
              <li key={`${e.source} ${e.path} ${e.code}`}>
                {e.source}
                {e.path}: {e.message} {e.hint}
              </li>
            ))}
          </ul>
        );
      })}
      <h2>Saved records</h2>
      <pre data-testid="records">{JSON.stringify(records, null, 2)}</pre>
    </main>
  );
}
