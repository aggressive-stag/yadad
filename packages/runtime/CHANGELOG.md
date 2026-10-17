# @yadad/runtime

## 0.8.1

### Patch Changes

- 3d50d86: `viewStates` no longer lists impossible viewer combinations: "1 record locked" is left out of states with no records, a dashboard tab is only listed for viewers who can see it (a viewer who sees no tab gets one state, on the first tab), and the "viewer not provided" state sits on the first tab the default viewer sees. The permission axis value "no record locked" is now called "records open".

## 0.8.0

### Minor Changes

- 7aedd18: Viewer facts and per-record permissions (RFC 0006). `resolveViewer(document, input)` builds the `ResolvedViewer` renderers take, with `issues` for values it had to ignore. `evaluateCondition` takes an optional `viewer` (a `viewerIn` leaf reads it; with none it is false), as do `evaluateFormRules` and `applyFormRules`. New pure helpers: `findViewerDocument`, `evaluateViewerCondition`, `visibleColumns`, `columnEditable`, `viewEditable`, `rowActionVisible`, `visibleTabs`, `visibleItems`, `canUpdate`, `viewerFactsRead`, `viewerLeavesRead`. The memory and key-value adapters take `recordPermissions`, carry the result as `can` on every record they return and refuse updates and deletes with a `ForbiddenError`; the HTTP adapter passes a valid `can` through and drops a malformed one; every adapter rejects a filter containing a `viewerIn` leaf with a `RecordValidationError` at `/filter`.
  
  `viewStates` gains a `viewer:<factId>` axis per viewer fact a view reads, a `permission` axis (`unrestricted`, `record-locked`) on views with an edit surface, and one extra `viewer-not-provided` state. Every `ViewState` now has a `viewer: ResolvedViewer` (and `omitViewer: true` on the extra state); code that builds a `ViewState` by hand must add `viewer`. Views that read no fact and have no edit surface produce the same states as before.

## 0.7.0

### Minor Changes

- b6a63f6: Add `viewStates(view, documents, { now, limit })`: lists the states a view can be in, read from its documents.
  
  The conditions a view uses (form `visibleWhen` and `requiredWhen`, the `filter` of a table, calendar or board, row-action bindings) become axes with boundary values by type, and the view kind adds axes (record counts, a calendar's mode, a board's `groupBy`, a dashboard's tabs and embedded views). Axes are combined into at most `limit` states (default 24): every combination when they fit, otherwise a deterministic pairwise cover. Each state has a stable `id`, a readable `label`, the chosen value per axis and what to render (form values, or validated records and the matching ids, plus `now`). A state that cannot be built is left out and listed under `skipped`. Also exports `combineAxes(axes, limit)`, the generic combiner, and the `StateAxis`, `ViewState` and related types.

### Patch Changes

- 91a2d86: `ReferenceOptionsResult` (from `loadReferenceOptions` and `loadBoardTargets`) gains `total`, the target's full record count, so a caller can say "Showing 50 of 63". Existing fields are unchanged.
- 6a83b20: Keep up with the new `viewerIn` condition op (RFC 0006, not implemented yet in these packages). `evaluateCondition` returns false for a `viewerIn` leaf (the answer for no viewer), `viewStates` ignores one, and the editor describes one in words and treats it as not editable in the condition builder. Viewer semantics arrive in later releases.
- Updated dependencies [9ff56b5]
- Updated dependencies [6a83b20]
  - @yadad/core@0.10.0

## 0.6.2

### Patch Changes

- 8ff4e7d: Add board runtime: boardColumns, groupByColumn, boardColumnCounts, boardQuery, loadBoardCards, loadBoardTargets and moveCard, implementing RFC 0005's board view over the BoardView contract added in @yadad/core 0.9.0.

## 0.6.1

### Patch Changes

- Updated dependencies [b7012ca]
  - @yadad/core@0.9.0

## 0.6.0

### Minor Changes

- 0f5e074: Add the calendar range math and queries (RFC 0004). Pure functions over "YYYY-MM-DD" strings: `visibleDays` (a month is always 42 days, a week 7), `visibleRange`, `shiftAnchor`, `calendarToday`, `periodTitle`, `weekdayLabels` and `dayLabel`. Queries: `rangeCondition` (the view's filter AND `gte`/`lte` on the date field), `calendarQuery` and `loadCalendarRange`, which pages through `find` (500 per request, capped at `CALENDAR_MAX_RECORDS` = 2000, with `truncated` set past the cap). Also `groupByDay`, `moveDay` (plans the date-only update, or reports that nothing should be sent) and `colorSlot` (0 to 7). Invalid dates or `weekStartsOn` throw `RangeError`. The adapter conformance suite now checks that an empty date matches neither `gte` nor `lte`.
  
  Fix: `evaluateCondition` no longer lets a blank string match `gt`, `gte`, `lt` or `lte` (a blank text sorted below every value, so `lte` matched it). An empty value now matches none of the four, like a missing or null one.

## 0.5.2

### Patch Changes

- Updated dependencies [524f917]
  - @yadad/core@0.8.0

## 0.5.1

### Patch Changes

- Updated dependencies [0d0c2d0]
  - @yadad/core@0.7.0

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
