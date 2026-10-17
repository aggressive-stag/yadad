# @yadad/editor

## 0.11.1

### Patch Changes

- 0f0279e: The table view editor's columns table scrolls sideways inside its own region on narrow screens, so the Actions column is reachable without scrolling the page. The region takes focus, so arrow keys scroll it.
- 869cd83: The README describes the current exports: boards, viewer facts and the state grid, with examples that type-check.
- Updated dependencies [869cd83]
- Updated dependencies [869cd83]
  - @yadad/core@0.10.1
  - @yadad/runtime@0.8.2

## 0.11.0

### Minor Changes

- 94af1e2: Edit viewer facts and viewer conditions (RFC 0006).
  
  - New `ViewerPanel` declares the facts of a `viewer` document: add, remove, reorder and relabel facts, edit a select fact's values and each default. Given `documents`, removing a fact or value that a condition still reads is refused and the places that read it are listed. Patch helpers are exported (`addViewerFact`, `removeViewerFactValue`, `viewerEditConflicts`, ...), plus `blankViewer`.
  - The condition builder takes `viewer` and `sources`, and offers a "The viewer" source next to the record field. `FormViewEditor`, `TableViewEditor`, `CalendarViewEditor`, `BoardViewEditor` and `DashboardLayoutEditor` take an optional `viewer` prop; with it, columns, row actions, calendars, boards, dashboard tabs and widgets get `visibleWhen` / `editableWhen` controls (`ViewerRule`), and form items can read a viewer fact. Turning editing off also drops `editableWhen`.
  - `StatesPreview` matches saved and edited states by the axis values they share, so adding a condition no longer marks every state New and lists all the old ones as gone, and it names the viewer facts a view reads.
  
  `ConditionBuilder`'s `entity` prop is now optional (omit it where there is no record). `describeCondition` takes an optional third argument to label viewer facts.

## 0.10.1

### Patch Changes

- Updated dependencies [3d50d86]
  - @yadad/runtime@0.8.1

## 0.10.0

### Minor Changes

- b22a2a3: Add `StatesPreview`, which a host puts next to a view editor to see every state of the document being edited. It marks the states that are new or look different from the saved revision, and shows the host's check problems per state (through `checkStates`, since the editor cannot import the testing package). The form, table, calendar and board editors take a new optional `onChange` that reports the document after each edit, undo or redo.

## 0.9.1

### Patch Changes

- Updated dependencies [7aedd18]
  - @yadad/runtime@0.8.0

## 0.9.0

### Minor Changes

