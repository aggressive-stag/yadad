// Check every state of a view in one test, imported as "@yadad/testing/state-checks"
// (like the contract kit it needs a DOM and a test runner, so the main entry
// stays free of them). It never imports a renderer: the host passes a
// `render` function that wires its own.

import { act, render as mount } from "@testing-library/react";
import type { BoardProps, CalendarProps, DataAdapter, Document, EntityDocument, FormView, Registry, ResolvedViewer, TableProps, TabsProps, ViewDocument } from "@yadad/core";
import { canUpdate, columnEditable, createDraftStore, evaluateFormRules, rowActionVisible, viewEditable, viewStates, visibleColumns, visibleTabs } from "@yadad/runtime";
import type { DraftStore, ViewStatesOptions } from "@yadad/runtime";
import axe from "axe-core";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { mockRegistry } from "./mock-registry.js";
import { sourceStates } from "./source-states.js";
import type { SourceViewState } from "./source-states.js";
import type { StateAdapter } from "./state-adapter.js";

/** The named checks, one per kind of problem. */
export type StateCheck =
  | "render-threw"
  | "console-error"
  | "field-shown-but-hidden"
  | "field-missing"
  | "required-marker"
  | "accessible-name"
  | "error-message"
  | "viewer-visibility"
  | "editable-offered"
  | "editable-missing"
  | "group-by-ignored"
  | "mode-ignored"
  | "anchor-ignored";

export interface StateProblem {
  readonly check: StateCheck;
  readonly message: string;
}

/** The outcome for one state. `problems` is empty when the state is fine. */
export interface StateCheckResult {
  readonly id: string;
  readonly label: string;
  readonly problems: readonly StateProblem[];
}

/** What `render` gets besides the state: the pieces to wire into a renderer. */
export interface StateRenderContext {
  /** The view being rendered. */
  readonly view: ViewDocument;
  /** The entity of the view, when it has one (a dashboard does not). */
  readonly entity: EntityDocument | undefined;
  readonly documents: readonly Document[];
  readonly registry: Registry<ReactNode>;
  /** Seeded with the state's records and put in its source state. */
  readonly adapter: StateAdapter;
  /** `adapter` under every data source key the documents use, ready for a renderer's `dataSources` prop. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  /** For a form state: a draft store holding the state's values, for the form's `drafts` prop. Undefined otherwise. */
  readonly drafts: { readonly store: DraftStore } | undefined;
  /** The `now` the states were built with. */
  readonly now: Date;
  /** The viewer this state renders for (`state.viewer`). */
  readonly viewer: ResolvedViewer;
  /** True on the "viewer not provided" state: leave the renderer's `viewer` prop out entirely. */
  readonly omitViewer: boolean;
}

export interface CheckViewStatesOptions {
  /** The view document, or its id among `documents`. */
  readonly view: ViewDocument | string;
  /** Every document the view needs: its entity, and for a dashboard the views it embeds. */
  readonly documents: readonly Document[];
  /** Renders one state with the host's renderer. Called once per state. */
  readonly render: (state: SourceViewState, context: StateRenderContext) => ReactNode;
  /** Passed to `render` as `context.registry`. Defaults to the mock registry. */
  readonly registry?: Registry<ReactNode>;
  /** The moment relative dates resolve against. Required, so the states are the same on every run. */
  readonly now: Date;
  /** The most data states (see `viewStates`). */
  readonly limit?: ViewStatesOptions["limit"];
  readonly embeddedLimit?: ViewStatesOptions["embeddedLimit"];
  readonly manyRecords?: ViewStatesOptions["manyRecords"];
  /** Checks to leave out. */
  readonly skip?: readonly StateCheck[];
  /** How long to wait for a loading source to (not) settle, in milliseconds. Defaults to 30. */
  readonly settleMs?: number;
  /** The longest to wait for a ready state to stop showing a loading indicator, in milliseconds. Defaults to 2000. */
  readonly timeoutMs?: number;
}

