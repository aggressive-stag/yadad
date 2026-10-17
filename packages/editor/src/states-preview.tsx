import type { Document, FormView, ViewDocument } from "@yadad/core";
import { evaluateCondition, viewStates } from "@yadad/runtime";
import type { ViewState, ViewStatesResult } from "@yadad/runtime";
import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

/** The most states the preview builds when `limit` is not given. */
export const STATES_PREVIEW_DEFAULT_LIMIT = 12;
/** Milliseconds the preview waits after the last edit before it runs the host's checks. */
export const STATES_PREVIEW_CHECK_DELAY = 250;
/** The width a state renders at before it is scaled down to its tile. */
const TILE_WIDTH = 800;

/** How a state differs from the saved revision. */
export type StateChange = "new" | "changed" | "unchanged";

export interface StateComparison {
  /** The change per state id of the edited document. */
  readonly changes: ReadonlyMap<string, StateChange>;
  /** States the saved revision has and the edited document no longer has. */
  readonly removed: readonly { readonly id: string; readonly label: string }[];
}

/** One problem the host's checks found in a state. */
export interface StateProblem {
  readonly check: string;
  readonly message: string;
}

export interface StateCheckFinding {
  /** The id of a state the preview built. */
  readonly id: string;
  readonly problems: readonly StateProblem[];
}

export interface StatesPreviewProps {
  /** The view as it is being edited (feed it from an editor's `onChange`). */
  readonly view: ViewDocument;
  /** The view as last saved: states that differ from it are marked. */
  readonly saved: ViewDocument;
  /** The entities and other views `view` refers to. `view` and `saved` replace any document of the same id. */
  readonly documents: readonly Document[];
  /** The moment relative dates resolve against. Required, so the states are a pure function of the input. */
  readonly now: Date;
  /**
   * Renders one state with the host's renderers and registry. The preview puts
   * the result in an inert, scaled-down tile and, when a tile is opened, at
   * full size. `documents` holds `view` as edited.
   */
  readonly renderState: (state: ViewState, documents: readonly Document[]) => ReactNode;
  /**
   * Optional: runs the host's checks (for example `checkViewStates` from
   * `@yadad/testing/state-checks`, which the editor may not import itself)
   * on the edited view and returns the problems per state. Called once the
   * document has stopped changing; an answer for an older document is dropped.
   */
  readonly checkStates?: (request: { readonly view: ViewDocument; readonly documents: readonly Document[]; readonly states: readonly ViewState[] }) => Promise<readonly StateCheckFinding[]>;
  /** The most states to build. Defaults to STATES_PREVIEW_DEFAULT_LIMIT. */
  readonly limit?: number;
  /** Passed to `viewStates`. */
  readonly manyRecords?: number;
}

function withView(documents: readonly Document[], ...views: readonly ViewDocument[]): Document[] {
  const ids = new Set(views.map((v) => v.id));
  return [...documents.filter((d) => !(d.kind !== "entity" && d.kind !== "viewer" && ids.has(d.id))), ...views];
}

/** The fields a form shows and the ones it requires in a state: the part of a form's rendering a condition changes. */
function formFields(view: FormView, state: ViewState): string {
  if (state.render.kind !== "form") return "";
  const { values, now } = state.render;
  const items = view.sections.flatMap((s) => s.items);
  const shown = items.filter((i) => i.visibleWhen === undefined || evaluateCondition(i.visibleWhen, values, now, state.viewer));
  const required = shown.filter((i) => i.requiredWhen !== undefined && evaluateCondition(i.requiredWhen, values, now, state.viewer));
  return JSON.stringify({ shown: shown.map((i) => i.field), required: required.map((i) => i.field) });
}

/** What makes a state look different: its label and values, and what the view shows in it. Never pixels. */
function signature(view: ViewDocument, state: ViewState): string {
  const base = { label: state.label, values: state.values };
  if (view.kind === "form") return JSON.stringify({ ...base, fields: formFields(view, state) });
  const render = state.render;
  if (render.kind === "table" || render.kind === "calendar" || render.kind === "board") return JSON.stringify({ ...base, matching: render.matching, kind: render });
  return JSON.stringify(base);
}

/**
 * Compares the states of the edited view with those of the saved revision. A
 * state is new when the saved revision has no state with its id, changed when
 * its label, axis values or (for a form) the fields it shows or requires
 * differ, and removed when only the saved revision has it.
 */
