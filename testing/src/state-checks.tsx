// Check every state of a view in one test, imported as "@yadad/testing/state-checks"
// (like the contract kit it needs a DOM and a test runner, so the main entry
// stays free of them). It never imports a renderer: the host passes a
// `render` function that wires its own.

import { act, render as mount } from "@testing-library/react";
import type { BoardProps, CalendarProps, DataAdapter, DataRecord, DiffSegment, Document, EntityDocument, FieldDisplayProps, FormView, Registry, ResolvedViewer, TableProps, TabsProps, ViewDocument } from "@yadad/core";
import { availableActions, canUpdate, columnEditable, compareCells, createDraftStore, evaluateFormRules, rowActionVisible, viewEditable, viewStates, visibleColumns, visibleTabs } from "@yadad/runtime";
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
  | "anchor-ignored"
  | "action-offered"
  | "action-missing"
  | "diff-missing"
  | "diff-offered";

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
  /** Zone generated `datetime` values are rendered in; passed to `viewStates` (defaults to "UTC" there). */
  readonly timeZone?: string;
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

export interface StateCheckReport {
  readonly results: StateCheckResult[];
  /** How many states were rendered — size test timeouts by this, not by guesswork. */
  readonly states: number;
  /** `"full"`: every combination of the axes. `"pairwise"`: every pair of values from two axes appears in some state. */
  readonly strategy: "full" | "pairwise";
  /** False when `limit` cut the grid short: a green run then covers a sample, not every combination. */
  readonly complete: boolean;
  /** The ids of the axes the grid varied along (the data axes, then `source`). */
  readonly axes: readonly string[];
  /** States the grid left out on purpose (e.g. a state a condition makes unreachable). */
  readonly skipped: number;
}

/**
 * Like `checkViewStates`, but reports what the grid actually covered: a green
 * run over a view with 9,000 combinations may prove only a pairwise cover, and
 * a consumer sizing test timeouts needs the state count, not a guess.
 */
export async function checkViewStatesReport(options: CheckViewStatesOptions): Promise<StateCheckReport> {
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
    ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
  };
  const grid = sourceStates(viewStates(view, documents, stateOptions), documents);

  const results: StateCheckResult[] = [];
  for (const state of grid.states) {
    const problems = await checkState(state, view, entity, documents, registry, keys, options, skip);
    results.push({ id: state.id, label: state.label, problems: problems.filter((p) => !skip.has(p.check)) });
  }
  return { results, states: results.length, strategy: grid.strategy, complete: grid.complete, axes: grid.axes.map((a) => a.id), skipped: grid.skipped.length };
}

/**
 * Renders every state of a view (its data states from `viewStates` crossed with
 * the source states from `sourceStates`) with the host's `render` function and
 * checks each one. Needs a DOM: call it from a test file with
 * `// @vitest-environment jsdom`. For what the grid covered, call
 * `checkViewStatesReport` — this is its `results`.
 */
export async function checkViewStates(options: CheckViewStatesOptions): Promise<StateCheckResult[]> {
  return (await checkViewStatesReport(options)).results;
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
  const seen: Seen = { tables: [], tabs: [], calendars: [], boards: [], displays: [] };
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
    if (entity) {
      found.push(...actionChecks(entity, view, documents, state, seen));
      found.push(...diffChecks(entity, view, state, seen));
    }
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
  const visible = visibleTabs(view, state.viewer);
  if (!visible.some((t) => t.id === tabId)) return;
  // One visible tab means no strip at all: the renderer shows that tab's grid directly.
  if (visible.length === 1) return;
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
  /** One entry per field value the registry's Display components rendered, in order (RFC 0007 props checks). */
  readonly displays: Displayed[];
}

/** One text value as the registry's Display got it: what the compare checks read. */
interface Displayed {
  /** The `diff` extras the text Display was given, if any (RFC 0007 compare columns). */
  readonly diff: readonly DiffSegment[] | undefined;
}