const AXE_NAME_RULES = [
  "button-name",
  "input-button-name",
  "label",
  "select-name",
  "link-name",
  "aria-input-field-name",
  "aria-toggle-field-name",
  "aria-command-name",
  "aria-dialog-name",
  "aria-meter-name",
  "aria-progressbar-name",
  "aria-tooltip-name",
  "aria-treeitem-name",
  "role-img-alt",
  "image-alt",
  "frame-title",
  "summary-name",
  "nested-interactive",
];

/**
 * Renders every state of a view (its data states from `viewStates` crossed with
 * the source states from `sourceStates`) with the host's `render` function and
 * checks each one. Needs a DOM: call it from a test file with
 * `// @vitest-environment jsdom`.
 */
export async function checkViewStates(options: CheckViewStatesOptions): Promise<StateCheckResult[]> {
  const { documents, now } = options;
  const view = typeof options.view === "string" ? documents.find((d): d is ViewDocument => isView(d) && d.id === options.view) : options.view;
  if (!view) throw new RangeError(`view "${String(options.view)}" is not among the documents`);
  const entity = "entity" in view ? documents.find((d): d is EntityDocument => d.kind === "entity" && d.id === view.entity) : undefined;
  const registry = options.registry ?? mockRegistry;
  const skip = new Set(options.skip ?? []);
  const keys = new Set<string>(documents.flatMap((d) => (isView(d) && "dataSource" in d ? [d.dataSource] : [])));
  if ("dataSource" in view) keys.add(view.dataSource);

  const stateOptions: ViewStatesOptions = {
    now,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.embeddedLimit !== undefined ? { embeddedLimit: options.embeddedLimit } : {}),
    ...(options.manyRecords !== undefined ? { manyRecords: options.manyRecords } : {}),
  };
  const states = sourceStates(viewStates(view, documents, stateOptions), documents).states;

  const results: StateCheckResult[] = [];
  for (const state of states) {
    const problems = await checkState(state, view, entity, documents, registry, keys, options, skip);
    results.push({ id: state.id, label: state.label, problems: problems.filter((p) => !skip.has(p.check)) });
  }
  return results;
}

/**
 * Flattens results into one line per problem, "<state label>: <check>: <message>".
 * Use `expect(problems(await checkViewStates(...))).toEqual([])`: a failure lists every failing state.
 */
export function problems(results: readonly StateCheckResult[]): string[] {
  return results.flatMap((r) => r.problems.map((p) => `${r.label} [${r.id}]: ${p.check}: ${p.message}`));
}

async function checkState(
  state: SourceViewState,
  view: ViewDocument,
  entity: EntityDocument | undefined,
  documents: readonly Document[],
  registry: Registry<ReactNode>,
  keys: ReadonlySet<string>,
  options: CheckViewStatesOptions,
  skip: ReadonlySet<StateCheck>,
): Promise<StateProblem[]> {
  const found: StateProblem[] = [];
  const adapter = state.adapter();
  const seen: Seen = { tables: [], tabs: [], calendars: [], boards: [] };
  const observed = observe(registry, seen);
  const dataSources = new Map<string, DataAdapter>([...keys].map((k) => [k, adapter]));
  const drafts = draftsFor(state, entity);
  const logged: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ").slice(0, 300));
  });
  let unmount: (() => void) | undefined;
  try {
    let container: HTMLElement;
    try {
      const element = options.render(state, { view, entity, documents, registry: observed, adapter, dataSources, drafts, now: options.now, viewer: state.viewer, omitViewer: state.omitViewer === true });
      const mounted = mount(element);
      unmount = mounted.unmount;
      container = mounted.container;
    } catch (error) {
      found.push({ check: "render-threw", message: errorText(error) });
      return found;
    }
    try {
      await settle(container, state, options);
      if (state.render.kind === "dashboard") await openTab(container, view, state);
      await settle(container, state, options);
    } catch (error) {
      found.push({ check: "render-threw", message: errorText(error) });
      return found;
    }
    for (const line of logged) found.push({ check: "console-error", message: line });
    if (view.kind === "form" && entity) found.push(...formChecks(container, view, entity, state));
    found.push(...viewerChecks(container, view, state, seen));
    found.push(...groupChecks(state, seen));
    found.push(...calendarChecks(state, seen));
    if (!skip.has("accessible-name")) found.push(...(await nameChecks(container)));
    if (!skip.has("error-message") && state.source === "error") found.push(...errorChecks(container, adapter));
  } finally {
    unmount?.();
    spy.mockRestore();
  }
  return found;
}

