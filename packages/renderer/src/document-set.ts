import type { EntityDocument, ViewDocument } from "@yadad/core";

/** The documents a dashboard or a table row action can refer to, by id. */
export interface DocumentSet {
  readonly entities: ReadonlyMap<string, EntityDocument>;
  readonly views: ReadonlyMap<string, ViewDocument>;
}
