import { validateDocument } from "@yadad/core";
import type { ResolvedViewer, ViewerDocument, ViewerFactValue, BoardView, CalendarView, DashboardView, DataAdapter, Document, EntityDocument, FormView, Registry, TableView, ViewDocument } from "@yadad/core";
import { addWidget, blankBoard, blankDashboard, blankEntity, blankForm, blankTable, BoardViewEditor, CalendarViewEditor, DashboardLayoutEditor, EntityFieldsEditor, FormViewEditor, idFromTitle, TableViewEditor, uniqueItemId } from "@yadad/editor";
import { BoardRenderer, CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";
import { applyPatch, createDraftStore, createKeyValueAdapter, createMemoryAdapter, resolveViewer } from "@yadad/runtime";
import type { DraftStorage, DraftStore, KeyValueStore } from "@yadad/runtime";

import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";
import { bookingEntity, bookingsAdapter } from "./bookings";
import { personEntity, taskEntity, tasksAdapter } from "./tasks";
import { teamAdapter, teamViewer, teamViews } from "./team";
import dashboardTraining from "../../../fixtures/valid/dashboard-training.json?raw";
import entityHello from "../../../fixtures/valid/entity-hello.json?raw";
import entityWorkoutSet from "../../../fixtures/valid/entity-workout-set.json?raw";
import formHello from "../../../fixtures/valid/form-hello.json?raw";
import formLogSet from "../../../fixtures/valid/form-log-set.json?raw";
import tableExerciseHistory from "../../../fixtures/valid/table-exercise-history.json?raw";
import tableSets from "../../../fixtures/valid/table-sets.json?raw";
import { loadDocumentSet } from "./documents";
import { WithStatesPreview } from "./editor-preview";
import { StatesPage } from "./states";

/** The fixture documents, as raw JSON. Edit those files and the page follows. */
export const defaultSources: readonly string[] = [entityWorkoutSet, formLogSet, tableSets, tableExerciseHistory, dashboardTraining, entityHello, formHello];

/** Views rendered at the top level of the page, by id. */
export const defaultRoots: readonly string[] = ["training", "hello_form", "bookings_calendar", "tasks_board", "tasks_home", "team_home"];

/** The bookings table the calendar's row action opens for a booking. */
const bookingsTable: TableView = {
  kind: "table",
  specVersion: 3,
  id: "booking_history",
  title: "Bookings",
  entity: "booking",
  revision: 1,
  dataSource: "bookings",
  columns: [{ field: "title" }, { field: "day" }, { field: "client" }, { field: "status" }, { field: "kind" }],
  quickFilters: [{ field: "status" }, { field: "kind" }],
};

/**
 * The calendar page's documents: a bookings calendar with a colour field and
 * a row action that opens the bookings table scoped to the clicked booking.
 * They are not fixture files (they need a seeded data source), so they are
 * written as code, the way a host would build a view around its own data.
 */
const bookingsView: CalendarView = {
  kind: "calendar",
  specVersion: 3,
  id: "bookings_calendar",
  title: "Bookings",
  entity: "booking",
  revision: 1,
  dataSource: "bookings",
  dateField: "day",
  titleField: "title",
  detailFields: ["client", "kind"],
  colorField: "status",
  sort: [{ field: "title", dir: "asc" }],
  modes: ["month", "week"],
  weekStartsOn: 1,
  editable: true,
  rowAction: { open: "booking_history", bind: [{ field: "client", to: "client" }] },
};

/**
 * The board page's documents: tasks grouped by status, owner or priority
 * (the viewer picks), editable so a move changes the field, and the same
 * board embedded in a small dashboard.
 */
const tasksView: BoardView = {
  kind: "board",
  specVersion: 4,
  id: "tasks_board",
  title: "Tasks",
  entity: "task",
  revision: 1,
  dataSource: "tasks",
  groupBy: [{ field: "status" }, { field: "owner" }, { field: "priority" }],
  titleField: "title",
  cardFields: ["owner", "priority"],
  sort: [{ field: "title", dir: "asc" }],
  editable: true,
};

const tasksHome: DashboardView = {
  kind: "dashboard",
  specVersion: 4,
  id: "tasks_home",
  title: "Team home",
  revision: 1,
  tabs: [{ id: "work", title: "Work", items: [{ id: "board", x: 0, y: 0, w: 12, h: 10, widget: "view", view: "tasks_board" }] }],
};

/** Folds the bookings and tasks demo documents into a loaded set, as a host would seed its own data sources. */
function withBookings(base: DocumentSet): DocumentSet {
  const entities = new Map(base.entities);
  const views = new Map(base.views);
  entities.set(personEntity.id, personEntity);
  entities.set(taskEntity.id, taskEntity);
  views.set(tasksView.id, tasksView);
  views.set(tasksHome.id, tasksHome);
  entities.set(bookingEntity.id, bookingEntity);
  views.set(bookingsView.id, bookingsView);
  views.set(bookingsTable.id, bookingsTable);
  for (const view of teamViews) views.set(view.id, view);
  return { ...base, entities, views, viewer: base.viewer ?? teamViewer };
}

export interface AppProps {
  /** Injected by the host: the mock registry, or a real component set. */
  readonly registry: Registry<ReactNode>;
  readonly sources?: readonly string[];
  readonly roots?: readonly string[];
  /** Where records, edited documents and form drafts persist (e.g. localStorage). Without it everything lives in memory. */
  readonly storage?: DraftStorage;
  /** Shown as a "Reset saved data" button when given. */
  readonly onReset?: () => void;
  /** Which page to open on: the live views (default) or the grid of every state. */
  readonly initialPage?: Page;
  /** The view the States page starts on. */
  readonly initialStatesView?: string;
}

export type Page = "views" | "states";

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
  | { readonly kind: "table"; readonly id: string }
  | { readonly kind: "calendar"; readonly id: string }
  | { readonly kind: "board"; readonly id: string };

export function App({ registry, sources = defaultSources, roots = defaultRoots, storage, onReset, initialPage = "views", initialStatesView }: AppProps): ReactNode {
  // The host decides which adapter backs each dataSource key. The calendar demo keeps its own
  // seeded bookings on a dedicated data source, with a wrapper that refuses moves into the past.
  const roleRef = useRef("viewer");
  const [dataSources] = useState<ReadonlyMap<string, DataAdapter>>(() => {
    const map = new Map<string, DataAdapter>([["default", storage ? createKeyValueAdapter(storage, PREFIX) : createMemoryAdapter()]]);
    map.set("bookings", bookingsAdapter());
    map.set("tasks", tasksAdapter());
    map.set("team", teamAdapter(() => roleRef.current));
    return map;
  });
  // Documents saved from the editors replace the loaded ones, and persist when storage is given.
  const [initial] = useState(() => loadEdited(storage));
  // Unsaved form input survives a reload when the page has storage.
  const [draftStore] = useState(() => (storage ? createDraftStore(storage, PREFIX) : undefined));
  const [edited, setEdited] = useState<ReadonlyMap<string, Document>>(initial.docs);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [page, setPage] = useState<Page>(initialPage);
  const loaded = loadDocumentSet(sources);
  const documents = overlay(withBookings(loaded.documents), edited);
  const [appName, setAppName] = useState("");
  // "View as": what the host knows about the viewer. The renderers get the resolved facts; the data source reads the role.
  const [viewerInput, setViewerInput] = useState<readonly ViewerFactValue[]>([]);
  const viewer = resolveViewer(documents.viewer, viewerInput).viewer;
  roleRef.current = String(viewer.facts.find((f) => f.fact === "role")?.value ?? "viewer");
  const viewerKey = JSON.stringify(viewer.facts);
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
  // "Add a board" makes a board grouped by the entity's first groupable field, puts it on the dashboard and opens its editor.
  const addBoard = (dashboard: DashboardView, entity: EntityDocument, dataSource: string) => {
    const boardId = idFromTitle(`${entity.id} board`, [...documents.views.keys()], "board");
    const board = blankBoard(entity, boardId, dataSource);
    const tab = dashboard.tabs[0];
    if (!board || !tab) return;
    const patched = applyPatch(dashboard, addWidget(dashboard, tab.id, uniqueItemId(dashboard, tab.id, boardId), { widget: "view", view: boardId }, 6, 6));
    if (!patched.ok) return;
    store([board, { ...(patched.value as DashboardView), revision: dashboard.revision + 1 }]);
    setMode({ kind: "board", id: boardId });
  };
  const close = () => setMode({ kind: "view" });
  const { Button, FieldFrame } = registry.layout;
  const TextInput = registry.fields.text.Input;

  return (
    <main>
      <h1>yadad showcase</h1>
      <nav aria-label="Pages" data-showcase-toolbar="">
        {(["views", "states"] as const).map((p) => (
          <button key={p} type="button" aria-current={page === p ? "page" : undefined} onClick={() => { setPage(p); try { window.history.replaceState(null, "", p === "states" ? "#states" : "#"); } catch { /* no history in this environment */ } }}>
            {p === "views" ? "Views" : "States"}
          </button>
        ))}
      </nav>
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
      {page === "views" && documents.viewer && <ViewAs document={documents.viewer} viewer={viewer} onChange={(fact, value) => setViewerInput([...viewer.facts.filter((f) => f.fact !== fact), { fact, value }])} />}
      {page === "states" && <StatesPage documents={documents} registry={registry} {...(initialStatesView ? { initialView: initialStatesView } : {})} />}
      {page === "views" && allRoots.map((id) => {
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
                {view.kind === "dashboard" && entity && !parts.some((v) => v.kind === "board") && blankBoard(entity, "probe", "default") && (
                  <Button label={`Add a board for ${entity.id}`} type="button" variant="secondary" disabled={false} onPress={() => addBoard(view, entity, parts.find((v) => v.entity === entity.id)?.dataSource ?? "default")} />
                )}
                {parts.map((v) => (
                  <Button key={v.id} label={`Edit ${describe(v.id, documents).toLowerCase()}`} type="button" variant="secondary" disabled={false} onPress={() => setMode({ kind: v.kind, id: v.id })} />
                ))}
              </div>
            )}
            {mode.kind === "layout" && mode.id === id && view?.kind === "dashboard" ? (
              <DashboardLayoutEditor dashboard={view} registry={registry} onSave={save} onCancel={close} describeView={(v) => describe(v, documents)} views={[...documents.views.values()]} entities={documents.entities} />
            ) : mode.kind === "fields" && entity && mode.id === entity.id ? (
              <EntityFieldsEditor entity={entity} views={[...documents.views.values()]} registry={registry} onSave={save} onCancel={close} />
            ) : (mode.kind === "form" || mode.kind === "table" || mode.kind === "calendar" || mode.kind === "board") && editing ? (
              viewEditor(mode, documents, registry, save, close)
            ) : (
              <Fragment key={viewerKey}>{renderRoot(id, documents, registry, dataSources, draftStore, viewer)}</Fragment>
            )}
          </section>
        );
      })}
    </main>
  );
}

