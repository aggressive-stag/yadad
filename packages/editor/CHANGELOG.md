# @yadad/editor

## 0.17.1

### Patch Changes

- Updated dependencies [0b65de0]
  - @yadad/runtime@0.16.0

## 0.17.0

### Minor Changes

- 8bbb91d: The action editor has a "Name the record with" picker that writes `confirm.subjectField`, and the table editor offers reference columns as quick filters, with a record id typed as the default (a picker over live records is not offered in the editor).

### Patch Changes

- Updated dependencies [3856559]
- Updated dependencies [ff70dc0]
- Updated dependencies [4a7c283]
- Updated dependencies [8501d2a]
- Updated dependencies [9543bfd]
  - @yadad/core@0.17.0
  - @yadad/runtime@0.15.0

## 0.16.1

### Patch Changes

- Updated dependencies [43ddfc9]
- Updated dependencies [967c63a]
  - @yadad/runtime@0.14.1

## 0.16.0

### Minor Changes

- 435df4b: The editors write the RFC 0010 keys. A quick filter row takes a label, a placeholder (text filters only) and a first value of the kind the filter takes. The table editor has "Make column not sortable" per column and "Not sortable (every column)" for the table; a sort that names an unsortable column is refused. The field editor has a "Set by the server (read-only)" toggle. The condition builder offers "Hours from now" for datetime fields with the comparing operators, writing `{ "hoursFromNow": n }`.

### Patch Changes

- Updated dependencies [616b2fb]
- Updated dependencies [ba3a7bd]
- Updated dependencies [857c23d]
- Updated dependencies [dae59e6]
- Updated dependencies [56470ba]
- Updated dependencies [6a95a8d]
- Updated dependencies [547299f]
- Updated dependencies [24212d8]
- Updated dependencies [9c2ebdc]
- Updated dependencies [fad57e0]
- Updated dependencies [59601ab]
- Updated dependencies [1da41e8]
- Updated dependencies [0945183]
- Updated dependencies [939df3b]
- Updated dependencies [4bc846a]
  - @yadad/core@0.16.0
  - @yadad/runtime@0.14.0

## 0.15.2

### Patch Changes

- Updated dependencies [0ff673e]
  - @yadad/runtime@0.13.1

## 0.15.1

### Patch Changes

- Updated dependencies [d4ce13b]
  - @yadad/runtime@0.13.0

## 0.15.0

### Minor Changes

- 9574fa8: Author the RFC 0008 and RFC 0009 contract keys (card 47g).
  
  Editor: `doneField` and `maxEntriesPerDay` rows in the calendar editor; `doneField` and a
  `columnsFrom` switch in the board editor; an `addForm` picker and named-filter rows (`filters`)
  in the table editor; option label + colour rows in the field-options editor; per-item
  `FormItem.label`, `multiline`/`maxLength`, `colorFrom`, the sub-record section builder and the
  `repeat: "batch"` toggle in the form editor; and the `fieldEqFact` leaf (field + declared-fact
  pickers, no free text) in the condition builder.
  
  Core: `TextField.multiline` and `TextField.maxLength` (validated, ceiling
  `TEXT_MAX_LENGTH_CEILING`), the keys the text-field panel writes.

### Patch Changes

- 920dffa: Add the `time` and `tags` field types (RFC 0008 items 14 and 15).
  
  - `time` stores a time of day as `"HH:MM"` — 24-hour, zero-padded, no day and no zone. It compares with eq/neq/gt/gte/lt/lte/in/empty/notEmpty (never `contains`, never a relative date), takes optional `min`/`max` bounds and a `step` in whole minutes, and can be an action input. A `time` field is never a stand-in for `date`: it cannot place a calendar entry, and `due_date` plus `due_time` stay two fields.
  - `tags` stores an array of non-empty strings in the order entered — the only field type whose value is a list. `contains` and `in` match ANY element (wrap in `not` for the negation); it has no ordering, so gt/gte/lt/lte are refused. It cannot be a sort key or a board `groupBy` (a card carries many tags and a column needs one value per card), and it declares no properties beyond label and required — no options, static or from an entity.
  - `recordJsonSchema`: `time` is a string with the `HH:MM` pattern; `tags` is an array of string with `uniqueItems`. `validateRecord` is the step gate and leaves duplicates to the input, so the two deliberate divergences are pinned in the parity table.
  - Editor: both types appear in the new-field type menu with no property panel of their own, and the input/display dispatcher routes them through the registry. The mock registry drives them with a native time box and a comma-separated text box; the real widgets (including the tags chips input) ship with the components repo's card 23a. `tags` is not an action input until that chips widget exists.
