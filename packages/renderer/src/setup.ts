import { jsonPointer } from "@yadad/core";
import type { DataAdapter, DocumentError, EntityDocument, FormView, TableView } from "@yadad/core";

/** A field id a view refers to, and where in the view document it does. */
export interface FieldRef {
  readonly field: string;
  readonly path: readonly (string | number)[];
}

/**
 * Problems that stop a view from rendering at all, in the core error format:
 * the wrong entity, a missing data source, or references to unknown fields.
 */
export function checkViewSetup(
  entity: EntityDocument,
  view: FormView | TableView,
  adapter: DataAdapter | undefined,
  refs: readonly FieldRef[],
): DocumentError[] {
  const errors: DocumentError[] = [];
  if (view.entity !== entity.id) {
    errors.push({
      path: "/entity",
      code: "invalid-value",
      message: `View "${view.id}" is for entity "${view.entity}", but was given "${entity.id}".`,
      hint: "Pass the entity document the view names.",
    });
  }
  if (!adapter) {
    errors.push({
      path: "/dataSource",
      code: "invalid-value",
      message: `No data source "${view.dataSource}" was provided.`,
      hint: `Add "${view.dataSource}" to the dataSources the host passes in.`,
    });
  }
  for (const ref of refs) {
    if (!entity.fields.some((f) => f.id === ref.field)) {
      errors.push({
        path: jsonPointer(ref.path),
        code: "invalid-value",
        message: `Field "${ref.field}" does not exist on entity "${entity.id}".`,
        hint: `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`,
      });
    }
  }
  return errors;
}