const isView = (d: Document): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The saved-draft path is how a renderer takes a form state's values. */
function draftsFor(state: SourceViewState, entity: EntityDocument | undefined): { readonly store: DraftStore } | undefined {
  if (state.render.kind !== "form" || !entity || Object.keys(state.render.values).length === 0) return undefined;
  const data = new Map<string, string>();
  const store = createDraftStore({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  });
  store.save(state.render.view, undefined, { values: state.render.values, entityRevision: entity.revision, savedAt: state.render.now.getTime() });
  return { store };
}

const isBusy = (container: HTMLElement): boolean => container.querySelector('[aria-busy="true"]') !== null || /(^|\s)Loading…/.test(container.textContent ?? "");

/** Lets pending reads settle. A loading source never does, so it only gets a short wait. */
async function settle(container: HTMLElement, state: SourceViewState, options: CheckViewStatesOptions): Promise<void> {
  const pause = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
  await pause(0);
  if (state.source === "loading") return pause(options.settleMs ?? 30);
  const deadline = Date.now() + (options.timeoutMs ?? 2000);
  while (isBusy(container) && Date.now() < deadline) await pause(10);
  await pause(0);
}

/** A dashboard shows its first tab; the state may be on another. */
async function openTab(container: HTMLElement, view: ViewDocument, state: SourceViewState): Promise<void> {
  if (view.kind !== "dashboard" || state.render.kind !== "dashboard") return;
  const tabId = state.render.tab;
  if (view.tabs[0]?.id === tabId) return;
  // A tab this viewer may not see is not listed, so there is nothing to open: the check below sees that it is absent.
  if (!visibleTabs(view, state.viewer).some((t) => t.id === tabId)) return;
  const title = view.tabs.find((t) => t.id === tabId)?.title;
  const button = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((b) => b.textContent?.trim() === title);
  if (!button) throw new Error(`no tab named "${title ?? tabId}" to open`);
  await act(async () => void button.click());
}

/** Which of the entity's fields have a control on screen, found by the control id the renderer gives each (`...-<fieldId>`). */
function shownFields(container: HTMLElement, entity: EntityDocument, ids: readonly string[]): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  const byLength = [...ids].sort((a, b) => b.length - a.length);
  for (const el of container.querySelectorAll<HTMLElement>("[data-yadad-form] [id]")) {
    const id = el.id;
    const field = byLength.find((f) => id.endsWith(`-${f}`) && entity.fields.some((x) => x.id === f));
    if (field !== undefined && !found.has(field)) found.set(field, el);
  }
  return found;
}

function markedRequired(container: HTMLElement, control: HTMLElement): boolean {
  if ((control as HTMLInputElement).required === true || control.getAttribute("aria-required") === "true") return true;
  const label = control.id ? container.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
  return label !== null && /\*|\brequired\b/i.test(label.textContent ?? "");
}

function formChecks(container: HTMLElement, view: FormView, entity: EntityDocument, state: SourceViewState): StateProblem[] {
  const out: StateProblem[] = [];
  if (state.render.kind !== "form") return out;
  const items = view.sections.flatMap((s) => s.items);
  const rules = evaluateFormRules(view, state.render.values, state.viewer);
  const shown = shownFields(container, entity, items.map((i) => i.field));
  for (const item of items) {
    const field = entity.fields.find((f) => f.id === item.field);
    const control = shown.get(item.field);
    if (rules.hidden.has(item.field)) {
      if (control) out.push({ check: "field-shown-but-hidden", message: `"${item.field}" is shown but its visibleWhen is false` });
      continue;
    }
    if (!control) {
      out.push({ check: "field-missing", message: `"${item.field}" is not shown but its visibleWhen is true` });
      continue;
    }
    const expected = field?.required === true || rules.required.has(item.field);
    const marked = markedRequired(container, control);
    if (expected !== marked) out.push({ check: "required-marker", message: `"${item.field}" ${marked ? "is marked required but is not" : "is required but not marked"} in this state` });
  }
  return out;
}