- afa08dd: RFC 0008 view/field contract keys (validator side; the renderer follows in its own card).
  
  - `StaticOptions.values` entries may now be `{ value, label?, color? }` as well as plain strings (item 5): `label` defaults to `value`, `color` is a `#RRGGBB` display hint. Stored records, filters and conditions keep using `value`. Helper `optionValue()` returns the stored value of either form.
  - `FormItem.label?` relabels a field in one form view (item 6).
  - `CalendarView.maxEntriesPerDay?` replaces the fixed "+N more" cutoff of 3 (item 7); default is still 3, so no document changes meaning.
  - `ReferenceField.colorFrom?` names a colour-shaped field on the target (item 8); the renderer consumes it later.
  - `TableView.addForm?` names a form view over the same entity the table offers as "Add" (item 4); the set validator checks existence, kind and entity.
  - `BoardView.columnsFrom?: "options" | "records"` opts a reference grouping into target-derived columns (item 10); default `"records"` is today's behaviour.
  
  No `specVersion` bump: every new key is optional and old documents validate and render exactly as before.
- Updated dependencies [d11aad3]
- Updated dependencies [ea7fd75]
- Updated dependencies [8d7ffdb]
- Updated dependencies [920dffa]
- Updated dependencies [5d25641]
- Updated dependencies [9574fa8]
- Updated dependencies [f918c21]
- Updated dependencies [afa08dd]
- Updated dependencies [e038f8b]
  - @yadad/core@0.15.0
  - @yadad/runtime@0.12.0

## 0.14.3

### Patch Changes

- 5765929: The states preview runs the core set validators on the draft: a broken reference — a field a view still names after the entity dropped it, or any cross-document break `npm test` would catch — is named in the status line as soon as the draft changes, instead of surfacing only after the copy-and-test round trip. The host's `checkStates` hook still adds per-state host checks on top.

## 0.14.2

### Patch Changes

- 0832531: One `runEdit` owns what a rejected save does (card 45e): the four view editors (`board`, `calendar`, `form`, `table`) each carried the same nine-line `run` callback, and each `applyAndAnnounce` repeated its apply-and-report half. The rule and the apply step now live in `save-result.ts` — `runEdit`, `editRunner`, `applyEdit` — and the editors bind them. `viewer-panel`'s `run` sets the session only after its conflict check, so it stays its own function (renamed `runViewerEdit` to say so). No behaviour change is intended; if a rejected save announces itself differently anywhere, that is the bug.
- Updated dependencies [78b0d67]
- Updated dependencies [37ff50e]
- Updated dependencies [08db8af]
- Updated dependencies [a13f16d]
- Updated dependencies [43eab04]
  - @yadad/core@0.14.0
  - @yadad/runtime@0.11.0

## 0.14.1

### Patch Changes

- e2ae6de: Ship CHANGELOG.md in every published tarball. The `files` arrays shipped `dist` and `src` only, so a consumer upgrading from the registry could not read the upgrade notes — only `@yadad/components` shipped its changelog.
- Updated dependencies [7345e6c]
- Updated dependencies [e2ae6de]
  - @yadad/runtime@0.10.1
  - @yadad/core@0.13.1

## 0.14.0

### Minor Changes

- 247439a: The dashboard layout editor gained the series widget (RFC 0001 slice 2). The add-widget list offers "Series of <table>" beside the count and the stat, seeded with the first groupable field, the first number field's sum (or a count) and a bar display. The series panel picks the table view, the groupBy field, the bucket (shown only when the groupBy is a date), the display, the sort and the limit, and reuses the stat's measure picker untouched, so a series is edited exactly like a stat; its filter uses the same condition builder. Every choice list is the validator's own enum or its field-type rule, so no pick can leave an invalid widget behind. The patch functions (setSeriesView, setSeriesGroupBy, setSeriesBucket, setSeriesMeasure, setSeriesDisplay, setSeriesSort, setSeriesLimit) mirror the validator's checks one-for-one and refuse with its hints; pointing a series at another entity's table reseeds its groupBy and measure for that entity rather than dropping the required keys. Field-impact reports (the rename and delete refusals) now list a series' filter, groupBy field and measure fields.

### Patch Changes

- Updated dependencies [6a45b28]
- Updated dependencies [d902a53]
- Updated dependencies [7a1e601]
  - @yadad/runtime@0.10.0
  - @yadad/core@0.13.0

## 0.13.0

### Minor Changes

- 66b8cc9: EntityFieldsEditor's "Save fields" now sees a filled Add-field panel.
  Typing an id and label enabled nothing and pressing Save silently
  dropped the draft — the two-step commit (Add field, then Save fields)
  was invisible. A filled, valid draft enables Save fields and adds the
  field before saving; an invalid one keeps Save disabled and shows the
  validator's reason in the panel. Typing still never touches the edit
  session until a press.
