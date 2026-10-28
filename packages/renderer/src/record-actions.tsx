import { ForbiddenError, RecordConflictError, RecordNotFoundError, RecordValidationError, UnauthorizedError, jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, DocumentError, EntityDocument, Field, RecordAction, RecordActionItem, RecordValues, Registry, ResolvedViewer } from "@yadad/core";
import { actionNeedsDialog, availableActions, serverValidationIssues, validateActionInput } from "@yadad/runtime";
import type { ActionsView } from "@yadad/runtime";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { renderDisplay, renderInput } from "./fields.js";
import type { FieldFormatting } from "./fields.js";
import { useReferences } from "./references.js";
import type { ReferenceSupport, ReferenceWant } from "./references.js";

/** How many renders the focus-return effect retries across after a flight ends (todo-app F14 part B). */
const RESTORE_ATTEMPTS = 50;
/** How long a restore that has succeeded stays armed for a LATER rebuild of the control (a sibling widget's reload, a second fetch). */
const WATCH_MS = 1500;

/** A record's place in a view: its group (a board column id, a calendar day, "" for a table) and its index within the group. */
interface Place {
  readonly group: string;
  readonly index: number;
}

function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  return a !== undefined && b !== undefined && a.group === b.group && a.index === b.index;
}

/** The node and its ancestors up to (not including) body, each with its index among its parent's children. */
function ancestry(node: Element): { readonly node: Element; readonly index: number }[] {
  const chain: { node: Element; index: number }[] = [];
  for (let cur: Element | null = node; cur !== null && cur !== document.body && cur.parentElement !== null; cur = cur.parentElement) {
    chain.push({ node: cur, index: Array.prototype.indexOf.call(cur.parentElement.children, cur) as number });
  }
  return chain;
}

/**
 * The pressed control's replacement after a view rebuilt its DOM (a board clears its cards while it reloads, so
 * the whole card is a new node). Start at the nearest ancestor that survived and walk down the recorded child
 * indexes, accepting only the same tags ending on an enabled node with the same text.
 */
function replacement(chain: readonly { readonly node: Element; readonly index: number }[], text: string): HTMLElement | null {
  const start = chain.findIndex((link) => link.node.isConnected);
  if (start <= 0) return null;
  let cur: Element = chain[start]!.node;
  for (let k = start - 1; k >= 0; k -= 1) {
    const next: Element | undefined = cur.children[chain[k]!.index];
    if (next === undefined || next.tagName !== chain[k]!.node.tagName) return null;
    cur = next;
  }
  return cur instanceof HTMLElement && (cur as HTMLButtonElement).disabled !== true && (cur.textContent ?? "") === text ? cur : null;
}

/** The attribute the renderer puts on a record's title: it names the record in the DOM, so a rebuilt record can be found again. */
const RECORD_ATTR = "data-yadad-record";
/** The attribute a component puts on the control that opens a record's menu or panel, and (same value) on that panel: focus returns to the trigger when the panel closed with the press. */
const TRIGGER_ATTR = "data-yadad-focus-return";
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The element that holds one record (a card, an entry): the nearest ancestor of `control` that also holds the record's title, `up` levels above it. */
function recordScope(recordId: string, control: Element): { readonly up: number } | undefined {
  const marks = document.querySelectorAll(`[${RECORD_ATTR}="${CSS.escape(recordId)}"]`);
  const mark = marks[0];
  if (mark === undefined) return undefined;
  let up = 0;
  let scope: Element | null = mark;
  while (scope !== null && scope !== document.body && !scope.contains(control)) {
    scope = scope.parentElement;
    up += 1;
  }
  if (scope === null || scope === document.body || scope === mark || scope === control) return undefined;
  return scope.querySelectorAll(`[${RECORD_ATTR}]`).length === 1 ? { up } : undefined;
}

/** The record's element now, found from its title the same number of levels up. */
function scopeNow(recordId: string, up: number): Element | null {
  let scope: Element | null = document.querySelector(`[${RECORD_ATTR}="${CSS.escape(recordId)}"]`);
  for (let k = 0; k < up && scope !== null; k += 1) scope = scope.parentElement;
  return scope !== null && scope.querySelectorAll(`[${RECORD_ATTR}]`).length === 1 ? scope : null;
}

