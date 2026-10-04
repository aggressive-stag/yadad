import { validateDocument } from "@yadad/core";
import type { DocumentError, EntityDocument, ViewDocument } from "@yadad/core";
import type { DocumentSet } from "@yadad/renderer";

export type SourcedError = DocumentError & { readonly source: string };

/**
 * Parses and validates raw JSON documents, the way a host would after a DB
 * fetch, and indexes them by id. Invalid documents are left out and reported.
 */
export function loadDocumentSet(sources: readonly string[]): { documents: DocumentSet; errors: readonly SourcedError[] } {
  const entities = new Map<string, EntityDocument>();
  const views = new Map<string, ViewDocument>();
  const errors: SourcedError[] = [];
  sources.forEach((raw, i) => {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      errors.push({ source: `document ${i}`, path: "", code: "type", message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`, hint: "Fix the JSON syntax." });
      return;
    }
    const source = typeof json === "object" && json !== null && "id" in json && typeof json.id === "string" ? json.id : `document ${i}`;
    const result = validateDocument(json);
    if (!result.ok) {
      errors.push(...result.errors.map((e) => ({ ...e, source })));
      return;
    }
    const doc = result.value;
    if (doc.kind === "entity") entities.set(doc.id, doc);
    else views.set(doc.id, doc);
  });
  return { documents: { entities, views }, errors };
}
