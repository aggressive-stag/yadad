# @yadad/core

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
