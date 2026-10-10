import { SPEC_VERSION } from "@yadad/core";
import type { DashboardView, EntityDocument, FormView, TableView } from "@yadad/core";

// Starting points for building an app from nothing. Each is a valid document
// at revision 1 that the editors can take from there.

/** An entity with no fields yet; add them with the fields editor. */
export function blankEntity(id: string): EntityDocument {
  return { kind: "entity", specVersion: SPEC_VERSION, id, revision: 1, fields: [] };
}

/** A form placing every field of the entity in one section, in entity order. */
export function blankForm(entity: EntityDocument, id: string, dataSource: string): FormView {
  return {
    kind: "form",
    specVersion: SPEC_VERSION,
    id,
    entity: entity.id,
    revision: 1,
    dataSource,
    sections: [{ id: "main", items: entity.fields.map((f) => ({ field: f.id })) }],
  };
}

/** A table showing every field of the entity as a column; null while the entity has no fields, since a table needs a column. */
export function blankTable(entity: EntityDocument, id: string, dataSource: string): TableView | null {
  if (entity.fields.length === 0) return null;
  return { kind: "table", specVersion: SPEC_VERSION, id, entity: entity.id, revision: 1, dataSource, columns: entity.fields.map((f) => ({ field: f.id })) };
}

/** A dashboard with one empty tab; add widgets with the layout editor. */
export function blankDashboard(id: string, title?: string): DashboardView {
  return { kind: "dashboard", specVersion: SPEC_VERSION, id, ...(title ? { title } : {}), revision: 1, tabs: [{ id: "main", title: "Main", items: [] }] };
}