/** Where focus goes when the pressed control lived in a panel that closed: the record's menu trigger, else its first focusable control. */
function panelReturn(recordId: string, up: number, token: string | undefined): HTMLElement | null {
  const scope = scopeNow(recordId, up);
  if (scope === null) return null;
  // A record can have several triggers (actions, move): the panel and its trigger share one token.
  const triggers = [...scope.querySelectorAll<HTMLElement>(`[${TRIGGER_ATTR}]:not([disabled])`)];
  return triggers.find((t) => token !== undefined && t.getAttribute(TRIGGER_ATTR) === token) ?? triggers[0] ?? scope.querySelector<HTMLElement>(FOCUSABLE);
}

/** What `useRecordActions` gives a view: the row's buttons, the failure summary, the announcement, and the open dialog. */
export interface RecordActions {
  /** The record's available actions as ready-to-draw buttons (empty when the view offers none). */
  readonly items: (record: DataRecord, group?: string) => readonly RecordActionItem[];
  /** The failed action's summary lines, shown by the view's ErrorSummary; undefined when nothing failed. */
  readonly failures: readonly DocumentError[] | undefined;
  /** The last announcement, for a registry component with an `announcement` prop (board, calendar). */
  readonly announcement: { readonly seq: number; readonly text: string } | undefined;
  /** The open confirm/input dialog, built for `layout.Dialog`; renders nothing when no dialog is open. */
  readonly dialog: ReactNode;
  /**
   * Keep the viewer's place across a save that is not an action (the done checkbox of a board card or a
   * calendar entry). Call it when the save starts, while the control still has focus; call the returned
   * function when the save has settled, before the view's own state update. The focus-return effect then
   * puts focus back on the same record's control in the rebuilt view (or leaves it alone when the record is gone).
   */
  readonly holdFocus: (record: DataRecord, options?: { readonly moved?: boolean }) => () => void;
}

/** The open dialog: the record, the action, what has been typed, what was refused, whether act is in flight. */
interface OpenDialog {
  readonly record: DataRecord;
  readonly action: RecordAction;
  readonly values: RecordValues;
  readonly errors: readonly DocumentError[];
  readonly working: boolean;
}

/** Action inputs are never references (the validator says so), so the picker support is never consulted. */
const noReferences: ReferenceSupport = {
  input: () => ({ options: { status: "ready", options: [], more: false } }),
  display: (_field, id) => ({ label: id, status: "missing" }),
};

/**
 * Record actions for one view (RFC 0007): builds the available actions with
 * `availableActions`, runs them with `adapter.act` (the record's last-read
 * `version` as `baseVersion`, the entity's revision as the guard), tracks the
 * in-flight record, announces "<label> done" and reloads on success, and
 * shows the failure with an ErrorSummary and reloads on a refusal. Actions
 * with `confirm` or `input` go through the dialog this hook builds for
 * `layout.Dialog` — the component only provides the modal behaviour. Tables,
 * boards and calendars all draw the returned items with their own buttons.
 */
