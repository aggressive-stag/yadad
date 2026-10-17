# @yadad/core

The yadad contract: document types, document validation, spec migrations, and the `Registry` and `DataAdapter` interfaces that hosts implement. Headless: no React, no I/O, no runtime dependencies on other yadad packages.

```sh
npm install @yadad/core
```

## Validate documents

Documents (entities; form, table, calendar, board and dashboard views; and the viewer) are plain JSON. Validate anything that did not come from your own code:

```ts
import { migrate, validateDocument, validateDocuments } from "@yadad/core";

const result = validateDocument(migrate(JSON.parse(json)));
if (result.ok) {
  result.value; // a typed Document: EntityDocument | FormView | TableView | CalendarView | BoardView | DashboardView | ViewerDocument
} else {
  for (const e of result.errors) console.log(e.path, e.code, e.message, e.hint);
}

validateDocuments([entity, form, table]); // also checks references between documents
```

Errors are `{ path, code, message, hint }`: `path` is a JSON Pointer, and the message and hint are written to be read by a person or an agent. Valid documents may still carry `warnings` (for example a form with no fields).

## A board and who is viewing

A board shows records as cards in columns, one per value of a select, boolean or reference field. A `viewer` document declares facts about whoever is looking, and a `viewerIn` condition uses them (RFC 0006):

```ts
import type { BoardView, ViewerDocument } from "@yadad/core";

const viewer: ViewerDocument = {
  kind: "viewer", specVersion: 5, id: "viewer", revision: 1,
  facts: [{ id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor"] }, default: "viewer" }],
};

const board: BoardView = {
  kind: "board", specVersion: 5, id: "task_board", entity: "task", revision: 1, dataSource: "default",
  groupBy: [{ field: "status" }, { field: "owner" }], // the viewer picks one; the first is the default
  titleField: "title",
  editable: true, // dragging a card to another column changes the grouping field...
  editableWhen: { op: "viewerIn", fact: "role", values: ["editor"] }, // ...but only for editors
};
```

Viewer conditions may appear only where `describeContract().conditionPlaces` lists them, and never in a `filter`. A record read through a `DataAdapter` may carry `can: { update?, delete? }` (`RecordPermissions`), which can only take rights away; the server still decides.

## Exports

- Document types: `EntityDocument`, `FormView`, `TableView`, `CalendarView`, `BoardView`, `DashboardView`, `ViewerDocument` (with `ViewerFact`, `ResolvedViewer`), `Field`, `Condition` and `ViewerCondition` (the `viewerIn` subset for viewer-only places) and friends; `SPEC_VERSION`.
- `validateDocument`, `validateDocuments`, `migrate` (upgrades a document from an older `specVersion`; version 0 documents stay valid).
- `Registry<N>`: the exact-key map of field `Input`/`Display` components, layout pieces and widgets that the renderer looks components up in. `N` is the UI library's node type, so core needs no React. `layout.Calendar` (`CalendarProps`) and `layout.Board` (`BoardProps`) are optional keys: without one, that view kind renders an error summary.
- `DataAdapter`, `Query`, `DataRecord` (with `can?: RecordPermissions`), `WriteMeta`, and the typed adapter errors (`RecordConflictError`, `RecordNotFoundError`, `RecordValidationError`, `UnauthorizedError`, `ForbiddenError`).
- `recordJsonSchema(entity)`: a standard JSON Schema (draft 2020-12) for a record's `values` under an entity, so a backend can validate records with any JSON Schema library. In the repo, `pnpm record-schema <entity.json>` prints it; see `docs/records-protocol.md` for what it cannot express.
- `describeContract()`: a plain JSON description of everything a document can contain (kinds, field types, condition ops, where each kind of condition may appear, relative dates, widgets, grid limits, the id pattern, error codes), generated from the constants the validator uses. In the repo, `pnpm describe-registry` prints it.

## Rules worth knowing

- `specVersion` is the document format (currently 5); `revision` counts user edits to a document and is data.
- Ids (documents, fields, sections, tabs, grid items) match `[a-z][a-z0-9_]*`, e.g. `workout_set`; grid-item ids need only be unique within their tab.
- Conditions are a JSON AST. Date comparisons accept a relative date, `{ "daysFromToday": n }`; `viewerIn` tests a viewer fact.

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
