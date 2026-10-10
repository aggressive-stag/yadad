# @yadad/renderer

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