export function useRecordActions(options: {
  readonly entity: EntityDocument;
  readonly view: ActionsView;
  readonly viewer: ResolvedViewer;
  readonly registry: Registry<ReactNode>;
  readonly adapter: DataAdapter | undefined;
  /** Refresh the view's records after an action ran or was refused. */
  readonly reload: () => void;
  /** Called once after each **successful** action, never after a refused one or a reload (same contract as the renderers' `onChanged`). */
  readonly onChanged?: () => void;
  /** Where announcements go: a view with its own announcement state (board, calendar) injects it, so one live region carries everything. Without it the hook keeps its own. */
  readonly announce?: (text: string) => void;
  /** The documents of the entities that reference fields point at: a confirm `subjectField` that is a reference shows its target's label. */
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  /** How dates and times in the confirm subject line are formatted, as in a table cell. */
  readonly formatting?: FieldFormatting;
}): RecordActions {
  const { entity, view, viewer, registry, adapter, reload, entities, formatting } = options;
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<readonly DocumentError[] | undefined>(undefined);
  const [announcement, setAnnouncement] = useState<{ readonly seq: number; readonly text: string } | undefined>(undefined);
  const [dialog, setDialog] = useState<OpenDialog | undefined>(undefined);
  const mounted = useRef(true);
  // Focus return after a press (todo-app F9:227, F11 row 7): a browser takes focus away the
  // moment `pending` disables the pressed button, and nothing gives it back when the flight
  // ends — Tab then restarts from the nav. The press records the focused control and `act`
  // records the flight; the effect below returns focus once the flight is over for that
  // record, unless the viewer has moved on in the meantime or a dialog owns focus.
  // todo-app F14 part B: the reload often REMOUNTS the pressed button — completing a row
  // swaps its action set (Complete unmounts, Reopen mounts; measured in Chromium ~90ms into
  // the press) — and the effect also runs BEFORE that commit lands, when the old button is
  // still connected but doomed. So a restore is only kept once a later render finds focus
  // still on it; a focus that fell to body (the node died under it) tries again: first the
  // pressed node, then the first live button of the parent it held (the action cell/row,
  // which survives the swap). A removed record takes its cell with it — no target, focus
  // stays put — and an unsettled attempt gives up after the window so an old action can
  // never steal focus much later.
  const pressed = useRef<{
    readonly recordId: string;
    element: HTMLElement;
    parent: Element | null;
    /** What a control of the same kind as the pressed one looks like, to find it again among the parent's children. */
    readonly selector: string;
    /** The pressed node and its ancestors up to (not including) body, with each one's index among its parent's children. */
    chain: readonly { readonly node: Element; readonly index: number }[];
    text: string; // the pressed node's text, to recognise its replacement
    readonly place: Place | undefined; // where the pressed record sat in the view when it was pressed
    readonly scopeUp: number | undefined; // levels from the record's title up to the element holding the record and the pressed control
    readonly panelToken: string | undefined; // the pressed control sat in a panel marked with this token; its trigger carries the same one
    readonly moved: boolean; // the viewer moved the record on purpose: focus follows it to its new place
    focused: HTMLElement | undefined; // the last node this effect focused, awaiting confirmation
    watchUntil: number | undefined; // set once a restore survived a render: the restore stays armed until then, for a later rebuild
    attempts: number; // renders spent retrying; bounds the retry window
    ended: boolean; // the action's promise has settled; until then an unrelated render must not read the flight as over
  } | undefined>(undefined);
  const flights = useRef(new Set<string>());
  // The records the view asked actions for in this render: a rebuilt control is only the pressed one's
  // replacement while its record is still shown (a removed record's neighbour slides into its place).
  // It also records each record's place (its group and its index within the group, in render order): a
  // rebuilt control is only the pressed one's replacement while its record kept that place, because a
  // different record sitting at the old path can have a button with the same text.
  const shown = useRef(new Map<string, Place>());
  shown.current = new Map();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    // Once a restore is confirmed it stays armed for a late rebuild (card 57b); any key or pointer press by
    // the viewer ends it, so a click on empty page (focus on body) is never "repaired" afterwards.
    const disarm = (): void => {
      const held = pressed.current;
      if (held?.watchUntil === undefined) return;
      pressed.current = undefined;
      flights.current.delete(held.recordId);
    };
    document.addEventListener("keydown", disarm, true);
    document.addEventListener("pointerdown", disarm, true);
    return () => {
      document.removeEventListener("keydown", disarm, true);
      document.removeEventListener("pointerdown", disarm, true);
    };
  }, []);
  useEffect(() => {
    const held = pressed.current;
    // `ended` guards a render that commits between the press and the render carrying `pending`: it sees
    // the flight as over (no pending yet) and, with focus still on the pressed button, would give up the
    // restore for good (a flake under load).
    if (held === undefined || !held.ended || !flights.current.has(held.recordId) || pending.has(held.recordId)) return;
    if (dialog !== undefined) return; // the dialog path owns focus until it closes (its own close-return applies)
    const settle = (): void => {
      pressed.current = undefined;
      flights.current.delete(held.recordId);
    };
    // A previous attempt that SURVIVED a commit is confirmed — but not finished: a reload that
    // started from the same action (a sibling widget's, or a second fetch of this view) can land
    // later and rebuild the control again, dropping focus to body a second time (card 57b). So
    // the restore stays armed for a short window, tracking the control it last focused, and
    // ends early the moment the viewer acts (see `disarm`) or focus is spoken for elsewhere.
    if (held.watchUntil !== undefined && Date.now() > held.watchUntil) {
      settle();
      return;
    }
    if (held.focused !== undefined && held.focused.isConnected && document.activeElement === held.focused) {
      held.watchUntil ??= Date.now() + WATCH_MS;
      held.element = held.focused;
      held.parent = held.focused.parentElement;
      held.chain = ancestry(held.focused);
      held.text = held.focused.textContent ?? "";
      held.attempts = 0;
      return;
    }
    const active = document.activeElement;
    // The pressed control lived in a panel that closed with the press. The set refocuses the panel's trigger,
    // then the reload rebuilds the record: that trigger is ours to track, as long as it is in this record.
    if (!held.element.isConnected && held.focused === undefined && held.scopeUp !== undefined && active instanceof HTMLElement && active !== document.body) {
      const scope = scopeNow(held.recordId, held.scopeUp);
      if (scope !== null && scope.contains(active)) {
        held.focused = active;
        held.element = active;
        held.parent = active.parentElement;
        held.chain = ancestry(active);
        held.text = active.textContent ?? "";
        held.watchUntil ??= Date.now() + WATCH_MS;
        return;
      }
    }
    if (active !== null && active !== document.body && active !== held.focused && active !== held.element) {
      settle(); // focus is spoken for by someone else: leave it alone (the never-steal rule)
      return;
    }
    if (held.attempts >= RESTORE_ATTEMPTS) {
      settle(); // the replacement never landed (e.g. the record was removed): stop trying
      return;
    }
    held.attempts += 1;
    // Focus is on body (or on a node we focused that cannot take it, e.g. still disabled):
    // the node we last held died — or will die — under it. Retry — the pressed node if it
    // is (still) there, else the first live button of the parent it held (the action
    // cell/row survives an action-set swap; a removed record takes it, leaving no target).
    const live =
      held.parent !== null && held.parent.isConnected
        ? held.parent.querySelector<HTMLButtonElement>(held.selector)
        : null;
    const keptPlace = held.moved || samePlace(held.place, shown.current.get(held.recordId));
    const target: HTMLElement | null = held.element.isConnected
      ? held.element
      : (live ?? (keptPlace ? (held.moved ? null : replacement(held.chain, held.text)) ?? (held.scopeUp === undefined ? null : panelReturn(held.recordId, held.scopeUp, held.panelToken)) : null));
    if (target !== null && (target as HTMLButtonElement).disabled !== true) {
      target.focus();
      held.focused = target;
      if (held.watchUntil !== undefined) held.watchUntil = Date.now() + WATCH_MS;
    }
    // No target (or a disabled one): the reload's commit has not landed. The next render retries.
  });

  /** The focused control as a restore target for `record`, or undefined when focus is not on a real control. */
  const capture = (record: DataRecord, moved = false): NonNullable<typeof pressed.current> | undefined => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return undefined;
    const selector = el instanceof HTMLInputElement ? `input[type="${el.type}"]:not([disabled])` : `${el.tagName.toLowerCase()}:not([disabled])`;
    return { recordId: record.id, element: el, parent: el.parentElement, selector, chain: ancestry(el), text: el.textContent ?? "", place: shown.current.get(record.id), scopeUp: recordScope(record.id, el)?.up, moved, panelToken: el.closest(`[${TRIGGER_ATTR}]`)?.getAttribute(TRIGGER_ATTR) ?? undefined, focused: undefined, watchUntil: undefined, attempts: 0, ended: false };
  };

  const holdFocus = (record: DataRecord, options?: { readonly moved?: boolean }): (() => void) => {
    const held = capture(record, options?.moved === true);
    if (held === undefined) return () => {};
    pressed.current = held;
    flights.current.add(record.id);
    return () => {
      held.ended = true;
    };
  };

  const announce = (text: string): void => {
    if (options.announce !== undefined) options.announce(text);
    else setAnnouncement((a) => ({ seq: (a?.seq ?? 0) + 1, text }));
  };

  /** Run act and apply the outcome; the dialog path and the direct press share it (RFC 0007). */
  const run = (record: DataRecord, action: RecordAction, input: RecordValues | undefined, fromDialog: OpenDialog | undefined): void => {
    if (adapter === undefined || adapter.act === undefined || pending.has(record.id)) return;
    const act = adapter.act.bind(adapter);
    flights.current.add(record.id); // a press started this flight; the focus-return effect waits for it to end
    setFailures(undefined);
    setPending((s) => new Set(s).add(record.id));
    if (fromDialog !== undefined) {
      setDialog((d) => (d === undefined ? d : { ...d, working: true }));
      announce("Working...");
    }
    void (async () => {
      try {
        // The guard is the version the client last read: a stale action is a conflict (RFC 0007).
        await act(entity.id, record.id, action.id, { ...(input === undefined ? {} : { input }), meta: { entityRevision: entity.revision, baseVersion: record.version } });
        if (!mounted.current) return;
        setDialog(undefined);
        announce(`${action.label} done`);
        reload();
        options.onChanged?.(); // neighbours (a dashboard's counts and stats) refresh too
      } catch (error) {
        if (!mounted.current) return;
        if (fromDialog !== undefined && !(error instanceof ForbiddenError) && !(error instanceof RecordConflictError) && !(error instanceof RecordNotFoundError)) {
          // 400 or any other failure: the dialog stays open with the message (400 issues go to their fields) so the viewer can fix and retry.
          setDialog((d) => (d === undefined ? d : { ...d, working: false, errors: error instanceof RecordValidationError ? error.issues : actionFailure(error) }));
          return;
        }
        // 403/409/404 (and every direct press that fails): close the dialog, show the view's ErrorSummary, reload. Nothing is merged or retried.
        setDialog(undefined);
        setFailures(actionFailure(error));
        reload();
      } finally {
        if (pressed.current?.recordId === record.id) pressed.current.ended = true;
        if (mounted.current) {
          setPending((s) => {
            const next = new Set(s);
            next.delete(record.id);
            return next;
          });
        }
      }
    })();
  };

  const openDialog = (record: DataRecord, action: RecordAction): void => {
    setFailures(undefined);
    setDialog({ record, action, values: {}, errors: [], working: false });
  };

  /** Confirm: validate first (the server never sees input the document rules already reject), then act. */
  const confirmDialog = (): void => {
    if (dialog === undefined || dialog.working) return;
    const issues = validateActionInput(dialog.action, dialog.values);
    if (issues.length > 0) {
      setDialog({ ...dialog, errors: issues });
      return;
    }
    run(dialog.record, dialog.action, Object.keys(dialog.values).length > 0 ? dialog.values : undefined, dialog);
  };

  const items = (record: DataRecord, group = ""): readonly RecordActionItem[] => {
    if (!shown.current.has(record.id)) {
      let index = 0;
      for (const place of shown.current.values()) if (place.group === group) index += 1;
      shown.current.set(record.id, { group, index });
    }
    return availableActions(entity, view, record, viewer).map((action) => ({
      id: action.id,
      label: action.label,
      tone: action.confirm?.tone ?? "neutral",
      pending: pending.has(record.id),
      onPress: () => {
        // Only a direct press is remembered for the focus return: the dialog path has its
        // own close-return contract (the modal gives focus back to who opened it).
        pressed.current = actionNeedsDialog(action) ? undefined : capture(record);
        if (actionNeedsDialog(action)) openDialog(record, action);
        else run(record, action, undefined, undefined);
      },
    }));
  };

  const { Dialog, FieldFrame, Button, ErrorSummary } = registry.layout;
  const open = dialog;
  // RFC 0011 item 2: the confirm's subject line is the named field's display, exactly as a table cell draws it.
  const subjectField = open?.action.confirm?.subjectField === undefined ? undefined : entity.fields.find((f) => f.id === open.action.confirm?.subjectField);
  const subjectId = subjectField?.type === "reference" ? open?.record.values[subjectField.id] : undefined;
  const subjectWants: readonly ReferenceWant[] = subjectField?.type === "reference" && typeof subjectId === "string" && subjectId !== "" ? [{ field: subjectField, id: subjectId }] : [];
  const subjectReferences = useReferences(adapter, entities, [], subjectWants);
  const fieldErrors = (field: Field): readonly DocumentError[] => (open?.errors ?? []).filter((e) => e.path === jsonPointer(["input", field.id]));
  const summaryErrors = (open?.errors ?? []).filter((e) => !open!.action.input?.some((f) => e.path === jsonPointer(["input", f.id])));
  const rendered: ReactNode =
    open === undefined || Dialog === undefined ? null : (
      <Dialog label={open.action.confirm?.title ?? open.action.label} onClose={() => setDialog(undefined)}>
        {open.action.confirm !== undefined && <p>{open.action.confirm.message}</p>}
        {subjectField !== undefined && (
          <p data-yadad-confirm-subject="">{renderDisplay(registry, subjectField, open.record.values[subjectField.id], subjectReferences, formatting)}</p>
        )}
        {(open.action.input ?? []).map((field) => {
          const errors = fieldErrors(field);
          const inputId = `yadad-action-${open.action.id}-${open.record.id}-${field.id}`;
          const errorId = `${inputId}-errors`;
          return (
            <FieldFrame key={field.id} inputId={inputId} errorId={errorId} label={field.label} required={field.required === true} errors={errors}>
              <div data-yadad-action-input={field.id}>
                {renderInput(registry, field, open.values[field.id], { inputId, invalid: errors.length > 0, ...(errors.length > 0 ? { describedBy: errorId } : {}) }, (v) =>
                setDialog((d) => (d === undefined ? d : { ...d, values: { ...d.values, [field.id]: v ?? null } })),
                noReferences,
              )}
              </div>
            </FieldFrame>
          );
        })}
        {summaryErrors.length > 0 && <ErrorSummary errors={summaryErrors} />}
        <Button label="Cancel" type="button" variant="secondary" disabled={open.working} onPress={() => setDialog(undefined)} />
        <Button
          label={open.action.confirm?.confirmLabel ?? open.action.label}
          type="button"
          variant="primary"
          disabled={open.working}
          {...(open.action.confirm?.tone !== undefined ? { tone: open.action.confirm.tone } : {})}
          onPress={confirmDialog}
        />
      </Dialog>
    );

  return { items, failures, announcement, dialog: rendered, holdFocus };
}

