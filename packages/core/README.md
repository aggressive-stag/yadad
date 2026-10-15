# @yadad/core

The yadad contract: document types, document validation, spec migrations, and the `Registry` and `DataAdapter` interfaces that hosts implement. Headless: no React, no I/O, no runtime dependencies on other yadad packages.

```sh
npm install @yadad/core
```

## Validate documents

Documents (entities and form, table and dashboard views) are plain JSON. Validate anything that did not come from your own code:

```ts
import { migrate, validateDocument, validateDocuments } from "@yadad/core";

const result = validateDocument(migrate(JSON.parse(json)));
if (result.ok) {
  result.value; // a typed EntityDocument | FormView | TableView | DashboardView
} else {
  for (const e of result.errors) console.log(e.path, e.code, e.message, e.hint);
}

validateDocuments([entity, form, table]); // also checks references between documents
```

Errors are `{ path, code, message, hint }`: `path` is a JSON Pointer, and the message and hint are written to be read by a person or an agent. Valid documents may still carry `warnings` (for example a form with no fields).

## Exports

- Document types: `EntityDocument`, `FormView`, `TableView`, `DashboardView`, `Field`, `Condition` and friends; `SPEC_VERSION`.
- `validateDocument`, `validateDocuments`, `migrate` (upgrades a document from an older `specVersion`; version 0 documents stay valid).
- `Registry<N>`: the exact-key map of field `Input`/`Display` components, layout pieces and widgets that the renderer looks components up in. `N` is the UI library's node type, so core needs no React.
- `DataAdapter`, `Query`, `DataRecord`, `WriteMeta`, and the typed adapter errors (`RecordConflictError`, `RecordNotFoundError`, `RecordValidationError`, `UnauthorizedError`, `ForbiddenError`).
- `recordJsonSchema(entity)`: a standard JSON Schema (draft 2020-12) for a record's `values` under an entity, so a backend can validate records with any JSON Schema library. In the repo, `pnpm record-schema <entity.json>` prints it; see `docs/records-protocol.md` for what it cannot express.
- `describeContract()`: a plain JSON description of everything a document can contain (kinds, field types, condition ops, relative dates, widgets, grid limits, the id pattern, error codes), generated from the constants the validator uses. In the repo, `pnpm describe-registry` prints it.

## Rules worth knowing

- `specVersion` is the document format (currently 1); `revision` counts user edits to a document and is data.
- Ids (documents, fields, sections, tabs, grid items) match `[a-z][a-z0-9_]*`, e.g. `workout_set`; grid-item ids need only be unique within their tab.
- Conditions are a JSON AST. Date comparisons accept a relative date, `{ "daysFromToday": n }`.

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
