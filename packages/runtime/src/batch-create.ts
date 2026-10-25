import type { DataAdapter, DataRecord, DocumentError, EntityDocument, RecordValues } from "@yadad/core";
import { validateRecord } from "./record.js";
import { adapterFailure } from "./form.js";

/**
 * One atomic batch create (RFC 0009 item 4): every row is validated against
 * the entity first, then all N records are written through the adapter's
 * `batch` verb in one call — all of them land or none of them do. The batch
 * composer's submit is exactly one adapter call.
 */
export type BatchCreateResult =
  | { readonly ok: true; readonly records: readonly DataRecord[] }
  | { readonly ok: false; readonly errors: readonly DocumentError[] };

export async function submitBatchCreate(entity: EntityDocument, rows: readonly RecordValues[], adapter: DataAdapter): Promise<BatchCreateResult> {
  const errors = rows.flatMap((row, i) => validateRecord(entity, row).map((e) => ({ ...e, path: `/rows/${i}${e.path}` })));
  if (errors.length > 0) return { ok: false, errors };
  try {
    const result = await adapter.batch(entity.id, { create: rows.map((r) => ({ ...r })) }, { entityRevision: entity.revision });
    return { ok: true, records: result.created };
  } catch (error) {
    return { ok: false, errors: adapterFailure(error) };
  }
}
