# @yadad/renderer

## 0.10.0

### Minor Changes

- d67034d: The confirm and input dialog (RFC 0007): pressing an action with `confirm` or `input` opens `layout.Dialog` — the renderer builds the content (the message, the input fields as FieldFrame plus the type's Input, an ErrorSummary, Cancel and Confirm), the component only provides the modal behaviour. Confirm validates with `validateActionInput` before the server sees anything, then calls `act` with Confirm disabled and "Working..." announced. A 400 keeps the dialog open and puts each `/input/<id>` issue on its field; 403/409/404 close it, show the view's ErrorSummary and reload (nothing merged, nothing retried); any other failure keeps it open with the message so the viewer can retry. Cancel and Escape never call `act`, and the modal returns focus to the pressed button. The 35f restriction is gone: every offered action is now pressable. `ButtonProps` gains the optional `tone: "danger"` (the mock renders `data-tone`), so a `danger` confirm reaches the Button.
- 1eaf1b3: Boards and calendars offer record actions (RFC 0007): a board view or calendar view with `recordActions` now fills each `BoardCard.actions` and `CalendarEntry.actions` with the record's available actions (the components draw them next to the "Move to..." path / in the entry, as the RFC table says), through the same `useRecordActions` hook as tables — press runs `act` with the last-read `version` as guard, "<label> done" is announced in the view's own live region (board-status / calendar-status, now shared with moves) and the cards or the range reload; a refusal shows the view's ErrorSummary and reloads; confirm/input actions go through the same dialog. A withheld action (`can.actions[id] === false`, or a false `visibleWhen`) is not drawn. A view whose data source cannot run actions, or that offers an action needing a dialog in a registry without one, is replaced by the ErrorSummary like on tables. The hook takes an optional `announce` so a view with its own announcement state keeps one live region.
- f471d62: Compare columns (RFC 0007): a table column with `compare` now shows its text as a word diff against its comparator — `to: "previousRow" | "nextRow"` (the neighbour in the table's own sort, loaded one row beyond the page edge with `neighbourQuery` and never displayed) or `field` (another text field of the same record). The segments go to the text Display as the new `diff` extra; a row with no neighbour (the oldest version) and a registry that ignores `diff` both show plain text.
- a60a6c9: Cursor paging in the table (RFC 0007): a first page with no `total` and a `next` switches the pager to cursors — the table keeps the cursors it visited, so Previous works without backward cursors — and shows "Page N" with Previous/Next and no "of N". Changing the sort, a quick filter or the page size clears the stack. A response with neither total nor next is the last page. The dashboard `count` on a server that does not count walks the pages (the runtime already did) and shows the number read, or "5000+" when it stopped at the cap with more pending.
- 3b15482: Record actions on tables (RFC 0007): a view's `recordActions` now reach the table on their own — no host prop. `useRecordActions` builds each row's `RecordActionItem`s with `availableActions`, presses run `adapter.act` with the record's last-read version as the guard, the row's buttons go gray while its record is in flight, a success announces "<label> done" and reloads the page, and a 403/409/404 shows the view's ErrorSummary and reloads. A data source that cannot run actions (`act` absent) or an action that needs a dialog the registry does not provide replaces the view with an ErrorSummary (`/dataSource`, `/layout/Dialog`). Until the action dialog lands, an action with `confirm` or `input` is not offered — it must never run without its confirmation. Boards and calendars reuse the same hook in their next cards. `@yadad/testing`: the state adapter now answers `act` like the working source it pretends to be (guard order as the memory adapter; writes obey the refused/conflict matrix), so views with `recordActions` state-check like every other view.
- 48f10a8: Datetime fields in the viewer's zone (RFC 0007): every renderer takes an optional `formatting?: { locale?, timeZone? }` and passes it down (dashboard pass it to each embedded view). A datetime Display gets `text` from `formatDateTime` plus the stored instant for a `<time dateTime>`; the Input shows the local wall time (`instantToLocal`) and stores the instant back (`localToInstant`, DST-safe: an ambiguous local time is the earlier instant). A registry without `fields.datetime` still shows an `ErrorSummary` naming the key. `@yadad/core` gains the optional `DatetimeDisplayExtras.text`; the mock Display renders `text ?? value`. The quick filter gains a from/to range for `datetime`: the control is a text box, the typed local times convert through `instantRangeBounds` (the `to` end covers its whole minute), read in the viewer's zone.

### Patch Changes

- Updated dependencies [d67034d]
- Updated dependencies [48f10a8]
  - @yadad/core@0.12.0
  - @yadad/runtime@0.9.1

## 0.9.3

### Patch Changes

- Updated dependencies [c11cfb5]
- Updated dependencies [407bc6c]
- Updated dependencies [317cde1]
- Updated dependencies [dbc6ded]
- Updated dependencies [0b2e595]
- Updated dependencies [6babd0d]
- Updated dependencies [bc971b7]
- Updated dependencies [7ca1105]
- Updated dependencies [878bfa3]
  - @yadad/runtime@0.9.0

## 0.9.2

### Patch Changes

- d13f4cb: A `datetime` field rendered with a registry that has no `fields.datetime` entry now shows an error summary naming the missing key. The table reads `Page.total` as optional.
- Updated dependencies [d13f4cb]
- Updated dependencies [d13f4cb]
  - @yadad/core@0.11.0
  - @yadad/runtime@0.8.3

## 0.9.1

### Patch Changes

- 869cd83: The README describes the current exports: boards, viewer facts and the state grid, with examples that type-check.
- Updated dependencies [869cd83]
- Updated dependencies [869cd83]
  - @yadad/core@0.10.1
  - @yadad/runtime@0.8.2

## 0.9.0

### Minor Changes

- 3dfc5c3: `CalendarRenderer` takes optional `initialMode` and `initialAnchor` props, so a calendar can open on a given mode and the month or week of a given day. Without them it opens as before.

## 0.8.1

### Patch Changes

- Updated dependencies [3d50d86]
  - @yadad/runtime@0.8.1

## 0.8.0

### Minor Changes

- a788d3d: Every renderer (form, table, calendar, board, dashboard) takes an optional `viewer` prop (RFC 0006) and stops offering what the viewer may not use. Viewer-hidden form items, table columns, dashboard tabs and widgets are not rendered; in-place editing, "Move to…" and drag are withheld when `editableWhen` is false or the record's `can.update` is `false`; a `rowAction` is withheld while its `visibleWhen` is false. Dashboards pass the viewer to the views they embed, and row actions to the views they open. Without a `viewer` prop, a renderer that has the document set (new optional `DocumentSet.viewer`) uses the viewer document's defaults; a bare view that reads a viewer fact shows an `ErrorSummary` (`/viewer`, `required`). A dashboard with no visible tab says "There is nothing to show you here." A 403 is handled as before and refreshes `can`. Documents that read no viewer fact behave as before.

## 0.7.1

### Patch Changes

- 97bcbf1: `TableRenderer` now shows a failed read in the registry's `ErrorSummary` ("Could not load records: <message>"), like the board and calendar, instead of as the empty-row text.
- Updated dependencies [7aedd18]
  - @yadad/runtime@0.8.0

## 0.7.0

### Minor Changes

- 088510c: Add `BoardRenderer` (RFC 0005) and render `board` views in the dashboard `view` widget. It takes the same props as `CalendarRenderer` plus `groupBy` and `onGroupByChange` for host-controlled grouping (uncontrolled by default), loads cards and reference columns through the runtime, moves cards optimistically with `baseVersion` and reverts with an error and a live-region message on 400, 403 or 409. A registry without `layout.Board` gets an error summary. `@yadad/testing` gains a plain mock board (no drag) and board contract checks.

### Patch Changes

- Updated dependencies [91a2d86]
- Updated dependencies [9ff56b5]
- Updated dependencies [b6a63f6]
- Updated dependencies [6a83b20]
- Updated dependencies [6a83b20]
  - @yadad/runtime@0.7.0
  - @yadad/core@0.10.0

## 0.6.2

### Patch Changes

- Updated dependencies [8ff4e7d]
  - @yadad/runtime@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [b7012ca]
  - @yadad/core@0.9.0
  - @yadad/runtime@0.6.1

## 0.6.0

### Minor Changes

- a3eb141: Add `CalendarRenderer` for `calendar` views, also used by the dashboard `view` widget. It loads the visible range through the runtime, builds entries with the fields' Display components and hands days, entries and callbacks to `layout.Calendar`. With `editable: true` a move is optimistic: only the date field is sent with `baseVersion`; on any failure the entry goes back, the adapter's message shows in an error summary, a live-region message is sent and the range reloads. A `rowAction` opens the target table in place, with Back. A registry without `layout.Calendar` gets an error summary instead of a crash.

## 0.5.3

### Patch Changes

- Updated dependencies [0f5e074]
  - @yadad/runtime@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies [524f917]
  - @yadad/core@0.8.0
  - @yadad/runtime@0.5.2

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