/** The forms, tables and calendars a root shows: itself, or the views its dashboard embeds. */
function viewsOf(rootId: string, documents: DocumentSet): (FormView | TableView | CalendarView | BoardView)[] {
  const root = documents.views.get(rootId);
  if (!root) return [];
  if (root.kind !== "dashboard") return root.kind === "calendar" || root.kind === "form" || root.kind === "table" || root.kind === "board" ? [root] : [];
  const ids = [...new Set(root.tabs.flatMap((t) => t.items.filter((i) => i.widget === "view").map((i) => i.view)))];
  return ids.map((id) => documents.views.get(id)).filter((v): v is FormView | TableView | CalendarView | BoardView => v !== undefined && (v.kind === "form" || v.kind === "table" || v.kind === "calendar" || v.kind === "board"));
}

function viewEditor(mode: { readonly kind: "form" | "table" | "calendar" | "board"; readonly id: string }, documents: DocumentSet, registry: Registry<ReactNode>, save: (doc: Document) => void, close: () => void): ReactNode {
  const view = documents.views.get(mode.id);
  const entity = view && view.kind !== "dashboard" ? documents.entities.get(view.entity) : undefined;
  if (!entity) return null;
  const tableContext = { tables: [...documents.views.values()].filter((v): v is TableView => v.kind === "table"), entities: [...documents.entities.values()] };
  const wrap = (editor: (onChange: (v: ViewDocument) => void) => ReactNode): ReactNode => (
    <WithStatesPreview key={`${view?.id}-${view?.revision}`} view={view as ViewDocument} documents={documents} registry={registry} editor={editor} />
  );
  if (view?.kind === "form") return wrap((onChange) => <FormViewEditor view={view} entity={entity} registry={registry} onSave={save} onChange={onChange} onCancel={close} />);
  if (view?.kind === "table") return wrap((onChange) => <TableViewEditor view={view} entity={entity} registry={registry} context={tableContext} onSave={save} onChange={onChange} onCancel={close} />);
  if (view?.kind === "calendar") return wrap((onChange) => <CalendarViewEditor view={view} entity={entity} registry={registry} context={tableContext} onSave={save} onChange={onChange} onCancel={close} />);
  if (view?.kind === "board") return wrap((onChange) => <BoardViewEditor view={view} entity={entity} registry={registry} context={tableContext} onSave={save} onChange={onChange} onCancel={close} />);
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
  let viewer = base.viewer;
  for (const doc of edited.values()) {
    if (doc.kind === "entity") entities.set(doc.id, doc);
    else if (doc.kind === "viewer") viewer = doc;
    else views.set(doc.id, doc);
  }
  return { entities, views, ...(viewer ? { viewer } : {}) };
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
  if (view.kind === "calendar") return `Calendar: ${view.title ?? view.id}`;
  if (view.kind === "board") return `Board: ${view.title ?? view.id}`;
  return view.id;
}

