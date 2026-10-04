import { validateDocument } from "@yadad/core";
import type { DocumentError, EntityDocument, ViewDocument } from "@yadad/core";

export type LoadedDocuments =
  | { readonly ok: true; readonly entity: EntityDocument; readonly view: ViewDocument }
  | { readonly ok: false; readonly errors: readonly (DocumentError & { readonly source: string })[] };

/** Parses and validates an entity and one of its views, the way a host would after a DB fetch. */
export function loadDocuments(entitySource: string, viewSource: string): LoadedDocuments {
  const entity = parse("entity", entitySource);
  const view = parse("view", viewSource);
  const errors = [...entity.errors, ...view.errors];
  if (entity.doc?.kind !== "entity" && entity.doc) errors.push(wrongKind("entity", '"entity"'));
  if (view.doc?.kind === "entity") errors.push(wrongKind("view", '"form" or "table"'));
  if (errors.length === 0 && entity.doc?.kind === "entity" && view.doc && view.doc.kind !== "entity") {
    return { ok: true, entity: entity.doc, view: view.doc };
  }
  return { ok: false, errors };
}

function wrongKind(source: string, expected: string) {
  return { source, path: "/kind", code: "invalid-value" as const, message: `Expected a ${expected} document.`, hint: `Use "kind": ${expected}.` };
}

function parse(source: string, raw: string) {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { doc: undefined, errors: [{ source, path: "", code: "type" as const, message: `Not valid JSON: ${message}`, hint: "Fix the JSON syntax." }] };
  }
  const result = validateDocument(json);
  return result.ok ? { doc: result.value, errors: [] } : { doc: undefined, errors: result.errors.map((e) => ({ ...e, source })) };
}
