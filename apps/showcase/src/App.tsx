import { validateDocument } from "@yadad/core";
import type { DataAdapter, Document, EntityDocument, FormView, Registry, TableView, ViewDocument } from "@yadad/core";
import { blankDashboard, blankEntity, blankForm, blankTable, DashboardLayoutEditor, EntityFieldsEditor, FormViewEditor, idFromTitle, TableViewEditor } from "@yadad/editor";
import { DashboardRenderer, FormRenderer, TableRenderer } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";
import { createDraftStore, createKeyValueAdapter, createMemoryAdapter } from "@yadad/runtime";
import type { DraftStorage, DraftStore, KeyValueStore } from "@yadad/runtime";
import { useState } from "react";
import type { ReactNode } from "react";
import dashboardTraining from "../../../fixtures/valid/dashboard-training.json?raw";
import entityHello from "../../../fixtures/valid/entity-hello.json?raw";
import entityWorkoutSet from "../../../fixtures/valid/entity-workout-set.json?raw";
import formHello from "../../../fixtures/valid/form-hello.json?raw";
import formLogSet from "../../../fixtures/valid/form-log-set.json?raw";
import tableSets from "../../../fixtures/valid/table-sets.json?raw";
import { loadDocumentSet } from "./documents";

/** The fixture documents, as raw JSON. Edit those files and the page follows. */
export const defaultSources: readonly string[] = [entityWorkoutSet, formLogSet, tableSets, dashboardTraining, entityHello, formHello];

/** Views rendered at the top level of the page, by id. */
export const defaultRoots: readonly string[] = ["training", "hello_form"];

export interface AppProps {
  /** Injected by the host: the mock registry, or a real component set. */
  readonly registry: Registry<ReactNode>;
  readonly sources?: readonly string[];
  readonly roots?: readonly string[];
  /** Where records, edited documents and form drafts persist (e.g. localStorage). Without it everything lives in memory. */
  readonly storage?: DraftStorage;
  /** Shown as a "Reset saved data" button when given. */
  readonly onReset?: () => void;
}

const PREFIX = "yadad-showcase";
const DOCUMENTS_KEY = `${PREFIX}:documents`;

/** Edited documents saved earlier, re-validated: anything that no longer validates is dropped and reported. */
function loadEdited(storage: KeyValueStore | undefined): { docs: ReadonlyMap<string, Document>; dropped: string[] } {
  const docs = new Map<string, Document>();
  const dropped: string[] = [];
  let raw: unknown = [];
  try {
    raw = JSON.parse(storage?.getItem(DOCUMENTS_KEY) ?? "[]");
  } catch {
    dropped.push("saved documents (not valid JSON)");
  }
  for (const item of Array.isArray(raw) ? raw : []) {
    const result = validateDocument(item);
    if (result.ok) docs.set(docKey(result.value), result.value);
    else dropped.push(typeof item === "object" && item !== null && "id" in item ? String(item.id) : "a saved document");
  }
  return { docs, dropped };
}

/** Entity and view ids are unique per kind only, so edited documents are keyed by both. */
const docKey = (doc: Document) => `${doc.kind}:${doc.id}`;

type Mode =
  | { readonly kind: "view" }
  | { readonly kind: "layout"; readonly id: string }
  | { readonly kind: "fields"; readonly id: string }
  | { readonly kind: "form"; readonly id: string }
  | { readonly kind: "table"; readonly id: string };

