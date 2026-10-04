import type { DataAdapter, DataRecord, Registry } from "@yadad/core";
import { FormRenderer } from "@yadad/renderer";
import { createMemoryAdapter } from "@yadad/runtime";
import { useState } from "react";
import type { ReactNode } from "react";
import entityHello from "../../../fixtures/valid/entity-hello.json?raw";
import entityWorkoutSet from "../../../fixtures/valid/entity-workout-set.json?raw";
import formHello from "../../../fixtures/valid/form-hello.json?raw";
import formLogSet from "../../../fixtures/valid/form-log-set.json?raw";
import { loadDocuments } from "./documents";

// The host decides which adapter backs each dataSource key.
const dataSources: ReadonlyMap<string, DataAdapter> = new Map([["default", createMemoryAdapter()]]);

/** A pair of raw JSON documents: an entity and a form view for it. */
export interface FormSource {
  readonly entity: string;
  readonly form: string;
}

/** The fixture forms the showcase renders. Edit those files and the page follows. */
export const defaultForms: readonly FormSource[] = [
  { entity: entityWorkoutSet, form: formLogSet },
  { entity: entityHello, form: formHello },
];

export interface AppProps {
  /** Injected by the host: the mock registry, or a real component set. */
  readonly registry: Registry<ReactNode>;
  readonly forms?: readonly FormSource[];
}

export function App({ registry, forms = defaultForms }: AppProps): ReactNode {
  const [records, setRecords] = useState<readonly DataRecord[]>([]);

  return (
    <main>
      <h1>yadad showcase</h1>
      {forms.map((source, i) => {
        const docs = loadDocuments(source.entity, source.form);
        return docs.ok ? (
          <section key={docs.view.id} aria-label={docs.view.id}>
            <FormRenderer
              entity={docs.entity}
              view={docs.view}
              registry={registry}
              dataSources={dataSources}
              onSaved={(record) => setRecords((rs) => [...rs, record])}
            />
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
