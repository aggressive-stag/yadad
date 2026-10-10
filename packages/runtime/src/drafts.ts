import type { EntityDocument, FieldValue, RecordValues } from "@yadad/core";
import type { KeyValueStore } from "./key-value-adapter.js";

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
  clear(formId: string, recordId?: string): void;
}

export function createDraftStore(storage: DraftStorage, prefix = "yadad"): DraftStore {
  const key = (formId: string, recordId: string | undefined) => `${prefix}:draft:${formId}:${recordId ?? "new"}`;
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
        storage.setItem(key(formId, recordId), JSON.stringify(draft));
      } catch {
        // Out of quota or storage disabled: the form keeps working without a draft.
      }
    },
    clear(formId, recordId) {
      try {
        storage.removeItem(key(formId, recordId));
      } catch {
        // Storage disabled: there is nothing to remove.
      }
    },
  };
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
}

/**
 * Fits a stored draft to the entity as it is now: values for fields that no
 * longer exist are dropped. Returns null when nothing is left to restore.
 */
export function restoreDraft(entity: EntityDocument, draft: Draft, recordVersion?: string): RestoredDraft | null {
  const known = new Set(entity.fields.map((f) => f.id));
  const entries = Object.entries(draft.values);
  const kept = entries.filter(([id]) => known.has(id));
  if (kept.length === 0) return null;
  return {
    values: Object.fromEntries(kept),
    savedAt: draft.savedAt,
    revisionChanged: draft.entityRevision !== entity.revision,
    droppedFields: entries.filter(([id]) => !known.has(id)).map(([id]) => id),
    recordChanged: draft.recordVersion !== undefined && recordVersion !== undefined && draft.recordVersion !== recordVersion,
  };
}