export function compareStates(saved: ViewDocument, savedStates: readonly ViewState[], edited: ViewDocument, editedStates: readonly ViewState[]): StateComparison {
  const before = new Map(savedStates.map((s) => [s.id, s]));
  const changes = new Map<string, StateChange>();
  for (const state of editedStates) {
    const old = before.get(state.id);
    changes.set(state.id, old === undefined ? "new" : signature(saved, old) === signature(edited, state) ? "unchanged" : "changed");
  }
  const kept = new Set(editedStates.map((s) => s.id));
  return { changes, removed: savedStates.filter((s) => !kept.has(s.id)).map((s) => ({ id: s.id, label: s.label })) };
}

type Built = { readonly ok: true; readonly result: ViewStatesResult } | { readonly ok: false; readonly error: string };

function build(view: ViewDocument, documents: readonly Document[], now: Date, limit: number, manyRecords: number | undefined): Built {
  try {
    return { ok: true, result: viewStates(view, documents, { now, limit, ...(manyRecords !== undefined ? { manyRecords } : {}) }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type Checks = { readonly key: string; readonly status: "running" | "done" | "failed"; readonly findings: ReadonlyMap<string, readonly StateProblem[]>; readonly message?: string };

const CHANGE_TEXT: Record<StateChange, string> = { new: "New", changed: "Changed", unchanged: "" };

/**
 * Every state of the view being edited, as a grid of live previews next to
 * the editor. It follows the document as it changes, marks the states that
 * are new or look different from the last saved revision (comparing the state
 * lists and, for a form, the fields each state shows; not pixels), and shows
 * the host's check problems per state. Each tile's button opens that state at
 * full size in place.
 */
export function StatesPreview({ view, saved, documents, now, renderState, checkStates, limit = STATES_PREVIEW_DEFAULT_LIMIT, manyRecords }: StatesPreviewProps): ReactNode {
  const base = useId();
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [changedOnly, setChangedOnly] = useState(false);
  const viewKey = JSON.stringify(view);
  const savedKey = JSON.stringify(saved);
  const docsKey = JSON.stringify(documents);
  const nowTime = now.getTime();

  const edited = useMemo(() => withView(documents, view), [docsKey, viewKey]);
  const previous = useMemo(() => withView(documents, saved), [docsKey, savedKey]);
  const built = useMemo(() => build(view, edited, now, limit, manyRecords), [edited, nowTime, limit, manyRecords]);
  const before = useMemo(() => build(saved, previous, now, limit, manyRecords), [previous, nowTime, limit, manyRecords]);
  const comparison = useMemo(
    () => (built.ok && before.ok ? compareStates(saved, before.result.states, view, built.result.states) : undefined),
    [built, before],
  );

  // The host's checks, once the document stops changing; an older answer is dropped.
  const [checks, setChecks] = useState<Checks | undefined>(undefined);
  const checkKey = `${viewKey}|${docsKey}|${nowTime}`;
  useEffect(() => {
    if (!checkStates || !built.ok) return;
    let stale = false;
    setChecks({ key: checkKey, status: "running", findings: new Map() });
    const timer = setTimeout(() => {
      checkStates({ view, documents: edited, states: built.result.states }).then(
        (findings) => !stale && setChecks({ key: checkKey, status: "done", findings: new Map(findings.map((f) => [f.id, f.problems])) }),
        (error: unknown) => !stale && setChecks({ key: checkKey, status: "failed", findings: new Map(), message: error instanceof Error ? error.message : String(error) }),
      );
    }, STATES_PREVIEW_CHECK_DELAY);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // checkKey stands in for the document objects; the callbacks are the host's latest.
  }, [checkKey, built.ok]);
  const current = checks?.key === checkKey ? checks : undefined;

  if (!built.ok) return (
    <section aria-label="States preview" data-yadad-states-preview="">
      <p role="alert">The states could not be built: {built.error}</p>
    </section>
  );

  const { states, skipped, complete } = built.result;
  const changeOf = (id: string): StateChange => comparison?.changes.get(id) ?? "unchanged";
  const changedCount = states.filter((s) => changeOf(s.id) !== "unchanged").length;
  const shown = changedOnly ? states.filter((s) => changeOf(s.id) !== "unchanged") : states;
  const opened = open === undefined ? undefined : states.find((s) => s.id === open);
  const problemsOf = (id: string): readonly StateProblem[] => current?.findings.get(id) ?? [];
  const failing = current?.status === "done" ? states.filter((s) => problemsOf(s.id).length > 0).length : 0;

  return (
    <section aria-label="States preview" data-yadad-states-preview="">
      <h3 id={`${base}-title`}>States preview</h3>
      <label>
        <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Only new and changed states
      </label>
      <p role="status" data-yadad-states-status="">
        {states.length} {states.length === 1 ? "state" : "states"}
        {complete ? "" : " (the view has more combinations than the limit)"}. {changedCount === 0 ? "None differ from the saved revision." : `${changedCount} new or changed since the saved revision.`}
        {comparison && comparison.removed.length > 0 && ` ${comparison.removed.length} no longer ${comparison.removed.length === 1 ? "applies" : "apply"}.`}
        {current?.status === "running" && " Checking…"}
        {current?.status === "done" && (failing === 0 ? " Checks found no problems." : ` Checks found problems in ${failing} ${failing === 1 ? "state" : "states"}.`)}
        {current?.status === "failed" && ` The checks could not run: ${current.message ?? ""}.`}
      </p>
      {comparison && comparison.removed.length > 0 && (
        <details data-yadad-states-removed="">
          <summary>States only the saved revision has</summary>
          <ul>
            {comparison.removed.map((s) => (
              <li key={s.id}>{s.label}</li>
            ))}
          </ul>
        </details>
      )}
      {skipped.length > 0 && (
        <details>
          <summary>{skipped.length} states could not be built</summary>
          <ul>
            {skipped.map((s) => (
              <li key={s.id}>
                {s.id}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {opened && (
        <div data-yadad-state-open={opened.id}>
          <button type="button" onClick={() => setOpen(undefined)} data-yadad-state-close="">
            Close {opened.label}
          </button>
          <h4>{opened.label}</h4>
          {renderState(opened, edited)}
        </div>
      )}
      <ul aria-label="States" data-yadad-states-grid="" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(14rem, 100%), 1fr))", gap: "var(--yadad-space-2, 0.5rem)" }}>
        {shown.map((state) => (
          <StateTile
            key={state.id}
            state={state}
            change={changeOf(state.id)}
            problems={problemsOf(state.id)}
            checked={current?.status === "done"}
            open={open === state.id}
            onToggle={() => setOpen(open === state.id ? undefined : state.id)}
            content={() => renderState(state, edited)}
            tileId={`${base}-${state.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
          />
        ))}
      </ul>
    </section>
  );
}

function StateTile({ state, change, problems, checked, open, onToggle, content, tileId }: { readonly state: ViewState; readonly change: StateChange; readonly problems: readonly StateProblem[]; readonly checked: boolean; readonly open: boolean; readonly onToggle: () => void; readonly content: () => ReactNode; readonly tileId: string }): ReactNode {
  return (
    <li data-yadad-state={state.id} data-change={change} data-problems={problems.length} style={{ border: "1px solid var(--yadad-border, #c9c9c9)", padding: "var(--yadad-space-2, 0.5rem)", minWidth: 0 }}>
      <button type="button" aria-expanded={open} aria-describedby={problems.length > 0 ? `${tileId}-problems` : undefined} onClick={onToggle}>
        {state.label}
      </button>
      {change !== "unchanged" && (
        <span data-yadad-state-change={change}>
          {" "}
          [{CHANGE_TEXT[change]}]
        </span>
      )}
      {problems.length > 0 && <span data-yadad-state-marker=""> ⚠ {problems.length === 1 ? "1 problem" : `${problems.length} problems`}</span>}
      {problems.length === 0 && checked && <span data-yadad-state-ok=""> ✓</span>}
      <div aria-hidden="true" data-yadad-state-preview="" style={{ overflow: "hidden", height: "8rem", position: "relative" }}>
        <div inert style={{ width: TILE_WIDTH, transform: "scale(0.3)", transformOrigin: "top left" }}>
          {content()}
        </div>
      </div>
      {problems.length > 0 && (
        <ul id={`${tileId}-problems`} data-yadad-state-problems="">
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
