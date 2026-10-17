import type { BoardView, DataAdapter, Document, EntityDocument, Registry, ResolvedViewer, ViewDocument } from "@yadad/core";
import { BoardRenderer, CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";
import { createDraftStore, viewStates } from "@yadad/runtime";
import type { DraftStore } from "@yadad/runtime";
import { sourceStates } from "@yadad/testing";
import type { SourceViewState } from "@yadad/testing";
import { checkViewStates } from "@yadad/testing/state-checks";
import type { StateCheckResult, StateRenderContext } from "@yadad/testing/state-checks";
import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/** The width a tile renders at before it is scaled down to fit the grid. */
const TILE_WIDTH = 960;
const PHONE_WIDTH = 390;
/** "Many records" for the grid: small enough that 30 live calendars stay quick. */
export const QUICK_MANY = 60;

/** The views the States page can show: everything with a render. */
export function stateViews(documents: DocumentSet): ViewDocument[] {
  return [...documents.views.values()];
}

/** The one-line wiring per view kind: this is what a host app writes. */
export function renderState(state: SourceViewState, context: StateRenderContext, set: DocumentSet): ReactNode {
  const { view, entity, registry, dataSources, drafts, now } = context;
  const entities = set.entities;
  // The state's viewer goes to the renderer; the "viewer not provided" state leaves the prop out.
  const viewer = context.omitViewer ? {} : { viewer: context.viewer };
  switch (view.kind) {
    case "form":
      return entity ? <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={entities} {...(drafts ? { drafts } : {})} {...viewer} /> : null;
    case "table":
      return entity ? <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={entities} documents={set} {...viewer} /> : null;
    case "calendar":
      // The state names the mode and the day the calendar opens on; the viewer may still navigate from there.
      return entity && state.render.kind === "calendar" ? <CalendarRenderer key={state.id} initialMode={state.render.mode} initialAnchor={state.render.anchor} entity={entity} view={view} registry={registry} dataSources={dataSources} entities={entities} documents={set} now={now} {...viewer} /> : null;
    case "board":
      // The state names the field the board is grouped by; the renderer's `groupBy` prop takes it, and the viewer may still switch.
      return entity && state.render.kind === "board" ? <StateBoard key={state.id} initial={state.render.groupBy} entity={entity} view={view} registry={registry} dataSources={dataSources} entities={entities} set={set} viewer={viewer} /> : null;
    case "dashboard":
      return <DashboardRenderer dashboard={view} documents={set} registry={registry} dataSources={dataSources} {...viewer} />;
  }
}

interface StateBoardProps {
  readonly initial: string;
  readonly entity: EntityDocument;
  readonly view: BoardView;
  readonly registry: Registry<ReactNode>;
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  readonly entities: DocumentSet["entities"];
  readonly set: DocumentSet;
  readonly viewer: { readonly viewer?: ResolvedViewer };
}

/** A board that starts on the state's grouping and follows the viewer's choice after that. */
function StateBoard({ initial, entity, view, registry, dataSources, entities, set, viewer }: StateBoardProps): ReactNode {
  const [groupBy, setGroupBy] = useState(initial);
  return <BoardRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={entities} documents={set} groupBy={groupBy} onGroupByChange={setGroupBy} {...viewer} />;
}

/** Everything a renderer needs for one state: a fresh adapter under every data source key, and a draft store for a form's values. */
export function contextFor(state: SourceViewState, view: ViewDocument, docs: readonly Document[], registry: Registry<ReactNode>, now: Date): StateRenderContext {
  const entity = "entity" in view ? docs.find((d): d is EntityDocument => d.kind === "entity" && d.id === view.entity) : undefined;
  const adapter = state.adapter();
  const keys = new Set<string>(docs.flatMap((d) => (d.kind !== "entity" && d.kind !== "viewer" && "dataSource" in d ? [d.dataSource] : [])));
  const dataSources = new Map<string, DataAdapter>([...keys].map((k) => [k, adapter]));
  let drafts: { readonly store: DraftStore } | undefined;
  if (state.render.kind === "form" && entity && Object.keys(state.render.values).length > 0) {
    const data = new Map<string, string>();
    const store = createDraftStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) });
    store.save(state.render.view, undefined, { values: state.render.values, entityRevision: entity.revision, savedAt: state.render.now.getTime() });
    drafts = { store };
  }
  return { view, entity, documents: docs, registry, adapter, dataSources, drafts, now, viewer: state.viewer, omitViewer: state.omitViewer === true };
}

class Boundary extends Component<{ readonly children: ReactNode }, { readonly error: string | undefined }> {
  override state = { error: undefined as string | undefined };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override render(): ReactNode {
    return this.state.error === undefined ? this.props.children : <p role="alert">This state failed to render: {this.state.error}</p>;
  }
}

