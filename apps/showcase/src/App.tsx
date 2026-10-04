import type { DataAdapter, DataRecord } from "@yadad/core";
import { FormRenderer } from "@yadad/renderer";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { useState } from "react";
import type { ReactNode } from "react";
import entityHello from "../../../fixtures/valid/entity-hello.json?raw";
import formHello from "../../../fixtures/valid/form-hello.json?raw";
import { loadDocuments } from "./documents";

// The host decides which adapter backs each dataSource key.
const dataSources: ReadonlyMap<string, DataAdapter> = new Map([["default", createMemoryAdapter()]]);

export interface AppProps {
  /** Raw JSON documents. Defaults to the hello fixtures; edit those files and the page follows. */
  readonly entitySource?: string;
  readonly formSource?: string;
}

export function App({ entitySource = entityHello, formSource = formHello }: AppProps): ReactNode {
  const [records, setRecords] = useState<readonly DataRecord[]>([]);
  const docs = loadDocuments(entitySource, formSource);

  return (
    <main>
      <h1>yadad showcase</h1>
      {docs.ok ? (
        <FormRenderer
          entity={docs.entity}
          view={docs.view}
          registry={mockRegistry}
          dataSources={dataSources}
          onSaved={(record) => setRecords((rs) => [...rs, record])}
        />
      ) : (
        <ul role="alert" data-testid="document-errors">
          {docs.errors.map((e) => (
            <li key={`${e.source} ${e.path} ${e.code}`}>
              {e.source}
              {e.path}: {e.message} {e.hint}
            </li>
          ))}
        </ul>
      )}
      <h2>Saved records</h2>
      <pre data-testid="records">{JSON.stringify(records, null, 2)}</pre>
    </main>
  );
}
