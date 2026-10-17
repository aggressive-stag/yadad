import type { EntityDocument, ViewDocument, ViewerDocument } from "@yadad/core";

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
