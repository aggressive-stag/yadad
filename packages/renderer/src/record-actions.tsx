import { ForbiddenError, RecordConflictError, RecordNotFoundError, UnauthorizedError } from "@yadad/core";
import type { DataAdapter, DataRecord, DocumentError, EntityDocument, RecordAction, RecordActionItem, Registry, ResolvedViewer } from "@yadad/core";
import { actionNeedsDialog, availableActions } from "@yadad/runtime";
import type { ActionsView } from "@yadad/runtime";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** What `useRecordActions` gives a view: the row's buttons, the failure summary, and the announcement. */
export interface RecordActions {
  /** The record's available actions as ready-to-draw buttons (empty when the view offers none). */
  readonly items: (record: DataRecord) => readonly RecordActionItem[];
  /** The failed action's summary lines, shown by the view's ErrorSummary; undefined when nothing failed. */
  readonly failures: readonly DocumentError[] | undefined;
  /** The last announcement, for a registry component with an `announcement` prop (board, calendar). */
  readonly announcement: { readonly seq: number; readonly text: string } | undefined;
}

/**
 * Record actions for one view (RFC 0007): builds the available actions with
 * `availableActions`, runs them with `adapter.act` (the record's last-read
 * `version` as `baseVersion`, the entity's revision as the guard), tracks the
 * in-flight record, announces "<label> done" and reloads on success, and
 * shows the failure with an ErrorSummary and reloads on a refusal. Tables,
 * boards and calendars all draw the returned items with their own buttons.
 */
export function useRecordActions(options: {
  readonly entity: EntityDocument;
  readonly view: ActionsView;
  readonly viewer: ResolvedViewer;
  readonly adapter: DataAdapter | undefined;
  /** Refresh the view's records after an action ran or was refused. */
  readonly reload: () => void;
}): RecordActions {
  const { entity, view, viewer, adapter, reload } = options;
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<readonly DocumentError[] | undefined>(undefined);
  const [announcement, setAnnouncement] = useState<{ readonly seq: number; readonly text: string } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = (record: DataRecord, action: RecordAction): void => {
    if (adapter === undefined || adapter.act === undefined || pending.has(record.id)) return;
    const act = adapter.act.bind(adapter);
    setFailures(undefined);
    setPending((s) => new Set(s).add(record.id));
    void (async () => {
      try {
        // The guard is the version the client last read: a stale action is a conflict (RFC 0007).
        await act(entity.id, record.id, action.id, { meta: { entityRevision: entity.revision, baseVersion: record.version } });
        if (!mounted.current) return;
        setAnnouncement((a) => ({ seq: (a?.seq ?? 0) + 1, text: `${action.label} done` }));
        reload();
      } catch (error) {
        if (!mounted.current) return;
        setFailures(actionFailure(error));
        // A refusal may mean the record or its permissions changed: reload to refresh.
        reload();
      } finally {
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

  const items = (record: DataRecord): readonly RecordActionItem[] =>
    offered(entity, view, record, viewer).map((action) => ({
      id: action.id,
      label: action.label,
      tone: action.confirm?.tone ?? "neutral",
      pending: pending.has(record.id),
      onPress: () => run(record, action),
    }));

  return { items, failures, announcement };
}

/**
 * The view's actions a press can run right now: available for the record,
 * minus the ones that need a dialog.
 */
function offered(entity: EntityDocument, view: ActionsView, record: DataRecord, viewer: ResolvedViewer): readonly RecordAction[] {
  // RFC 0007: card 35g — an action with confirm or input must never run without its dialog; it is offered again when the dialog exists.
  return availableActions(entity, view, record, viewer).filter((action) => !actionNeedsDialog(action));
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
  if (error instanceof ForbiddenError) return [{ path: "", code: "forbidden", message: error.message, hint: "Reload to refresh this record." }];
  if (error instanceof RecordConflictError) return [{ path: "", code: "conflict", message: error.message, hint: "Reload to see the latest version, then try again." }];
  if (error instanceof RecordNotFoundError) return [{ path: "", code: "not-found", message: error.message, hint: "Reload to refresh the list." }];
  if (error instanceof UnauthorizedError) return [{ path: "", code: "unauthorized", message: error.message, hint: "Sign in and try again." }];
  return [{ path: "", code: "invalid-value", message: error instanceof Error ? error.message : String(error), hint: "Reload and try again." }];
}