export function App({ registry, sources = defaultSources, roots = defaultRoots, storage, onReset }: AppProps): ReactNode {
  // The host decides which adapter backs each dataSource key.
  const [dataSources] = useState<ReadonlyMap<string, DataAdapter>>(() => new Map([["default", storage ? createKeyValueAdapter(storage, PREFIX) : createMemoryAdapter()]]));
  // Documents saved from the editors replace the loaded ones, and persist when storage is given.
  const [initial] = useState(() => loadEdited(storage));
  // Unsaved form input survives a reload when the page has storage.
  const [draftStore] = useState(() => (storage ? createDraftStore(storage, PREFIX) : undefined));
  const [edited, setEdited] = useState<ReadonlyMap<string, Document>>(initial.docs);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const loaded = loadDocumentSet(sources);
  const documents = overlay(loaded.documents, edited);
  const [appName, setAppName] = useState("");
  const store = (docs: readonly Document[]) => {
    const next = new Map(edited);
    for (const doc of docs) next.set(docKey(doc), doc);
    setEdited(next);
    storage?.setItem(DOCUMENTS_KEY, JSON.stringify([...next.values()]));
    setMode({ kind: "view" });
  };
  const save = (doc: Document) => store([doc]);
  // Dashboards built here from blank are shown after the fixture ones.
  const allRoots = [...roots, ...[...edited.values()].filter((d) => d.kind === "dashboard" && !loaded.documents.views.has(d.id) && !roots.includes(d.id)).map((d) => d.id)];
  const createApp = () => {
    const title = appName.trim();
    const id = idFromTitle(title, [...documents.entities.keys(), ...documents.views.keys()], "app");
    const created = newApp(id, title);
    store(created);
    setAppName("");
  };
  const close = () => setMode({ kind: "view" });
  const { Button, FieldFrame } = registry.layout;
  const TextInput = registry.fields.text.Input;

  return (
    <main>
      <h1>yadad showcase</h1>
      {onReset && <Button label="Reset saved data" type="button" variant="secondary" disabled={false} onPress={onReset} />}
      {initial.dropped.length > 0 && <p role="status">Some saved edits no longer validate and were ignored: {initial.dropped.join(", ")}.</p>}
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
      <div data-showcase-toolbar="">
        <FieldFrame inputId="new-app" errorId="new-app-errors" label="New app name" required={false} errors={[]}>
          <TextInput inputId="new-app" invalid={false} field={{ id: "new_app", type: "text", label: "New app name" }} value={appName} onChange={(v) => setAppName(v ?? "")} />
        </FieldFrame>
        <Button label="Start a new app" type="button" variant="secondary" disabled={appName.trim() === ""} onPress={createApp} />
      </div>
      {allRoots.map((id) => {
        const view = documents.views.get(id);
        const entityId = view?.kind === "dashboard" ? firstEntity(view.id, documents) : view?.entity;
        const entity = entityId ? documents.entities.get(entityId) : undefined;
        const parts = viewsOf(id, documents);
        const editing = mode.kind !== "view" && (mode.id === id || mode.id === entityId || parts.some((v) => v.id === mode.id && v.kind === mode.kind));
        return (
          <section key={id} aria-label={id}>
            {!editing && view && (
              <div data-showcase-toolbar="">
                {view.kind === "dashboard" && <Button label="Edit layout" type="button" variant="secondary" disabled={false} onPress={() => setMode({ kind: "layout", id })} />}
                {entity && <Button label={`Edit ${entity.id} fields`} type="button" variant="secondary" disabled={false} onPress={() => setMode({ kind: "fields", id: entity.id })} />}
                {parts.map((v) => (
                  <Button key={v.id} label={`Edit ${describe(v.id, documents).toLowerCase()}`} type="button" variant="secondary" disabled={false} onPress={() => setMode({ kind: v.kind, id: v.id })} />
                ))}
              </div>
            )}
            {mode.kind === "layout" && mode.id === id && view?.kind === "dashboard" ? (
              <DashboardLayoutEditor dashboard={view} registry={registry} onSave={save} onCancel={close} describeView={(v) => describe(v, documents)} views={[...documents.views.values()]} />
            ) : mode.kind === "fields" && entity && mode.id === entity.id ? (
              <EntityFieldsEditor entity={entity} views={[...documents.views.values()]} registry={registry} onSave={save} onCancel={close} />
            ) : (mode.kind === "form" || mode.kind === "table") && editing ? (
              viewEditor(mode, documents, registry, save, close)
            ) : (
              renderRoot(id, documents, registry, dataSources, draftStore)
            )}
          </section>
        );
      })}
    </main>
  );
}

/** The forms and tables a root shows: itself, or the views its dashboard embeds. */
function viewsOf(rootId: string, documents: DocumentSet): (FormView | TableView)[] {
  const root = documents.views.get(rootId);
  if (!root) return [];
  if (root.kind !== "dashboard") return [root];
  const ids = [...new Set(root.tabs.flatMap((t) => t.items.filter((i) => i.widget === "view").map((i) => i.view)))];
  return ids.map((id) => documents.views.get(id)).filter((v): v is FormView | TableView => v !== undefined && v.kind !== "dashboard");
}

function viewEditor(mode: { readonly kind: "form" | "table"; readonly id: string }, documents: DocumentSet, registry: Registry<ReactNode>, save: (doc: Document) => void, close: () => void): ReactNode {
  const view = documents.views.get(mode.id);
  const entity = view && view.kind !== "dashboard" ? documents.entities.get(view.entity) : undefined;
  if (!entity) return null;
  if (view?.kind === "form") return <FormViewEditor view={view} entity={entity} registry={registry} onSave={save} onCancel={close} />;
  if (view?.kind === "table") return <TableViewEditor view={view} entity={entity} registry={registry} onSave={save} onCancel={close} />;
  return null;
}

/**
 * A new app from blank: an entity with one text field to start from, a form
 * and a table for it, and a dashboard showing both side by side.
 */
function newApp(id: string, title: string): Document[] {
  const entity: EntityDocument = { ...blankEntity(id), fields: [{ id: "name", type: "text", label: "Name", required: true }] };
  const form = blankForm(entity, `${id}_form`, "default");
  const table = blankTable(entity, `${id}_table`, "default");
  const dashboard = blankDashboard(`${id}_home`, title);
  const items = [
    { id: "form", x: 0, y: 0, w: 6, h: 5, widget: "view" as const, view: form.id },
    ...(table ? [{ id: "table", x: 6, y: 0, w: 6, h: 5, widget: "view" as const, view: table.id }] : []),
  ];
  const home = { ...dashboard, tabs: dashboard.tabs.map((t) => ({ ...t, items })) };
  return [entity, { ...form, sections: form.sections.map((s) => ({ ...s, title })) }, ...(table ? [{ ...table, title }] : []), home] satisfies (EntityDocument | ViewDocument)[];
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

function renderRoot(id: string, documents: DocumentSet, registry: Registry<ReactNode>, dataSources: ReadonlyMap<string, DataAdapter>, draftStore: DraftStore | undefined): ReactNode {
  const view = documents.views.get(id);
  if (!view) return null;
  const drafts = draftStore ? { drafts: { store: draftStore } } : {};
  if (view.kind === "dashboard") return <DashboardRenderer dashboard={view} documents={documents} registry={registry} dataSources={dataSources} {...drafts} />;
  const entity = documents.entities.get(view.entity);
  if (!entity) return null;
  return view.kind === "form" ? (
    <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} {...drafts} />
  ) : (
    <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} />
  );
}
