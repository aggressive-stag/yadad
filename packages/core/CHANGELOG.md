# @yadad/core

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
