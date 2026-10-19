# @yadad/core

## 0.11.0

### Minor Changes

- d13f4cb: Review screens, part one (RFC 0007). `specVersion` is now 6; older documents stay valid and `migrate()` only stamps the new version.
  
  What you change when you upgrade:
  
  - `fields.datetime` is a new **optional** registry key, so existing component sets still type-check. A document that uses a `datetime` field with a registry that lacks it shows an error naming the key. `Registry.fields` is now `RegistryFields<N>`.
  - `Page.total` is now **optional** and `Page` gains `next?: string | null`, an opaque cursor. Code that reads `page.total` as a number must handle `undefined`.
  - `Query.page` is now a **union**: `{ offset, limit }` or `{ cursor, limit }`. Code that reads `query.page.offset` must narrow first (`"cursor" in query.page`).
  - `RecordPermissions` gains `actions?: Readonly<Record<string, boolean>>` (action id to allowed; only `false` restricts).
  - `DataAdapter` gains an **optional** `act(entity, id, action, request)` method, with the `ActionRequest` type. Existing adapters need no change.
  
  What is new:
  
  - A `datetime` field type: an instant stored as `YYYY-MM-DDTHH:MM:SS.sssZ` (UTC, milliseconds, `Z`), with `min` and `max`. It cannot be a calendar `dateField` or a board `groupBy`.
  - Entity `actions` (id, label, `confirm`, typed `input`, `visibleWhen`) and view `recordActions` on tables, boards and calendars, with the validator's shape, reference and viewer-fact checks.
  - A table column `compare` (`{ to: "previousRow" | "nextRow" }` or `{ field }`) for text fields.
  - Optional registry types: `layout.Dialog` (`DialogProps`), `RecordActionItem` with `actions` on `TableRow`, `BoardCard` and `CalendarEntry`, `TableProps.actionsLabel`, and `diff` (`DiffSegment`) on the text `Display`.
  - `recordJsonSchema` emits `format: "date-time"` and a canonical pattern for `datetime` fields; `describeContract` lists all of the above.

## 0.10.1

### Patch Changes

- 869cd83: The README describes the current exports: boards, viewer facts and the state grid, with examples that type-check.

## 0.10.0

### Minor Changes

- 9ff56b5: Align the board registry types with RFC 0005. Registry implementers of `layout.Board` must change: `BoardColumn` has `id` (stable: `v:<value>`, `empty` or `other`), `count` and `droppable` instead of `value`; `BoardProps.groupedBy` is now `groupField`; `onGroupChange` is now `onGroupBy`; and `onMove` is called with `(recordId, columnId)` where `columnId` is a column `id`, not a raw value. Column order and `cards` are as before.
- 6a83b20: Add viewer facts and per-record permissions to the contract (RFC 0006, slice 1). `SPEC_VERSION` is now 5; `migrate()` stamps older documents and changes nothing else, and documents that use none of the new keys behave as before. New: the `viewer` document kind (`ViewerDocument`, `ViewerFact`, `VIEWER_FACT_TYPES`, `VIEWER_FACTS_MAX`, `VIEWER_FACT_VALUES_MAX`, `ResolvedViewer`, `ViewerFactValue`); the `viewerIn` condition op and the `ViewerCondition` subset; `conditionViewerFacts()`; optional viewer-only `visibleWhen` on table columns, `rowAction`, dashboard tabs and grid items, and `editableWhen` on table columns, calendars and boards; `DataRecord.can` (`RecordPermissions`); `describeContract()` gains `viewer` and `conditionPlaces`. A viewer leaf is rejected in any `filter`, and a record leaf in a viewer-only place.
  
  What users must change: code that switches exhaustively on `Condition["op"]`, or reads `condition.field` in a default branch, needs a `viewerIn` case (it has `fact` and `values`, no `field`; `conditionFields()` returns nothing for it). Code that switches on `Document["kind"]` needs a `"viewer"` case; `DOCUMENT_KINDS` and `Document` gain it, and `ViewerDocument` is not a `ViewDocument`. Everything else is additive and optional.