/** The registry with its layout components wrapped to record their props. It knows no component. */
function observe(registry: Registry<ReactNode>, seen: Seen): Registry<ReactNode> {
  const layout = registry.layout;
  const { Table, Tabs, Calendar, Board } = layout;
  const textEntry = registry.fields.text;
  const TextDisplay = textEntry.Display;
  return {
    ...registry,
    fields: {
      ...registry.fields,
      text: {
        ...textEntry,
        // Records the `diff` each text value was given; the compare checks read it.
        Display: (props: FieldDisplayProps<"text">) => (seen.displays.push({ diff: props.diff }), TextDisplay(props)),
      },
    },
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

interface ActionUnit {
  readonly kind: "table" | "calendar" | "board";
  readonly viewId: string;
  readonly records: readonly DataRecord[];
  readonly items: readonly { readonly id: string; readonly actions: readonly string[] | undefined }[];
}

/**
 * RFC 0007: the action buttons the registry was given must be exactly the
 * actions the record allows — `availableActions` is the one answer, so a
 * withheld action (`can.actions[id] === false`), one whose `visibleWhen` is
 * false for this state, or one that should be there and is not, all surface.
 */
function actionChecks(entity: EntityDocument, view: ViewDocument, documents: readonly Document[], state: SourceViewState, seen: Seen): StateProblem[] {
  const out: StateProblem[] = [];
  const views = new Map(documents.filter((d): d is ViewDocument => isView(d)).map((d) => [d.id, d]));
  const units: ActionUnit[] = [];
  const walk = (v: ViewDocument, render: SourceViewState["render"]): void => {
    if (v.kind === "table" && render.kind === "table") {
      const table = seen.tables.at(-1);
      if (table) units.push({ kind: "table", viewId: v.id, records: render.records, items: table.rows.map((r) => ({ id: r.id, actions: r.actions?.map((a) => a.id) })) });
    } else if (v.kind === "calendar" && render.kind === "calendar") {
      const calendar = seen.calendars.at(-1);
      if (calendar) units.push({ kind: "calendar", viewId: v.id, records: render.records, items: calendar.days.flatMap((d) => d.entries).map((e) => ({ id: e.id, actions: e.actions?.map((a) => a.id) })) });
    } else if (v.kind === "board" && render.kind === "board") {
      const board = seen.boards.at(-1);
      if (board) units.push({ kind: "board", viewId: v.id, records: render.records, items: board.columns.flatMap((c) => c.cards).map((k) => ({ id: k.id, actions: k.actions?.map((a) => a.id) })) });
    } else if (v.kind === "dashboard" && render.kind === "dashboard") {
      for (const widget of render.widgets) {
        const target = views.get(widget.view);
        if (target) walk(target, widget.state.render);
      }
    }
  };
  walk(view, state.render);
  for (const unit of units) {
    const unitView = views.get(unit.viewId);
    const offered = unitView !== undefined && "recordActions" in unitView ? unitView.recordActions : undefined;
    if (offered === undefined) continue;
    for (const item of unit.items) {
      const record = unit.records.find((r) => r.id === item.id);
      if (record === undefined) continue;
      const expected = availableActions(entity, { recordActions: offered }, record, state.viewer).map((a) => a.id);
      const actual = item.actions ?? [];
      for (const id of actual) {
        if (!expected.includes(id)) out.push({ check: "action-offered", message: `${unit.kind} "${unit.viewId}" offers "${id}" on "${item.id}" but it is withheld or its visibleWhen is false for this state` });
      }
      for (const id of expected) {
        if (!actual.includes(id)) out.push({ check: "action-missing", message: `${unit.kind} "${unit.viewId}" hides "${id}" on "${item.id}" although this state allows it` });
      }
    }
  }
  return out;
}

/**
 * RFC 0007: a `compare` column's cells are word diffs against the comparator,
 * so a drawn row WITH a neighbour must reach its text Display with `diff`, and
 * a drawn row without one must not. The registry's text Display was wrapped to
 * record its props; `compareCells` is the one answer for who has a neighbour.
 */
function diffChecks(entity: EntityDocument, view: ViewDocument, state: SourceViewState, seen: Seen): StateProblem[] {
  const out: StateProblem[] = [];
  const render = state.render;
  if (view.kind !== "table" || render.kind !== "table" || render.records.length === 0) return out;
  const table = seen.tables.at(-1);
  if (table === undefined) return out;
  // The rows the component actually drew, in the order it drew them — the
  // positional compares (previousRow/nextRow) depend on the display order.
  const drawn = table.rows
    .map((r) => render.records.find((rec) => rec.id === r.id))
    .filter((r): r is DataRecord => r !== undefined);
  if (drawn.length === 0) return out;
  for (const column of view.columns) {
    if (column.compare === undefined) continue;
    const field = entity.fields.find((f) => f.id === column.field);
    if (field === undefined || field.type !== "text") continue; // the renderer only diffs text columns; validation owns the rest
    const cells = compareCells(drawn, { field: column.field, compare: column.compare });
    // A row whose comparator side is both-empty gets an EMPTY diff from
    // compareCells — it still has a neighbour, so a Display given `diff={[]}`
    // counts as given a diff. Any text Display reached with a `diff` prop does.
    const gotDiff = seen.displays.some((d) => d.diff !== undefined);
    const anyNeighbour = cells.some((c) => c !== undefined);
    if (anyNeighbour && !gotDiff) {
      out.push({ check: "diff-missing", message: `column "${column.field}" compares and a neighbour is present, but its Display was given no diff` });
    }
    if (!anyNeighbour && gotDiff) {
      out.push({ check: "diff-offered", message: `column "${column.field}" compared every shown row against nothing, yet its Display was given a diff` });
    }
  }
  return out;
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