async function nameChecks(container: HTMLElement): Promise<StateProblem[]> {
  const results = await axe.run(container, { runOnly: { type: "rule", values: AXE_NAME_RULES }, resultTypes: ["violations"] });
  return results.violations.flatMap((v) => v.nodes.map((n) => ({ check: "accessible-name" as const, message: `${v.help}: ${n.html.slice(0, 120)}` })));
}

/** A failed read must put its message on screen. */
function errorChecks(container: HTMLElement, adapter: StateAdapter): StateProblem[] {
  const text = container.textContent ?? "";
  if (adapter.options.message !== "" && text.includes(adapter.options.message)) return [];
  return [{ check: "error-message", message: `the data source failed ("${adapter.options.message}") but no message is visible` }];
}

/** What the registry's layout components were given, in the order they rendered. */
interface Seen {
  readonly tables: TableProps<ReactNode>[];
  readonly tabs: TabsProps<ReactNode>[];
  readonly calendars: CalendarProps<ReactNode>[];
  readonly boards: BoardProps<ReactNode>[];
}

/** The registry with its layout components wrapped to record their props. It knows no component. */
function observe(registry: Registry<ReactNode>, seen: Seen): Registry<ReactNode> {
  const layout = registry.layout;
  const { Table, Tabs, Calendar, Board } = layout;
  return {
    ...registry,
    layout: {
      ...layout,
      Table: (props) => (seen.tables.push(props), Table(props)),
      Tabs: (props) => (seen.tabs.push(props), Tabs(props)),
      ...(Calendar ? { Calendar: (props: CalendarProps<ReactNode>) => (seen.calendars.push(props), Calendar(props)) } : {}),
      ...(Board ? { Board: (props: BoardProps<ReactNode>) => (seen.boards.push(props), Board(props)) } : {}),
    },
  };
}

/** A board state names the field it is grouped by; the board the renderer drew must use it. */
function groupChecks(state: SourceViewState, seen: Seen): StateProblem[] {
  const board = seen.boards.at(-1);
  if (state.render.kind !== "board" || !board || state.render.groupBy === "") return [];
  if (board.groupField === state.render.groupBy) return [];
  return [{ check: "group-by-ignored", message: `this state is grouped by "${state.render.groupBy}" but the board is grouped by "${board.groupField}"` }];
}

/** A calendar state names a mode and the range it shows; the calendar the renderer drew must open on both. */
function calendarChecks(state: SourceViewState, seen: Seen): StateProblem[] {
  const calendar = seen.calendars.at(-1);
  if (state.render.kind !== "calendar" || !calendar) return [];
  const { mode, range, anchor } = state.render;
  if (calendar.mode !== mode) return [{ check: "mode-ignored", message: `this state is in ${mode} mode but the calendar is in ${calendar.mode} mode` }];
  const first = calendar.days.at(0)?.date;
  const last = calendar.days.at(-1)?.date;
  if (first === range.first && last === range.last) return [];
  return [{ check: "anchor-ignored", message: `this state is anchored on ${anchor} (${range.first} to ${range.last}) but the calendar shows ${first ?? "nothing"} to ${last ?? "nothing"}` }];
}

const buttonsNamed = (container: HTMLElement, match: (text: string) => boolean): number => [...container.querySelectorAll("button")].filter((b) => match(b.textContent?.trim() ?? "")).length;

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * What the viewer may see and do, against what the registry was given (RFC 0006):
 * tabs and table columns shown only when allowed; an inline editor, a move or an
 * open handler offered only when the viewer condition holds and the record is
 * not locked, and offered whenever both do.
 */
