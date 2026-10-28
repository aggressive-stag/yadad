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
    readonly element: HTMLElement;
    readonly parent: Element | null;
    /** The pressed node and its ancestors up to (not including) body, with each one's index among its parent's children. */
    readonly chain: readonly { readonly node: Element; readonly index: number }[];
    readonly text: string; // the pressed node's text, to recognise its replacement
    readonly place: Place | undefined; // where the pressed record sat in the view when it was pressed
    focused: HTMLElement | undefined; // the last node this effect focused, awaiting confirmation
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
    // A previous attempt that SURVIVED the commits is the whole point: one render after
    // focusing, focus is still on the node we gave it — done, and it can never come back
    // to steal focus later (todo-app F14 part B: the first restore runs before the reload
    // commits, onto a button that is about to be replaced).
    if (held.focused !== undefined && held.focused.isConnected && document.activeElement === held.focused) {
      settle();
      return;
    }
    const active = document.activeElement;
    if (active !== null && active !== document.body && active !== held.focused) {
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
        ? held.parent.querySelector<HTMLButtonElement>("button:not([disabled])")
        : null;
    const target: HTMLElement | null = held.element.isConnected ? held.element : (live ?? (samePlace(held.place, shown.current.get(held.recordId)) ? replacement(held.chain, held.text) : null));
    if (target !== null && (target as HTMLButtonElement).disabled !== true) {
      target.focus();
      held.focused = target;
    }
    // No target (or a disabled one): the reload's commit has not landed. The next render retries.
  });

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
        pressed.current =
          actionNeedsDialog(action) || !(document.activeElement instanceof HTMLElement)
            ? undefined
            : { recordId: record.id, element: document.activeElement, parent: document.activeElement.parentElement, chain: ancestry(document.activeElement), text: document.activeElement.textContent ?? "", place: shown.current.get(record.id), focused: undefined, attempts: 0, ended: false };
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

  return { items, failures, announcement, dialog: rendered };
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