function renderRoot(id: string, documents: DocumentSet, registry: Registry<ReactNode>, dataSources: ReadonlyMap<string, DataAdapter>, draftStore: DraftStore | undefined, viewer: ResolvedViewer): ReactNode {
  const view = documents.views.get(id);
  if (!view) return null;
  const drafts = draftStore ? { drafts: { store: draftStore } } : {};
  if (view.kind === "dashboard") return <DashboardRenderer dashboard={view} documents={documents} registry={registry} dataSources={dataSources} viewer={viewer} {...drafts} />;
  const entity = documents.entities.get(view.entity);
  if (!entity) return null;
  if (view.kind === "calendar") return <CalendarRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} documents={documents} viewer={viewer} />;
  if (view.kind === "board") return <BoardRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={documents.entities} documents={documents} viewer={viewer} />;
  return view.kind === "form" ? (
    <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} viewer={viewer} {...drafts} />
  ) : (
    <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} documents={documents} viewer={viewer} />
  );
}

/**
 * "View as": one control per viewer fact, native selects so it works from the keyboard.
 * A host would build the viewer from its session; this lets you switch live.
 */
function ViewAs({ document: doc, viewer, onChange }: { readonly document: ViewerDocument; readonly viewer: ResolvedViewer; readonly onChange: (fact: string, value: string | boolean) => void }): ReactNode {
  return (
    <fieldset data-view-as="">
      <legend>View as</legend>
      {doc.facts.map((fact) => {
        const value = viewer.facts.find((f) => f.fact === fact.id)?.value;
        return fact.type === "select" ? (
          <label key={fact.id}>
            {fact.label}{" "}
            <select value={String(value)} onChange={(e) => onChange(fact.id, e.target.value)}>
              {fact.options.values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label key={fact.id}>
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(fact.id, e.target.checked)} /> {fact.label}
          </label>
        );
      })}
    </fieldset>
  );
}
