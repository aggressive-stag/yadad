# @yadad/runtime

## 0.5.0

### Minor Changes

- 6ec0fed: Validate reference values as record ids, and add `loadReferenceOptions` (picker options sorted by the display field, capped at 200 with a `more` flag) and `resolveReferenceLabels` (labels for a set of ids).
- d2cad00: Add `bindFilter(row, bindings, targetFilter?)`: the pure filter a row action's target view shows, the target's own filter AND `eq(to, row[field])` per binding.
- 2d1368b: Add `aggregate()` and `computeMeasure()`: compute a stat measure over an adapter's records, paging 500 at a time up to 5000 records and reporting `partial` past that.

### Patch Changes

- Updated dependencies [6ec0fed]
- Updated dependencies [7b3c167]
- Updated dependencies [696677d]
- Updated dependencies [de5d2d3]
  - @yadad/core@0.6.0

## 0.4.0

### Minor Changes

- 0ccfcd9: `createHttpAdapter` accepts an optional `onUnauthorized` hook, called whenever a response is 401, so a host can redirect to sign-in. The call still rejects with `UnauthorizedError`.
- e21c2e7: Add `resolveRelativeDates()`, `dateFromToday()` and `localIsoDate()`. `evaluateCondition()` takes an optional `now` and resolves relative dates, and the http adapter never sends one to the server.

### Patch Changes

- Updated dependencies [e21c2e7]
  - @yadad/core@0.5.0

## 0.3.3

### Patch Changes

- Updated dependencies [3b26d75]
  - @yadad/core@0.4.0

## 0.3.2

### Patch Changes

- 12bb9fa: Each package now ships a short README describing what it is and linking to the repo README and ARCHITECTURE.md, so the published packages say what they are without opening the repo.
- Updated dependencies [12bb9fa]
  - @yadad/core@0.3.1

## 0.3.1

### Patch Changes

- Updated dependencies [4bb09dc]
  - @yadad/core@0.3.0

## 0.3.0

### Minor Changes

- c3da156: Opt-in drafts for unsaved form input: `createDraftStore` and `restoreDraft` in runtime, and a `drafts` option on `FormRenderer` and `DashboardRenderer` that restores input after a reload with a notice and a Discard button.

## 0.2.1

### Patch Changes

- 8585146: Empty updates are now a no-op in the memory and key-value adapters (the version is kept), `submitEdit` sends only changed fields and skips the save when nothing changed, and the HTTP adapter reports a 409 without a JSON body as a `RecordConflictError` instead of throwing a `TypeError`.

## 0.2.0

### Minor Changes

- 7ed972d: Add `createHttpAdapter({ baseUrl, fetch?, credentials?, headers? })`, a `DataAdapter` client for the HTTP records protocol. The memory and key-value adapters now implement record versions, stale `baseVersion` conflicts, atomic `batch`, and unknown-field validation. Form saves pass the loaded record's version and report adapter failures through the existing form error display.

### Patch Changes

- Updated dependencies [01ed46c]
- Updated dependencies [7ed972d]
  - @yadad/core@0.2.0

## 0.1.0

### Minor Changes

- 2535b59: Add number, boolean, select and date fields across the engine: document validation, record validation, rendering, mock components and the contract kit. Inputs get `describedBy` and FieldFrame an `errorId` so errors are linked to their input.
- 9b53d91: Add JSON conditions: `visibleWhen`, `requiredWhen` and `clearWhenHidden` on form items; a fixed `filter` and quick `filters` on table views; `Query.filter`; `evaluateCondition`, `evaluateFormRules` and `applyFormRules` in runtime.
- a572431: Add `applyPatch` (JSON Patch) to runtime, and the first editor: patch-based edit sessions with undo and redo, dashboard layout and field edit helpers, `DashboardLayoutEditor` and `EntityFieldsEditor`.
- 7017f82: Add `createKeyValueAdapter` (a DataAdapter over localStorage or any getItem/setItem store) and `runQuery`, now shared with the memory adapter.
- 8f6a1b0: Add table views: a `table` document kind with columns, default sort and page size; sorting in `Query` and the memory adapter; `submitEdit`; and `TableRenderer` with sorting, paging and in-place editing. The registry's layout gains `Section`, `Button` and `Table`, and inputs accept `labelledBy`.
- dbd1cd9: Walking skeleton: the memory data adapter, record validation and headless form state in runtime; `FormRenderer` in renderer; the mock registry in testing.

### Patch Changes

- Updated dependencies [2535b59]
- Updated dependencies [9b53d91]
- Updated dependencies [3e64a96]
- Updated dependencies [804f491]
- Updated dependencies [dc3605f]
- Updated dependencies [8f6a1b0]
  - @yadad/core@0.1.0