## 0.9.0

### Minor Changes

- b7012ca: Add the `board` view kind (RFC 0005) and bump `specVersion` to 4. A board groups the records of one entity into columns by a `select`, `boolean` or `reference` field (`groupBy`, 1 to 5 entries, no duplicates, never a required boolean, the first is the default grouping), with each card titled by `titleField` (a `text` or `select` field, defaulting to the entity's first text field; required when the entity has none) and optional `title`, `cardFields` (up to 3), `filter`, `sort`, `editable` and `rowAction` — all reused from the table view's patterns. A dashboard `view` widget can embed one; `count` and `stat` widgets still take table views only. `migrate()` upgrades version 3 documents by stamping version 4, and older documents stay valid. New exports: `BoardView`, `BoardGroupBy`, the board limits in `contract.ts`, and the registry types `BoardProps`, `BoardColumn`, `BoardCard` and `BoardGroupChoice`. `Registry.layout.Board` is optional for now, so existing registries keep type-checking; `describeContract()` gains `board` and a `layout.Board` entry in `optionalRegistryKeys`. `ViewDocument` and `DOCUMENT_KINDS` gain `board`, so code that switches over view kinds needs a board case (or a default).

## 0.8.0

### Minor Changes

- 524f917: Add the `calendar` view kind (RFC 0004) and bump `specVersion` to 3. A calendar places the records of one entity on the days of a month or week by one `date` field (`dateField`), with optional `titleField`, `detailFields`, `colorField`, `filter`, `sort`, `modes`, `weekStartsOn`, `editable` and `rowAction`. A dashboard `view` widget can embed one; `count` and `stat` widgets still take table views only. `migrate()` upgrades version 2 documents by stamping version 3, and older documents stay valid. New exports: `CalendarView`, `CALENDAR_MODES`, `CalendarMode`, the calendar limits in `contract.ts`, and the registry types `CalendarProps`, `CalendarDayProps` and `CalendarEntry`. `Registry.layout.Calendar` is optional for now, so existing registries keep type-checking; `describeContract()` gains `calendar` and `optionalRegistryKeys`. `ViewDocument` and `DOCUMENT_KINDS` gain `calendar`, so code that switches over view kinds needs a calendar case (or a default).

## 0.7.0

### Minor Changes

- 0d0c2d0: Add `recordJsonSchema(entity)`, which compiles an entity to a standard JSON Schema (draft 2020-12) for a record's `values`, so a backend can validate records with any JSON Schema library instead of re-implementing the field rules. `pnpm record-schema <entity.json>` prints the schema for an entity file. Nothing existing changes. Known differences from `validateRecord` are listed in `docs/records-protocol.md`.

## 0.6.0

### Minor Changes

- 6ec0fed: Add the `reference` field type (RFC 0002 slice 1): `{ type: "reference", entity, display? }` stores another entity's record id. The validator checks the target entity and display field across a set and rejects reference fields as quick filters, table sort keys and in ordering conditions. The registry gains the `reference` key, whose Input gets the picker options and whose Display gets the resolved label (`ReferenceOptions`, `ReferenceInputExtras`, `ReferenceDisplayExtras`).
- 7b3c167: Table views gain an optional `rowAction` (`{ open, bind: [{ field, to }], mode? }`, RFC 0003 slice 1): a row opens another table view filtered by the row's values. The validator checks the target is a table, both fields exist with the same type, no cycles and at most 3 hops (`MAX_ROW_ACTION_DEPTH`). `describeContract()` reports it.
- 696677d: `specVersion` is now 2. Version 0 and 1 documents stay valid, and `migrate()` stamps them as version 2.
- de5d2d3: Add the `stat` dashboard widget (RFC 0001, slice 1): a `measure` of `count`, `sum`, `avg`, `min`, `max` or `countDistinct` over a table view's records, with `product: [a, b]` for sum and avg. `describeContract()` lists the measure ops, the validator checks view, field ids and field types, and `CountWidgetProps` gains an optional preformatted `text`.

## 0.5.0

### Minor Changes

- e21c2e7: Add relative dates to conditions: a comparison on a date field may take `{ "daysFromToday": N }` as its value. The validator rejects non-integers, non-date fields, and use in `in`/`contains`. `specVersion` is now 1 (version 0 documents stay valid), `migrate()` upgrades older documents, and `describeContract()` reports the relative date.

## 0.4.0

### Minor Changes

- 3b26d75: `describeContract()`: a pure function that returns a plain JSON description of everything a document can contain (document kinds and their properties, field types and their type-specific properties, condition ops with their exact shapes, widget types, grid limits, the id pattern, the error codes). It is generated from the same constants the validator uses, so it cannot describe what the validator rejects; the new drift tests in `contract.test.ts` prove it (every listed property is accepted at its path, every unlisted one is rejected, every op shape validates). The root script `pnpm describe-registry` prints the description (readable text by default, `--json` for machines) directly from the TypeScript source, so it works from a fresh clone after `pnpm install` with no build step.

## 0.3.1

### Patch Changes

- 12bb9fa: Each package now ships a short README describing what it is and linking to the repo README and ARCHITECTURE.md, so the published packages say what they are without opening the repo.

## 0.3.0

### Minor Changes

- 4bb09dc: Breaking: table views use `quickFilters` (type `QuickFilter`) instead of `filters`; rename the key in existing documents. Validation results now carry `warnings` (code `empty`) for valid but empty documents, which the editors show; condition errors name the key each op takes and show its exact shape.

## 0.2.0

### Minor Changes

- 01ed46c: Add `validateDocuments(inputs)`, which validates a set of documents together, on top of checking each one alone: every form/table view's `entity` exists, every field id used by forms (items and conditions), tables (columns, sort, quick filters and fixed filter) and a dashboard `count` widget's filter exists on the view's entity, dashboard `view` widgets point at an existing form or table and `count` widgets at a table, and document ids are unique per kind. New closed error code `unknown-reference`; `DocumentError` gains optional `document` (the id of the document the error belongs to) and `allowed` (the ids or values that would have been accepted).
- 7ed972d: `DataRecord` now carries an opaque `version`, `WriteMeta` accepts `baseVersion`, `DataAdapter.delete` accepts write metadata, and `DataAdapter.batch` creates and deletes records atomically. Adapter failures are typed `AdapterError` subclasses (`RecordNotFoundError`, `RecordConflictError`, `RecordValidationError`, `UnauthorizedError`, `ForbiddenError`) with the records-protocol error codes.

## 0.1.0

### Minor Changes

- 2535b59: Add number, boolean, select and date fields across the engine: document validation, record validation, rendering, mock components and the contract kit. Inputs get `describedBy` and FieldFrame an `errorId` so errors are linked to their input.
- 9b53d91: Add JSON conditions: `visibleWhen`, `requiredWhen` and `clearWhenHidden` on form items; a fixed `filter` and quick `filters` on table views; `Query.filter`; `evaluateCondition`, `evaluateFormRules` and `applyFormRules` in runtime.
- 3e64a96: Add the pre-contract walking-skeleton contract: entity and form view documents (text fields only), the `{ path, code, message, hint }` error format, the `Registry` and `DataAdapter` interfaces, and `validateDocument`. Phase 1 replaces it with contract-v0.
- 804f491: Add dashboards: a `dashboard` view kind with tabs and a grid of view and count widgets; `DashboardRenderer` and `DocumentSet`; `Tabs`, `Panel` and the `count` widget in the registry, mock registry and contract kit.
- dc3605f: Add `ErrorSummary` to the registry layout; the renderer uses it for setup and save errors.
- 8f6a1b0: Add table views: a `table` document kind with columns, default sort and page size; sorting in `Query` and the memory adapter; `submitEdit`; and `TableRenderer` with sorting, paging and in-place editing. The registry's layout gains `Section`, `Button` and `Table`, and inputs accept `labelledBy`.
