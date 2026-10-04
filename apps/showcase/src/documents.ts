import { validateDocument } from "@yadad/core";
import type { DocumentError, EntityDocument, FormView } from "@yadad/core";

export type LoadedDocuments =
  | { readonly ok: true; readonly entity: EntityDocument; readonly view: FormView }
  | { readonly ok: false; readonly errors: readonly (DocumentError & { readonly source: string })[] };

/** Parses and validates the raw JSON documents, the way a host would after a DB fetch. */
export function loadDocuments(entitySource: string, formSource: string): LoadedDocuments {
  const entity = parse("entity", entitySource, "entity");
  const view = parse("form", formSource, "form");
  const errors = [...entity.errors, ...view.errors];
  if (entity.doc?.kind === "entity" && view.doc?.kind === "form" && errors.length === 0) {
    return { ok: true, entity: entity.doc, view: view.doc };
  }
  return { ok: false, errors };
}

function parse(source: string, raw: string, expectedKind: "entity" | "form") {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { doc: undefined, errors: [{ source, path: "", code: "type" as const, message: `Not valid JSON: ${message}`, hint: "Fix the JSON syntax." }] };
  }
  const result = validateDocument(json);
  if (!result.ok) return { doc: undefined, errors: result.errors.map((e) => ({ ...e, source })) };
  if (result.value.kind !== expectedKind) {
    return {
      doc: undefined,
      errors: [{ source, path: "/kind", code: "invalid-value" as const, message: `Expected a ${expectedKind} document.`, hint: `Use "kind": "${expectedKind}".` }],
    };
  }
  return { doc: result.value, errors: [] };
}
