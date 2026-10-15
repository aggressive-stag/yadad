# @yadad/renderer

## 0.5.1

### Patch Changes

- Updated dependencies [0d0c2d0]
  - @yadad/core@0.7.0
  - @yadad/runtime@0.5.1

## 0.5.0

### Minor Changes

- 6ec0fed: Render `reference` fields: forms show a picker loaded from the view's data source, tables show the referenced record's label (batch-resolved per page). Forms and tables take an optional `entities` map of the target entity documents; the dashboard passes its own.
- 9ee694f: `TableRenderer` supports a table's `rowAction`: each row gets an "Open ..." button that replaces the table, in place, with the target table filtered by the row (heading naming the scope, Back button, focus moved to the heading and back to the row's button). It takes an optional `documents` prop (required for a row action), which `DashboardRenderer` passes, so it also works in a dashboard widget. `DocumentSet` moved to its own module and is still exported.
- 624dcb6: Render `stat` dashboard widgets through the registry's count component: formatted number (grouped, at most two decimals), a dash when there is no value, a loading marker, the same error state as counts, and a "partial" note when more than 5000 records matched.

### Patch Changes

- Updated dependencies [6ec0fed]
- Updated dependencies [6ec0fed]
- Updated dependencies [7b3c167]
- Updated dependencies [d2cad00]
- Updated dependencies [696677d]
- Updated dependencies [de5d2d3]
- Updated dependencies [2d1368b]
  - @yadad/core@0.6.0
  - @yadad/runtime@0.5.0

## 0.4.0

### Minor Changes

- e21c2e7: Number and date quick filters work as a from/to range (gte/lte, either end optional). Table and count-widget filters resolve relative dates before they reach the data adapter.

### Patch Changes

- baa1dc3: A count widget whose request fails now shows a "Could not load records" error instead of staying on the loading placeholder. Entering row edit mode in a table focuses the row's first editable input instead of the Save button.
- 7bcc624: Grid item ids are unique per tab, not per dashboard: switching tabs no longer carries a form's typed input into another tab's widget that shares the item id, and the layout editor's open count filter stays on its own tab.
- Updated dependencies [0ccfcd9]
- Updated dependencies [e21c2e7]
- Updated dependencies [e21c2e7]
  - @yadad/runtime@0.4.0
  - @yadad/core@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [3b26d75]
  - @yadad/core@0.4.0
  - @yadad/runtime@0.3.3

## 0.3.1

### Patch Changes

- 12bb9fa: Each package now ships a short README describing what it is and linking to the repo README and ARCHITECTURE.md, so the published packages say what they are without opening the repo.
- Updated dependencies [12bb9fa]
  - @yadad/core@0.3.1
  - @yadad/runtime@0.3.2

## 0.3.0

### Minor Changes

- 4bb09dc: Breaking: table views use `quickFilters` (type `QuickFilter`) instead of `filters`; rename the key in existing documents. Validation results now carry `warnings` (code `empty`) for valid but empty documents, which the editors show; condition errors name the key each op takes and show its exact shape.

### Patch Changes

- Updated dependencies [4bb09dc]
  - @yadad/core@0.3.0
  - @yadad/runtime@0.3.1

## 0.2.0

### Minor Changes

- c3da156: Opt-in drafts for unsaved form input: `createDraftStore` and `restoreDraft` in runtime, and a `drafts` option on `FormRenderer` and `DashboardRenderer` that restores input after a reload with a notice and a Discard button.

### Patch Changes

- Updated dependencies [c3da156]
  - @yadad/runtime@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [8585146]
  - @yadad/runtime@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [01ed46c]
- Updated dependencies [7ed972d]
- Updated dependencies [7ed972d]
  - @yadad/core@0.2.0
  - @yadad/runtime@0.2.0

## 0.1.0

### Minor Changes

- 2535b59: Add number, boolean, select and date fields across the engine: document validation, record validation, rendering, mock components and the contract kit. Inputs get `describedBy` and FieldFrame an `errorId` so errors are linked to their input.
- 9b53d91: Add JSON conditions: `visibleWhen`, `requiredWhen` and `clearWhenHidden` on form items; a fixed `filter` and quick `filters` on table views; `Query.filter`; `evaluateCondition`, `evaluateFormRules` and `applyFormRules` in runtime.
- 804f491: Add dashboards: a `dashboard` view kind with tabs and a grid of view and count widgets; `DashboardRenderer` and `DocumentSet`; `Tabs`, `Panel` and the `count` widget in the registry, mock registry and contract kit.
- dc3605f: Add `ErrorSummary` to the registry layout; the renderer uses it for setup and save errors.
- f133ce9: `DashboardRenderer` stacks widgets into one content-sized column below `stackBelow` (default 640px) and renders widgets in reading order.
- 8f6a1b0: Add table views: a `table` document kind with columns, default sort and page size; sorting in `Query` and the memory adapter; `submitEdit`; and `TableRenderer` with sorting, paging and in-place editing. The registry's layout gains `Section`, `Button` and `Table`, and inputs accept `labelledBy`.
- dbd1cd9: Walking skeleton: the memory data adapter, record validation and headless form state in runtime; `FormRenderer` in renderer; the mock registry in testing.

### Patch Changes

- Updated dependencies [2535b59]
- Updated dependencies [9b53d91]
- Updated dependencies [3e64a96]
- Updated dependencies [804f491]
- Updated dependencies [a572431]
- Updated dependencies [dc3605f]
- Updated dependencies [7017f82]
- Updated dependencies [8f6a1b0]
- Updated dependencies [dbd1cd9]
  - @yadad/core@0.1.0
  - @yadad/runtime@0.1.0