- 0f1de59: Add `BoardViewEditor` for `board` views, in the style of the calendar editor. It edits the title, the title field, whether dragging a card moves it, the card order within a column, a fixed filter (through the shared condition builder), the `groupBy` list (only select, reference and optional boolean fields are offered, one to `BOARD_GROUP_BY_MAX`, the first is the default), up to `BOARD_CARD_FIELDS_MAX` card fields, and the `rowAction` (shared with the table editor's row-action targets). Groupings and card fields can be dragged by a grip or moved with the arrow keys or Move buttons; each change is one validated, undoable patch and the new position is announced. Also adds the board patch helpers in `views.ts` (`addBoardGroupBy`, `setBoardTitleField`, `moveBoardCardField` and so on), `blankBoard`, and offers board views as embeddable widgets in `DashboardLayoutEditor`'s palette.

### Patch Changes

- 6dde494: The board panel now announces "Board settings applied." when Apply settings is pressed, instead of leaving the previous message in the live region.
- 6a83b20: Keep up with the new `viewerIn` condition op (RFC 0006, not implemented yet in these packages). `evaluateCondition` returns false for a `viewerIn` leaf (the answer for no viewer), `viewStates` ignores one, and the editor describes one in words and treats it as not editable in the condition builder. Viewer semantics arrive in later releases.
- Updated dependencies [91a2d86]
- Updated dependencies [9ff56b5]
- Updated dependencies [b6a63f6]
- Updated dependencies [6a83b20]
- Updated dependencies [6a83b20]
  - @yadad/runtime@0.7.0
  - @yadad/core@0.10.0

## 0.8.2

### Patch Changes

- Updated dependencies [8ff4e7d]
  - @yadad/runtime@0.6.2

## 0.8.1

### Patch Changes

- Updated dependencies [b7012ca]
  - @yadad/core@0.9.0
  - @yadad/runtime@0.6.1

## 0.8.0

### Minor Changes

- 343507e: Add `CalendarViewEditor` for `calendar` views, in the style of the table and form editors. It edits the title, date/title/colour fields, week start, whether dragging an entry moves it, the sort within a day and a fixed filter (through the shared condition builder), up to `CALENDAR_DETAIL_FIELDS_MAX` detail fields (draggable by a grip or moved with the arrow keys, each move one undoable patch), the `modes` a viewer can switch between and their default, and the `rowAction` (shared with the table editor's row-action targets). The showcase's bookings calendar now goes through the normal view/edit flow (the demo entity and views are folded into its documents) instead of a hardcoded section, so it is reachable from the standard "Edit" toolbar and `DashboardLayoutEditor`'s palette offers calendars as embeddable widgets.

## 0.7.3

### Patch Changes

- Updated dependencies [0f5e074]
  - @yadad/runtime@0.6.0

## 0.7.2

### Patch Changes

- Updated dependencies [524f917]
  - @yadad/core@0.8.0
  - @yadad/runtime@0.5.2

## 0.7.1

### Patch Changes

- Updated dependencies [0d0c2d0]
  - @yadad/core@0.7.0
  - @yadad/runtime@0.5.1

## 0.7.0

### Minor Changes

- 6ec0fed: The entity fields editor can add a reference field (pick the target entity and an optional display field; pass `entities` for pickers). The condition builder offers is, is not, is empty and is filled in for references; they are not offered as quick filters or sort keys.
- 64fcdd7: `TableViewEditor` can set and clear a table's row action (RFC 0003): pick another table view, one field here and a same-typed field of the target. It takes an optional `context` prop (`{ tables, entities }`); without it the section is hidden. `setRowAction()` and `rowActionTargets()` are exported; the patch is checked with the document validator, so unknown targets, type mismatches, cycles and over-deep chains are refused with its message and hint.
- ed001aa: The dashboard layout editor can add a stat widget, change its measure (op, field, and a second field to multiply by for sum and avg), and edit its filter with the condition builder. New `setStatMeasure()` and `measureFor()` helpers; `fieldReferences()` reports stat measures and filters.

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

## 0.6.0

### Minor Changes

- e21c2e7: The condition builder offers "a fixed date" or "today plus or minus days" for date comparisons, and the table editor can turn number and date columns into quick filters.

### Patch Changes

- 7bcc624: Grid item ids are unique per tab, not per dashboard: switching tabs no longer carries a form's typed input into another tab's widget that shares the item id, and the layout editor's open count filter stays on its own tab.
- Updated dependencies [0ccfcd9]
- Updated dependencies [e21c2e7]
- Updated dependencies [e21c2e7]
  - @yadad/runtime@0.4.0
  - @yadad/core@0.5.0

## 0.5.1

### Patch Changes

- 76d71b1: Fix two condition builder bugs:
  
  - Apply stays disabled until every condition row is complete, and the builder says so. Before, an unfinished row (for example a comparison with no value yet) was dropped silently when applying.
  - Changing a row's field now resets its operator to "is" when the new field's type does not offer it (for example "is one of" carried onto a number field), instead of leaving a row that could never be applied.

## 0.5.0

### Minor Changes

- ec78c02: Add `ConditionBuilder` and condition helpers for form, table, and layout editors:
  
  - `conditions.ts`: `ConditionDraft` (flat canonical form), `toCondition`, `draftFromCondition` (non-canonical/deep conditions round-trip as-is), `summaryCondition`
  - `condition-builder.tsx`: comparison rows with field/op/value derived from entity field types, all/any combining, negation, add/remove, draft validation
  - `views.ts`: `setFormItemCondition` (requiredWhen + visibleWhen + clearWhenHidden), `setTableFilter`, `setCountWidgetFilter`
  - `FormViewEditor`: per-item required/visible rules editable in place; deep conditions render read-only with a Replace button (wholesale replace only, no half-edits)
  - `TableViewEditor`: "rows always match" filter editable via the builder
  - `DashboardLayoutEditor`: count-widget filter per widget, isolated from the counted table's own filter

## 0.4.0

### Minor Changes

- 805e8f5: Drag-to-reorder in the view editors: field rows and section legends in `form-view-editor` and column headers in `table-view-editor` can be reordered by pointer drag (mouse and touch) or by focusing a drag grip and using the arrow keys. A drop indicator shows the landing row while dragging, applied moves are announced in the editor's live status line, and a drop onto a row's current position is a no-op that leaves the undo stack untouched.
  
  Also exported for custom editors: the `useReorder` hook with its `ReorderGrip` and `DropIndicator`, the shared pointer-drag math (`nearestSpan`, `insertIndex`, `flatIndex`), and the single-patch move primitives `moveFieldTo`, `moveSectionTo`, and `moveColumnTo`.

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

- fcce1fc: Build a whole app in the editor: `FormViewEditor` and `TableViewEditor` lay out forms and set up tables; `DashboardLayoutEditor` takes `views` to add widgets, removes widgets and manages tabs; patch helpers for all of these plus `blankEntity`, `blankForm`, `blankTable`, `blankDashboard` and `idFromTitle`.

## 0.1.3

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

- a572431: Add `applyPatch` (JSON Patch) to runtime, and the first editor: patch-based edit sessions with undo and redo, dashboard layout and field edit helpers, `DashboardLayoutEditor` and `EntityFieldsEditor`.

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
