import type { DocumentError, EntityDocument, FieldValue, RecordValues } from "@yadad/core";
import type { KeyValueStore } from "./key-value-adapter.js";
import { validateRecord } from "./record.js";

/** What drafts need from storage: the key-value interface plus removal. localStorage fits as-is. */
export interface DraftStorage extends KeyValueStore {
  removeItem(key: string): void;
}

/** Unsaved form input, as stored. */
export interface Draft {
  readonly values: RecordValues;
  /** The entity revision the values were typed against. */
  readonly entityRevision: number;
  /** When the draft was last written, in milliseconds since the epoch. */
  readonly savedAt: number;
  /** The version of the record being edited, if the form edits one. */
  readonly recordVersion?: string;
}

/**
 * Keeps unsaved form input per form view and record ("new" for a create
 * form). Storage failures (private mode, a full quota, corrupt entries) are
 * swallowed: a draft is a convenience and must never break the form.
 */
export interface DraftStore {
  load(formId: string, recordId?: string): Draft | null;
  save(formId: string, recordId: string | undefined, draft: Draft): void;
  /** Removes one draft; with no `formId`, removes every draft in this store's scope. */
  clear(formId?: string, recordId?: string): void;
}

/** Options for `createDraftStore` and `clearDrafts`. */
export interface DraftOptions {
  /** Key prefix. Default "yadad". */
  readonly prefix?: string;
  /** A user or session id the host supplies. Keeps one user's drafts away from the next user's. */
  readonly scope?: string;
}

/** Storage that can list its keys, as localStorage can. */
interface EnumerableStorage {
  readonly length: number;
  key(index: number): string | null;
}

const DEFAULT_PREFIX = "yadad";
let warnedUnscoped = false;
/** Keys written through a store, for storages that cannot list their keys. */
const tracked = new WeakMap<object, Set<string>>();

/** The runtime has no DOM or Node typings, so reach `console` through globalThis. */
function warn(message: string): void {
  (globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(message);
}

function scopePart(scope: string | undefined): string {
  return scope === undefined ? "" : `${encodeURIComponent(scope)}:`;
}

function resolveOptions(arg: string | DraftOptions | undefined): { prefix: string; scope?: string } {
  if (typeof arg === "string") return { prefix: arg };
  return { prefix: arg?.prefix ?? DEFAULT_PREFIX, ...(arg?.scope !== undefined ? { scope: arg.scope } : {}) };
}

function isEnumerable(storage: object): storage is EnumerableStorage {
  const s = storage as Partial<EnumerableStorage>;
  return typeof s.length === "number" && typeof s.key === "function";
}

function removeKeys(storage: DraftStorage, startsWith: string): void {
  try {
    let keys: string[];
    if (isEnumerable(storage)) {
      keys = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k !== null) keys.push(k);
      }
    } else {
      keys = [...(tracked.get(storage) ?? [])];
    }
    for (const k of keys) {
      if (!k.startsWith(startsWith)) continue;
      storage.removeItem(k);
      tracked.get(storage)?.delete(k);
    }
  } catch {
    // Storage disabled: there is nothing to remove.
  }
}

/**
 * Creates a draft store. Pass the signed-in user's id as `scope` so drafts on a
 * shared browser never reach the next user; without it the store still works
 * (single-user hosts) but warns once. The second argument may be a prefix string
 * (the older signature) or `{ prefix, scope }`.
 */