function viewerChecks(container: HTMLElement, view: ViewDocument, state: SourceViewState, seen: Seen): StateProblem[] {
  const out: StateProblem[] = [];
  const viewer = state.viewer;
  const refusedId = (id: string): boolean => {
    const render = state.render;
    const record = render.kind === "table" || render.kind === "calendar" || render.kind === "board" ? render.records.find((r) => r.id === id) : undefined;
    return record !== undefined && !canUpdate(record);
  };
  if (view.kind === "dashboard") {
    const tabs = seen.tabs.at(-1)?.tabs.map((t) => t.id);
    const expected = visibleTabs(view, viewer).map((t) => t.id);
    if (tabs && !same(tabs, expected)) out.push({ check: "viewer-visibility", message: `tabs shown are [${tabs.join(", ")}] but this viewer may see [${expected.join(", ")}]` });
  }
  if (view.kind === "table") {
    const table = seen.tables.at(-1);
    const shown = visibleColumns(view, viewer);
    // a trailing "_actions" column is the renderer's own (edit and open buttons), not a document column
    const headers = table?.columns.map((c) => c.id).filter((id) => !id.startsWith("_")) ?? [];
    if (table && shown.length > 0 && !same(headers, shown.map((c) => c.field))) {
      out.push({ check: "viewer-visibility", message: `columns shown are [${headers.join(", ")}] but this viewer may see [${shown.map((c) => c.field).join(", ")}]` });
    }
    if (table && shown.length === 0) out.push({ check: "viewer-visibility", message: "a table is rendered although this viewer may see none of its columns" });
    if (table) {
      const anyColumn = shown.some((c) => columnEditable(c, viewer));
      const expected = anyColumn ? table.rows.filter((r) => !refusedId(r.id)).length : 0;
      const edits = buttonsNamed(container, (t) => t === "Edit");
      if (edits > expected) out.push({ check: "editable-offered", message: `${edits} rows offer an inline edit but this viewer or the record may edit in ${expected}` });
      if (edits < expected) out.push({ check: "editable-missing", message: `${edits} rows offer an inline edit but ${expected} may be edited` });
      if (view.rowAction) {
        const opens = buttonsNamed(container, (t) => t.startsWith("Open "));
        const want = rowActionVisible(view.rowAction, viewer) ? table.rows.length : 0;
        if (opens > want) out.push({ check: "editable-offered", message: `${opens} rows open another view but this viewer may not` });
        if (opens < want) out.push({ check: "editable-missing", message: `${opens} of ${want} rows open another view although this viewer may` });
      }
    }
  }
  if (view.kind === "calendar" || view.kind === "board") {
    const editable = viewEditable(view, viewer);
    const calendar = seen.calendars.at(-1);
    const board = seen.boards.at(-1);
    const items: readonly { readonly id: string; readonly movable: boolean }[] = calendar ? calendar.days.flatMap((d) => d.entries) : board ? board.columns.flatMap((c) => c.cards) : [];
    const onMove = calendar ? calendar.onMove : board?.onMove;
    const onOpen = calendar ? calendar.onOpenEntry : board?.onOpenCard;
    if (calendar || board) {
      if (!editable && onMove) out.push({ check: "editable-offered", message: "onMove is passed but this viewer may not move" });
      if (editable && !onMove) out.push({ check: "editable-missing", message: "onMove is not passed although this viewer may move" });
      for (const item of items) {
        const expected = editable && !refusedId(item.id);
        if (item.movable && !expected) out.push({ check: "editable-offered", message: `"${item.id}" is movable but ${editable ? "the record is locked" : "this viewer may not move"}` });
        if (!item.movable && expected) out.push({ check: "editable-missing", message: `"${item.id}" is not movable although it may be moved` });
      }
      if (view.rowAction) {
        const want = rowActionVisible(view.rowAction, viewer);
        if (want && !onOpen) out.push({ check: "editable-missing", message: "entries do not open another view although this viewer may" });
        if (!want && onOpen) out.push({ check: "editable-offered", message: "entries open another view but this viewer may not" });
      }
    }
  }
  return out;
}
