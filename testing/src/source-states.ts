import type { Document, EntityDocument, ViewDocument } from "@yadad/core";
import type { StateAxis, ViewState, ViewStatesResult } from "@yadad/runtime";
import { validateRecord } from "@yadad/runtime";
import type { SourceState, StateAdapter, StateAdapterOptions } from "./state-adapter.js";
import { createStateAdapter } from "./state-adapter.js";

/** The `source` axis: how the data source behaves. Only the values that make sense for the view are listed. */
export interface SourceAxis {
  readonly id: "source";
  readonly label: string;
  readonly kind: "source";
  readonly values: readonly { readonly id: SourceState; readonly label: string }[];
}

/** A view state paired with a source state. */
export interface SourceViewState extends Omit<ViewState, "values"> {
  readonly values: Readonly<Record<string, string>>;
  readonly source: SourceState;
  /** The state's own data state (`base.id`), before the source was added. */
  readonly base: ViewState;
  /** A fresh adapter seeded with this state's records and put in this source state. */
  adapter(options?: Omit<StateAdapterOptions, "source">): StateAdapter;
}

export interface SourceStatesResult {
  readonly view: string;
  /** The data axes of the view, then the `source` axis. */
  readonly axes: readonly (StateAxis | SourceAxis)[];
  /** Every data state with a ready source, then one state per other applicable source. */
  readonly states: readonly SourceViewState[];
  readonly skipped: ViewStatesResult["skipped"];
  readonly strategy: ViewStatesResult["strategy"];
  readonly complete: boolean;
}

const LABELS: Record<SourceState, string> = {
  ready: "ready",
  loading: "loading",
  error: "failed to load",
  refused: "save refused",
  conflict: "save conflicts",
  "notice-info": "server notice (info)",
  "notice-warning": "server notice (warning)",
};

/**
 * The source states that make sense for a view: a save can only be refused or
 * conflict where the view writes, and a conflict needs a stored record to
 * collide with (so not a form, which only creates).
 */
export function applicableSources(view: ViewDocument): readonly SourceState[] {
  switch (view.kind) {
    case "form":
      return ["ready", "refused"];
    case "table":
      // RFC 0010 item 7: only a table lists with a page, so only a table can carry the server's notice.
      return view.columns.some((c) => c.editable === true) ? ["ready", "loading", "error", "refused", "conflict", "notice-info", "notice-warning"] : ["ready", "loading", "error", "notice-info", "notice-warning"];
    case "calendar":
    case "board":
      return view.editable === true ? ["ready", "loading", "error", "refused", "conflict"] : ["ready", "loading", "error"];
    case "dashboard":
      return ["ready", "loading", "error"];
  }
}

function recordCount(state: ViewState): number {
  const render = state.render;
  if (render.kind === "form") return 0;
  if (render.kind === "dashboard") return render.widgets.reduce((n, w) => n + recordCount(w.state), 0);
  return render.records.length;
}

/** The state a source mode is shown on: one that gives it something to act on. */
function representative(source: SourceState, states: readonly ViewState[], entity: EntityDocument | undefined): ViewState | undefined {
  if (source === "loading" || source === "error") return states[0];
  if (source === "notice-info" || source === "notice-warning") return states.reduce<ViewState | undefined>((best, s) => (best === undefined || recordCount(s) > recordCount(best) ? s : best), undefined); // no records are shown, so the data does not matter
  const first = states[0];
  if (first?.render.kind === "form") {
    // A refused save is most telling when the draft was valid.
    const valid = entity ? states.find((s) => s.render.kind === "form" && validateRecord(entity, s.render.values).length === 0) : undefined;
    return valid ?? first;
  }
  // Something to move or edit: the state with the most records.
  return states.reduce<ViewState | undefined>((best, s) => (best === undefined || recordCount(s) > recordCount(best) ? s : best), undefined);
}

/**
 * Adds a `source` axis to card 19's `viewStates` output. The data axes are not
 * recombined: loading and failure show no records, and a refused or conflicting
 * save needs one saved draft or record, so each non-ready source gets exactly one
 * state, built on the existing data state that suits it. Every data state stays
 * once with `source = ready`, so no data state is lost.
 */
export function sourceStates(result: ViewStatesResult, documents: readonly Document[]): SourceStatesResult {
  const view = documents.find((d): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer" && d.id === result.view);
  if (!view) throw new RangeError(`view "${result.view}" is not among the documents`);
  const entity = "entity" in view ? documents.find((d): d is EntityDocument => d.kind === "entity" && d.id === view.entity) : undefined;
  const sources = applicableSources(view);
  const axis: SourceAxis = { id: "source", label: "Data source", kind: "source", values: sources.map((id) => ({ id, label: LABELS[id] })) };

  const build = (base: ViewState, source: SourceState): SourceViewState => {
    const first = base.render.kind === "form" ? Object.keys(base.render.values)[0] : undefined;
    return {
      id: base.id === "default" ? `source=${source}` : `${base.id};source=${source}`,
      label: source === "ready" ? base.label : `${LABELS[source]} · ${base.label}`,
      values: { ...base.values, source },
      render: base.render,
      viewer: base.viewer,
      ...(base.omitViewer ? { omitViewer: true as const } : {}),
      source,
      base,
      adapter: (options = {}) => createStateAdapter(base, { source, ...(first !== undefined ? { field: first } : {}), ...options }),
    };
  };

  const states: SourceViewState[] = result.states.map((s) => build(s, "ready"));
  for (const source of sources) {
    if (source === "ready") continue;
    const base = representative(source, result.states, entity);
    if (base) states.push(build(base, source));
  }
  return { view: result.view, axes: [...result.axes, axis], states, skipped: result.skipped, strategy: result.strategy, complete: result.complete };
}
