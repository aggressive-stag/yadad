import type { DataRecord } from "@yadad/core";

/**
 * Swaps the record the renderer sent (`movedId`) for the one the adapter
 * returned. Matching on `saved.id` alone is not enough: a records host whose
 * ids encode the moved value (occurrence ids like `3:2026-10-19` become
 * `3:2026-10-24`) answers with a **new** id, so the old copy would stay on
 * screen and the new one would never be added — and the pending flag has
 * already cleared, so nothing would say the move happened. When the saved id
 * collides with another loaded record, that duplicate goes too.
 */
export function replaceSavedRecord(records: readonly DataRecord[], movedId: string, saved: DataRecord): readonly DataRecord[] {
  const replaced = records.map((r) => (r.id === movedId ? saved : r));
  if (saved.id === movedId || !replaced.some((r) => r !== saved && r.id === saved.id)) return replaced;
  return replaced.filter((r) => r === saved || r.id !== saved.id);
}