export function createDraftStore(storage: DraftStorage, options?: string | DraftOptions): DraftStore {
  const { prefix, scope } = resolveOptions(options);
  if (scope === undefined && !warnedUnscoped) {
    warnedUnscoped = true;
    warn(
      "@yadad/runtime: drafts are not scoped to a user. Pass { scope: <user id> } to createDraftStore and call clearDrafts on sign-out (see the runtime README, \"Drafts and shared browsers\").",
    );
  }
  const base = `${prefix}:draft:${scopePart(scope)}`;
  const key = (formId: string, recordId: string | undefined) => `${base}${formId}:${recordId ?? "new"}`;
  return {
    load(formId, recordId) {
      try {
        const raw = storage.getItem(key(formId, recordId));
        return raw === null ? null : parseDraft(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    save(formId, recordId, draft) {
      try {
        const k = key(formId, recordId);
        storage.setItem(k, JSON.stringify(draft));
        let set = tracked.get(storage);
        if (set === undefined) tracked.set(storage, (set = new Set()));
        set.add(k);
      } catch {
        // Out of quota or storage disabled: the form keeps working without a draft.
      }
    },
    clear(formId, recordId) {
      if (formId === undefined) {
        removeKeys(storage, base);
        return;
      }
      try {
        const k = key(formId, recordId);
        storage.removeItem(k);
        tracked.get(storage)?.delete(k);
      } catch {
        // Storage disabled: there is nothing to remove.
      }
    },
  };
}

/**
 * Removes drafts under the prefix: only one scope's with `scope`, every draft
 * (including unscoped legacy keys) without it. Call it on sign-out. It lists
 * keys with `storage.key(i)` / `length` (localStorage has them); a storage
 * without them cannot be enumerated, so only drafts written through
 * `createDraftStore` in this page session are cleared. Other keys are left alone.
 */
export function clearDrafts(storage: DraftStorage, options?: DraftOptions): void {
  const { prefix, scope } = resolveOptions(options);
  removeKeys(storage, `${prefix}:draft:${scopePart(scope)}`);
}

/** Test hook: lets a test see the one-time warning again. */
export function resetDraftWarning(): void {
  warnedUnscoped = false;
}

function isFieldValue(value: unknown): value is FieldValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Accepts only the stored shape; anything else reads as "no draft". */
function parseDraft(json: unknown): Draft | null {
  if (typeof json !== "object" || json === null) return null;
  const { values, entityRevision, savedAt, recordVersion } = json as Record<string, unknown>;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  if (typeof entityRevision !== "number" || typeof savedAt !== "number") return null;
  if (recordVersion !== undefined && typeof recordVersion !== "string") return null;
  const entries = Object.entries(values);
  if (!entries.every(([, v]) => isFieldValue(v))) return null;
  return { values: Object.fromEntries(entries), entityRevision, savedAt, ...(recordVersion !== undefined ? { recordVersion } : {}) };
}

/** A draft ready to put back into a form, with what changed since it was taken. */
export interface RestoredDraft {
  readonly values: RecordValues;
  readonly savedAt: number;
  /** The entity changed revision since the draft was taken. */
  readonly revisionChanged: boolean;
  /** Field ids in the draft that the entity no longer has; their values were dropped. */
  readonly droppedFields: readonly string[];
  /** The record being edited was saved elsewhere since the draft was taken. */
  readonly recordChanged: boolean;
  /**
   * Restored values the current schema rejects — same issue shape as
   * `FormState.errors`, so a caller seeds them into the form and the field
   * frames show them. The values are still restored: a draft is the user's
   * typed data, and silently dropping it is data loss. `required` is excluded
   * — a draft typed halfway through legitimately lacks optional-but-required
   * values, and the submit path (`submitForm`/`submitEdit`) reports those.
   */
  readonly invalidFields: readonly DocumentError[];
}

/**
 * Fits a stored draft to the entity as it is now: values for fields that no
 * longer exist are dropped, and values the current schema rejects are kept but
 * reported in `invalidFields`. Returns null when nothing is left to restore.
 */
export function restoreDraft(entity: EntityDocument, draft: Draft, recordVersion?: string): RestoredDraft | null {
  const known = new Set(entity.fields.map((f) => f.id));
  const entries = Object.entries(draft.values);
  const kept = entries.filter(([id]) => known.has(id));
  if (kept.length === 0) return null;
  const keptIds = new Set(kept.map(([id]) => id));
  const invalidFields = validateRecord(entity, Object.fromEntries(kept)).filter(
    (issue) => issue.code !== "required" && keptIds.has(issue.path.slice(1)),
  );
  return {
    values: Object.fromEntries(kept),
    invalidFields,
    savedAt: draft.savedAt,
    revisionChanged: draft.entityRevision !== entity.revision,
    droppedFields: entries.filter(([id]) => !known.has(id)).map(([id]) => id),
    recordChanged: draft.recordVersion !== undefined && recordVersion !== undefined && draft.recordVersion !== recordVersion,
  };
}