/**
 * View-level problems with its `recordActions`, merged into the ErrorSummary
 * that replaces the view (same channel as `checkViewSetup`): a data source
 * that cannot run any action, and an action that needs a dialog this registry
 * does not provide. A view that offers no actions never errors.
 */
export function recordActionSetupErrors(
  entity: EntityDocument,
  view: ActionsView & { readonly id: string },
  adapter: DataAdapter | undefined,
  registry: Registry<ReactNode>,
): readonly DocumentError[] {
  const offered = (view.recordActions ?? []).flatMap((id) => entity.actions?.filter((a) => a.id === id) ?? []);
  if (offered.length === 0) return [];
  const errors: DocumentError[] = [];
  if (adapter !== undefined && adapter.act === undefined) {
    errors.push({
      path: "/dataSource",
      code: "required",
      message: `The data source of view ${view.id} cannot run actions.`,
      hint: "Provide a data source that can run actions, or remove recordActions from the view.",
    });
  }
  if (offered.some((action) => actionNeedsDialog(action)) && registry.layout.Dialog === undefined) {
    errors.push({
      path: "/layout/Dialog",
      code: "required",
      message: `View ${view.id} offers an action that needs a dialog, which this registry does not provide.`,
      hint: "Register a layout.Dialog component.",
    });
  }
  return errors;
}

/** A failed action becomes summary lines: the refusal the server stated, per its category (the protocol's 403/409/404). */
function actionFailure(error: unknown): readonly DocumentError[] {
  // A refused save that names its errors keeps each one's own message, hint
  // and field; "Reload and try again." would be a lie when reloading fixes
  // nothing (a 400 with the server's own hint).
  const located = serverValidationIssues(error);
  if (located !== undefined) return located;
  if (error instanceof ForbiddenError) return [{ path: "", code: "forbidden", message: error.message, hint: "Reload to refresh this record." }];
  if (error instanceof RecordConflictError) return [{ path: "", code: "conflict", message: error.message, hint: "Reload to see the latest version, then try again." }];
  if (error instanceof RecordNotFoundError) return [{ path: "", code: "not-found", message: error.message, hint: "Reload to refresh the list." }];
  if (error instanceof UnauthorizedError) return [{ path: "", code: "unauthorized", message: error.message, hint: "Sign in and try again." }];
  return [{ path: "", code: "invalid-value", message: error instanceof Error ? error.message : String(error), hint: "Reload and try again." }];
}