/** One state, live. A dashboard opens the tab its state is on. */
function Live({ state, view, docs, set, registry, now }: { readonly state: SourceViewState; readonly view: ViewDocument; readonly docs: readonly Document[]; readonly set: DocumentSet; readonly registry: Registry<ReactNode>; readonly now: Date }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const context = useMemo(() => contextFor(state, view, docs, registry, now), [state, view, docs, registry, now]);
  useEffect(() => {
    if (view.kind !== "dashboard" || state.render.kind !== "dashboard" || view.tabs[0]?.id === state.render.tab) return;
    const title = view.tabs.find((t) => t.id === (state.render.kind === "dashboard" ? state.render.tab : ""))?.title;
    const open = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find((b) => b.textContent?.trim() === title)?.click();
    open();
  }, [state, view]);
  return (
    <div ref={ref}>
      <Boundary>{renderState(state, context, set)}</Boundary>
    </div>
  );
}

/** True once the element has come within a screenful of the viewport; stays true after. */
function useNearViewport(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "300px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

function Tile({ state, result, checked, onOpen, shared }: { readonly state: SourceViewState; readonly result: StateCheckResult | undefined; readonly checked: boolean; readonly onOpen: () => void; readonly shared: Shared }): ReactNode {
  const [ref, near] = useNearViewport();
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / TILE_WIDTH)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  const problems = result?.problems ?? [];
  return (
    <li data-state-tile={state.id} data-problems={problems.length}>
      <button type="button" data-state-open="" onClick={onOpen} aria-describedby={problems.length > 0 ? `problems-${cssId(state.id)}` : undefined}>
        {state.label}
        {problems.length > 0 && <span data-state-marker=""> ⚠ {problems.length === 1 ? "1 problem" : `${problems.length} problems`}</span>}
        {problems.length === 0 && checked && <span data-state-ok=""> ✓</span>}
      </button>
      <div ref={ref} data-state-preview="" aria-hidden="true">
        {near ? (
          <div inert style={{ width: TILE_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <Live state={state} {...shared} />
          </div>
        ) : null}
      </div>
      {problems.length > 0 && (
        <ul id={`problems-${cssId(state.id)}`} data-state-problems="">
          {problems.map((p, i) => (
            <li key={i}>
              <strong>{p.check}</strong>: {p.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const cssId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

interface Shared {
  readonly view: ViewDocument;
  readonly docs: readonly Document[];
  readonly set: DocumentSet;
  readonly registry: Registry<ReactNode>;
  readonly now: Date;
}

function Detail({ state, result, shared, onClose }: { readonly state: SourceViewState; readonly result: StateCheckResult | undefined; readonly shared: Shared; readonly onClose: () => void }): ReactNode {
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  // Escape closes the full-size view like the Back button does (focus returns to the tile).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const problems = result?.problems ?? [];
  return (
    <section aria-label="State at full size" data-state-detail="">
      <button type="button" onClick={onClose}>
        ← Back to all states
      </button>
      <h2 ref={heading} tabIndex={-1}>
        {state.label}
      </h2>
      <fieldset data-state-width="">
        <legend>Width</legend>
        <label>
          <input type="radio" name="state-width" checked={width === "desktop"} onChange={() => setWidth("desktop")} /> Desktop
        </label>
        <label>
          <input type="radio" name="state-width" checked={width === "phone"} onChange={() => setWidth("phone")} /> Phone ({PHONE_WIDTH}px)
        </label>
      </fieldset>
      {problems.length > 0 && (
        <ul data-state-problems="" role="alert">
          {problems.map((p, i) => (
            <li key={i}>
              <strong>{p.check}</strong>: {p.message}
            </li>
          ))}
        </ul>
      )}
      <div data-state-frame={width} style={width === "phone" ? { maxWidth: PHONE_WIDTH } : undefined}>
        <Live state={state} {...shared} />
      </div>
    </section>
  );
}

export interface StatesPageProps {
  readonly documents: DocumentSet;
  readonly registry: Registry<ReactNode>;
  /** Which view to start on. */
  readonly initialView?: string;
}

type CheckRun = { readonly key: string; readonly status: "running" | "done" | "failed"; readonly results: ReadonlyMap<string, StateCheckResult>; readonly message?: string };

/** Every state of a view as a grid of live, scaled-down renders, with the state checks' findings marked on them. */
/** The checks that are running or waiting: axe-core refuses to start a second run while one is going. */
let queue: Promise<void> = Promise.resolve();

/** Runs a check after the ones already waiting; the editor preview shares the queue with this page. */
export function enqueueChecks<T>(task: () => Promise<T>): Promise<T> {
  const started = queue.then(task);
  queue = started.then(() => undefined, () => undefined);
  return started;
}

export function StatesPage({ documents, registry, initialView }: StatesPageProps): ReactNode {
  const views = stateViews(documents);
  const [viewId, setViewId] = useState(() => (initialView && documents.views.has(initialView) ? initialView : (views[0]?.id ?? "")));
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [fullLoad, setFullLoad] = useState(false);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const lastOpened = useRef<string | undefined>(undefined);
  const [now] = useState(() => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    return d;
  });
  const [run, setRun] = useState<CheckRun | undefined>(undefined);

  const docs = useMemo<Document[]>(() => [...documents.entities.values(), ...documents.views.values(), ...(documents.viewer ? [documents.viewer] : [])], [documents]);
  // The page re-renders with new document objects each time; only a change of content rebuilds the states.
  const docsKey = JSON.stringify(docs);
  const stable = useRef({ docs, documents });
  stable.current = { docs, documents };
  const view = documents.views.get(viewId);

  const built = useMemo(() => {
    const { docs: current } = stable.current;
    if (!view) return undefined;
    try {
      const result = sourceStates(viewStates(view, current, { now, ...(fullLoad ? {} : { manyRecords: QUICK_MANY }) }), current);
      return { result };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    // docsKey stands in for the document objects.
  }, [viewId, docsKey, now, fullLoad]);

  // The checks run in the page, after the states are built, and mark the tiles when they finish.
  const runKey = `${viewId}|${docsKey}|${fullLoad}`;
  useEffect(() => {
    if (!view || !built || "error" in built) return;
    let stale = false;
    setRun({ key: runKey, status: "running", results: new Map() });
    const { docs: current, documents: set } = stable.current;
    // axe-core allows one run at a time, so runs queue up; one that went stale while waiting is skipped.
    const started = queue.then(() => (stale ? [] : checkViewStates({
      view,
      documents: current,
      registry,
      now,
      ...(fullLoad ? {} : { manyRecords: QUICK_MANY }),
      render: (state, context) => renderState(state, context, set),
    })));
    queue = started.then(() => undefined, () => undefined);
    started.then(
      (results) => !stale && setRun({ key: runKey, status: "done", results: new Map(results.map((r) => [r.id, r])) }),
      (error: unknown) => !stale && setRun({ key: runKey, status: "failed", results: new Map(), message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      stale = true;
    };
    // runKey covers view, documents and load size.
  }, [runKey, built, registry, now]);

  const current = run?.key === runKey ? run : undefined;
  const result = built && "result" in built ? built.result : undefined;
  const states = result?.states ?? [];
  const visible = states.filter((s) => Object.entries(filters).every(([axis, value]) => value === "" || s.values[axis] === value) && (!onlyProblems || (current?.results.get(s.id)?.problems.length ?? 0) > 0));
  const opened = open === undefined ? undefined : states.find((s) => s.id === open);
  const failing = current?.status === "done" ? [...current.results.values()].filter((r) => r.problems.length > 0).length : 0;
  const shared: Shared | undefined = view ? { view, docs, set: documents, registry, now } : undefined;

  const pick = (id: string) => {
    setViewId(id);
    setFilters({});
    setOpen(undefined);
  };
  const close = () => {
    const id = lastOpened.current;
    setOpen(undefined);
    if (id !== undefined) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-state-tile="${CSS.escape(id)}"] [data-state-open]`)?.focus());
  };

  return (
    <section aria-label="States" data-states-page="">
      <h2>States</h2>
      <p>Every state of a view, rendered with seeded data: field values, record counts, modes, tabs and data source behaviour. Select a state to see it at full size.</p>
      <div data-showcase-toolbar="">
        <label>
          View{" "}
          <select value={viewId} onChange={(e) => pick(e.target.value)}>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.kind}: {v.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={fullLoad} onChange={(e) => setFullLoad(e.target.checked)} /> Full load for “many records” (slow)
        </label>
      </div>
      {built && "error" in built && <p role="alert">Could not build the states: {built.error}</p>}
      {result && (
        <>
          <fieldset data-state-filters="">
            <legend>Filter by axis</legend>
            {result.axes.map((axis) => (
              <label key={axis.id}>
                {axis.label}{" "}
                <select value={filters[axis.id] ?? ""} onChange={(e) => setFilters({ ...filters, [axis.id]: e.target.value })}>
                  <option value="">Any</option>
                  {axis.values.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only states with problems
            </label>
          </fieldset>
          <p role="status" data-states-status="">
            {current?.status === "running" && `Checking ${states.length} states… `}
            {current?.status === "done" && (failing === 0 ? "Checks found no problems. " : `Checks found problems in ${failing} of ${states.length} states. `)}
            {current?.status === "failed" && `The checks could not run: ${current.message ?? ""}. `}
            Showing {visible.length} of {states.length} states{result.complete ? "" : " (the view has more combinations than the limit)"}.
          </p>
          {result.skipped.length > 0 && (
            <details>
              <summary>{result.skipped.length} states could not be built</summary>
              <ul>
                {result.skipped.map((s) => (
                  <li key={s.id}>
                    {s.id}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {opened && shared ? (
            <Detail state={opened} result={current?.results.get(opened.id)} shared={shared} onClose={close} />
          ) : (
            shared && (
              <ul data-state-grid="" aria-label="States">
                {visible.map((s) => (
                  <Tile
                    key={s.id}
                    state={s}
                    result={current?.results.get(s.id)}
                    checked={current?.status === "done"}
                    shared={shared}
                    onOpen={() => {
                      lastOpened.current = s.id;
                      setOpen(s.id);
                    }}
                  />
                ))}
              </ul>
            )
          )}
        </>
      )}
    </section>
  );
}
