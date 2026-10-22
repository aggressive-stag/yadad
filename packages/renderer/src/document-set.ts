import type { EntityDocument, ViewDocument, ViewerDocument, Document } from "@yadad/core";

/** The documents a dashboard or a table row action can refer to, by id. */
export interface DocumentSet {
  readonly entities: ReadonlyMap<string, EntityDocument>;
  readonly views: ReadonlyMap<string, ViewDocument>;
  /**
   * The set's viewer document, if it has one. A renderer given no `viewer`
   * resolves it with every fact at its declared default.
   */
  readonly viewer?: ViewerDocument;
}

/**
 * Sort a pile of documents into a {@link DocumentSet}: entities and views by
 * id, and at most one viewer document (the last one wins). Lets a host that
 * loads documents as a flat list hand them to the renderers without
 * redeclaring the shape by hand.
 */
export function documentSet(documents: readonly Document[]): DocumentSet {
  const entities = new Map<string, EntityDocument>();
  const views = new Map<string, ViewDocument>();
  let viewer: ViewerDocument | undefined;
  for (const doc of documents) {
    if (doc.kind === "entity") entities.set(doc.id, doc);
    else if (doc.kind === "viewer") viewer = doc;
    else views.set(doc.id, doc);
  }
  return viewer === undefined ? { entities, views } : { entities, views, viewer };
}