- 4dcda96: EntityFieldsEditor and DashboardLayoutEditor take `onChange`, reporting
  the in-progress document after every edit, undo or redo — the same hook
  the view editors already had. A host's live preview and unsaved-JSON
  panel showed only the last saved revision for these two: Remove and
  Undo were invisible until Save. The README now says all editors take
  `onChange`, because all of them do.

### Patch Changes

- 428acbc: StatesPreview: the state-preview frame is now `pointer-events: none`. It
  is a scaled picture of the view, `aria-hidden` and `inert`, but it still
  caught pointer events — a dashboard editor whose preview overlapped the
  grid could not be dragged at all: clicks hit the frame, not the cards.
  Keyboard card move/resize stays pinned by a test the way a consumer's
  Tab-and-arrows session hits it.
- 61069f6: The README now carries the complete `renderState` a host writes for
  `StatesPreview`: the five-kinds switch, entity lookup, one fresh
  `createStateAdapter(state)` under every data-source key the set names
  (dashboards included), and the state seeds — `initialMode`,
  `initialGroupBy`, `initialTab` — with `key={state.id}` so they apply.
  It was discoverable only in the showcase's own states page, and the
  editor may not import the renderer to ship it. Two host facts join it:
  Save bumps `revision`, so keying the editor on the document remounts
  it and resets the undo stack, and `STATES_PREVIEW_DEFAULT_LIMIT` caps
  the preview at twelve states. The sample is compiled and run by a
  showcase test so it cannot drift from the renderers' props.
- 2887aca: FormViewEditor: Enter in a section's title input commits the rename, the
  same as the "Rename section" button. Typing a new title already enabled
  the button and dirtying the session, but Enter did nothing at all — a
  keyboard user pressing it to finish the edit left Save disabled and the
  section unchanged.

## 0.12.2

### Patch Changes

- Updated dependencies [0c1d5ad]
- Updated dependencies [4a1c1bc]
  - @yadad/runtime@0.9.3

## 0.12.1

### Patch Changes

- cc55b2e: README documents authoring the review screen: the entity editor's Actions section (confirm, input fields, visibleWhen, refusal while a view offers the action), the "Offer actions" panel on the table, calendar and board editors, compare on a text column, and the states preview naming the action and paging axes.
- Updated dependencies [cb8579e]
- Updated dependencies [f8bad61]
  - @yadad/core@0.12.1
  - @yadad/runtime@0.9.2

## 0.12.0

### Minor Changes

- 13ecfdf: Action panels on the entity editor now author the dialog: up to five input fields (all types but reference, reusing the field property machinery) and a `visibleWhen` condition built with the shared condition builder over record fields and viewer facts.
- 4ea9d59: datetime fields and compare columns are editable. The fields panel gives a datetime field its `min` and `max` as canonical instants (the native box types a local time, read as UTC; the stored form is accepted verbatim, and anything else the document validator refuses, naming the form). A datetime column can be a quick filter — a from/to range, like `date`. Each table column gains a Compare choice: the previous row, the next row, or another text field of the same entity; an editable column, a non-text column, a comparator that is not another text field, and a column comparing with itself are all refused against the live entity, each naming the real reason.
- 9febbd2: The entity editor gained an Actions section: add, rename, set the confirm (title, message, confirmLabel, tone), reorder, and remove an entity's record actions, each as an undoable JSON Patch. Removal is refused while a view still offers the action, naming the views. New helpers in `@yadad/editor`: `addAction`, `updateAction`, `moveAction`, `removeAction`, `actionReferences`.
- 2761512: Table, board and calendar editors gained an "Offer actions" panel: an ordered pick of the entity's actions (1 to 6, each once) that writes the view's `recordActions`, with move up/down, stop-offering and offer-nothing. An id the entity no longer declares is refused against the live entity, naming the real ones.
- b7b83d0: The states preview names the RFC 0007 axes the grid already varied: one line lists the offered record actions (`action:<id>`, available / withheld) and, for a table, the paging axis (total / cursor-more / cursor-end), the way the viewer-fact line names the facts a view reads.

## 0.11.4

### Patch Changes

- Updated dependencies [d67034d]
- Updated dependencies [48f10a8]
  - @yadad/core@0.12.0
  - @yadad/runtime@0.9.1

## 0.11.3

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

## 0.11.2

### Patch Changes

- d13f4cb: The editor knows the `datetime` field type (label, condition operators; a plain text box stands in for the input while a registry has no `fields.datetime`).
- Updated dependencies [d13f4cb]
- Updated dependencies [d13f4cb]
  - @yadad/core@0.11.0
  - @yadad/runtime@0.8.3

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
