# @yadad/runtime

## 0.13.1

### Patch Changes

- 0ff673e: `validateRecord` now enforces a text field's `maxLength` (RFC 0008 item 13c), counting code points, so record forms and action input (`validateActionInput`) refuse an over-long value before the round trip. The mock registry's text input carries `maxLength`. `recordJsonSchema` does not emit `maxLength` yet; docs/records-protocol.md lists it as a known difference.

## 0.13.0

### Minor Changes

- d4ce13b: The state grid covers saved filters and the doneField toggle. Runtime: tables with `filters` get a `filter` axis and `savedFilter` on the render, and a calendar or board with `doneField` gets the `permission` axis so a disabled toggle is rendered. Testing: new state checks `saved-filter`, `done-missing`, `done-offered`; the contract kit gains Calendar and Board checks that a done toggle renders a checkbox named "Done: <label>"; the mock registry draws that shape.

## 0.12.0

### Minor Changes

- ea7fd75: RFC 0008 renderer surfaces (card 47e).
  
  Registry contract (`@yadad/core/registry`):
  
  - `CalendarEntry.done` — the completion toggle a view's `doneField` asks for:
    `checked`, `disabled` (folding editability, `can.fields` and an in-flight
    toggle), and `toggle`. The renderer owns the write; the component owns the
    checkbox.
  - `CalendarDayProps.overflow` — `{ shown, hidden }` when a day exceeds
    `maxEntriesPerDay`. The renderer decides the cap; the component discloses
    the rest behind its own "+N more" affordance. No double-capping.
  - `BoardCardProps.done` — the card twin of `CalendarEntry.done`.
  - `BoardColumn.color` — the grouping option's `#RRGGBB` swatch hint beside
    the label (RFC 0008 item 5); an option without a colour keeps the label
    alone.
  - `BoardColumn.label` / select option labels — options may carry a `label`
    that defaults to the value; columns and displays show the label.
  - `ReferenceDisplayExtras.color` — the target's own colour when the reference
    field declares `colorFrom` (item 8). A hint beside the text, never the
    only signal.
  - `PagerProps` + `Registry.layout.Pager` — the table's paging control as a
    slot (item 6). The renderer owns the cursor/offset policy; the component
    owns Previous/Next chrome.
  - Pruned dead API: `BoardProps.onAdd` and `FieldFrameProps.heading` had no
    renderer implementation sites.
  
  Runtime:
  
  - `resolveReferenceColors` — resolves `colorFrom` for a set of ids the same
    shape as `resolveReferenceLabels` (parallel `findOne`, capped); keeps only
    colour-shaped values (text `#RRGGBB`, or the chosen select option's colour).
  - `boardColumns` carries each option's `label` (defaulting to the value) and
    `color` on the column definition; the board renderer passes both through.
  
  Renderer:
  
  - Calendar and board render a `doneField` toggle per entry/card: one field
    patched through the adapter's normal `update` (not `act`), optimistic
    settled against the saved record, announced, gated by `can.update` and
    `can.fields`.
  - Calendar entries cap at `maxEntriesPerDay` and hand the overflow to the
    day component.
  - Calendar entry and board card labels compose the detail fields as
    "Label: value", so the accessible name says what each detail is.
  - Table pages through the registry's `Pager` slot.
  - Table `addForm` (item 10, table side): an "Add {entity}" control under the
    top-level table opens the named form view inline; a save closes the panel
    and reloads the rows. A broken reference fails loudly in an ErrorSummary.
  
  Testing:
  
  - Mock registry gained `MockPager`, done-checkboxes, day overflow expansion,
    option labels/colours on selects, and entry/card colour attributes.
- 8d7ffdb: RFC 0008/0009 evaluation (card 47d). Runtime: `fieldEqFact` evaluates against the record
  (mirrors `viewerIn`'s unknown-fact rule); `tags` conditions — `contains`/`notContains` are
  element membership, `in`/`notIn` match any element; `time` comparisons ride the string
  ordering with a pin that lexicographic `HH:MM` is chronological; `can.fields` narrows
  `canUpdate` per field through `canEditField`/`canMoveColumn`, malformed entries drop the
  whole `can` like malformed `actions`. Board: `columnsFrom` is real — the default
  `"records"` derives columns from the loaded page via `boardRecordColumns` (no target
  fetch), `"options"` keeps the capped target load (RFC 0008 item 10, opt-in per the owner
  decision). Renderer: board/calendar drags and table inline edits honour `can.fields`; a
  tags quick filter chips with any-element semantics; `fields.tsx` gains the `time`/`tags`
  dispatch cases so the registry entries from card 47k actually render.
- f918c21: State grid and contract kit for the RFC 0008 / RFC 0009 additions (card 47h).
  
  State grid (`viewStates`, `@yadad/runtime`):
  
  - `time` fields: the grid carries the `23:59` boundary next to the empty and mid-day values.
  - `tags` fields: an empty-tags, a one-tag, a many-tags and a duplicates-tolerated state (the display must not deduplicate what the record holds).
  - `fieldEqFact` (RFC 0009 item 1): one viewer axis per fact a view compares a field against, and the compared field's axis is seeded with the fact's own values so the comparison gets a true state as well as a false one. A `repeat: "batch"` composer keeps only the viewer axis — its rows always start empty, so an injected-value comparison state could never render.
  - Board `columnsFrom: "options"`: an empty-column state — a grouping option no card references (RFC 0008 item 10).
  - `doneField` true/false pairs on calendar and board states (RFC 0008 item 12).
  
  Contract kit (`registryContractChecks`, `checkViewStates` in `@yadad/testing`):
  
  - `layout.Pager` assertions, optional like `layout.Calendar`: a registry without a Pager has no pager checks; one with a Pager must render a navigation region named by its label, disable the controls the position rules out, fire the others, and drop the total page count in cursor mode.
  - `can.fields` narrowing (RFC 0008 item 9): a table row offers Edit only when some editable column's field is open on that record (`canEditField`), and a calendar/board entry is movable only when the move field is open on it. Records without `can.fields` are untouched — fail-open, the server decides. New checks: `can-fields-offered`, `can-fields-missing`.
  
  The showcase's document set exercises the new keys at v8: tags/time/boolean task fields, a table with `addForm`, named `filters` (one `fieldEqFact` against a `me` fact) and a tags quick filter, a batch form with a sub-record checklist, `columnsFrom: "options"` plus `doneField` on the team board, and `doneField` + `maxEntriesPerDay` on the bookings calendar.

### Patch Changes

- afa08dd: RFC 0008 view/field contract keys (validator side; the renderer follows in its own card).
  
  - `StaticOptions.values` entries may now be `{ value, label?, color? }` as well as plain strings (item 5): `label` defaults to `value`, `color` is a `#RRGGBB` display hint. Stored records, filters and conditions keep using `value`. Helper `optionValue()` returns the stored value of either form.
  - `FormItem.label?` relabels a field in one form view (item 6).
  - `CalendarView.maxEntriesPerDay?` replaces the fixed "+N more" cutoff of 3 (item 7); default is still 3, so no document changes meaning.
  - `ReferenceField.colorFrom?` names a colour-shaped field on the target (item 8); the renderer consumes it later.
  - `TableView.addForm?` names a form view over the same entity the table offers as "Add" (item 4); the set validator checks existence, kind and entity.
  - `BoardView.columnsFrom?: "options" | "records"` opts a reference grouping into target-derived columns (item 10); default `"records"` is today's behaviour.
  
  No `specVersion` bump: every new key is optional and old documents validate and render exactly as before.
- e038f8b: RFC 0009 renderer surfaces (items 3, 4, 5) — the three build items, on the contracts 47c landed.
  
  - **Sub-record checklist** (`SubRecordChecklist`, exported): a form section that declares
    `subRecords` renders an inline checklist over the child entity — rows scoped by the `via`
    reference back at the form's entity, ordered by `orderField`, added by an input + Add
    button (Enter works; the new row lands focused in edit mode), titles click-to-edit, the
    `doneField` checkbox, Remove. Rows are ordinary records of the child entity: every write
    goes through the standard adapter verbs under `baseVersion`, and `can.update`/`can.fields`
    decide what is operable. A form for a record that does not exist yet says so instead of
    writing orphans; a misdeclared section states the problem in place.
  - **`repeat: "batch"` composer**: the create form becomes a queued composer — "+ another"
    adds an unsaved row, Remove drops one, the single Add flushes all rows through
    `submitBatchCreate` (runtime, new export): validate every row first, then ONE adapter
    `batch` call — all rows land or none do. Row errors stay on their row (scoped
    `/rows/<i>/…`); drafts never apply to a batch composer.
  - **Named saved filters as chips**: `TableRenderer` gains host-owned `savedFilter` /
    `onSavedFilterChange` props; the view's `filters` render as a chip row (registry Buttons,
    `aria-pressed`) beside the quick filters. The lit chip's condition is ANDed into the base
    filter before the quick filters combine — it rides the adapter query, never post-filtering.
    The renderer stores no chip state.
  - `ButtonProps.pressed` (core, additive): a toggle control's state, so a registry component
    can draw the pressed look and set `aria-pressed`. The mock registry draws it.
  
  Renderer is minor, not patch: `FormRendererProps` gains `parent`/`reloadKey` and
  `TableRendererProps` gains the saved-filter pair (both optional), and `ButtonProps`
  gained `pressed` — implementors of the registry contract see a widened component contract.
- Updated dependencies [d11aad3]
- Updated dependencies [ea7fd75]
- Updated dependencies [8d7ffdb]
- Updated dependencies [920dffa]
- Updated dependencies [5d25641]
- Updated dependencies [9574fa8]
- Updated dependencies [afa08dd]
- Updated dependencies [e038f8b]
  - @yadad/core@0.15.0

## 0.11.0

### Minor Changes

- 37ff50e: One `MovePlan` for every move: `moveDay` and `moveCard` return the same union (`none` / `blocked` / `update`, exported from `@yadad/runtime`). Board's `"rejected"` case is now `blocked` with `reason: "other"` — a breaking discriminant change for anyone switching on move plans, made deliberately so the two views' "we will not write" answers stay one design instead of two.

### Patch Changes

- 78b0d67: New export `defaultTitleField(entity)` in @yadad/core: the single owner of the "an omitted view titleField falls back to the entity's first text field" rule. The validator's calendar/board title checks and both runtime `titleFieldOf` helpers now call it instead of re-encoding the rule — the four copies could drift apart silently, validator against runtime. Behaviour unchanged.
- a13f16d: The state grid builds its table shapes through `runQuery` instead of a hand-rolled copy: `matching` now follows the view's `sort` (the copy ignored it), `next` is what the matched set actually has (one record no longer claims a second page), and a filter a real adapter would reject (viewerIn) skips the state with the adapter's message instead of silently matching nothing. `runQuery` gained an optional `now` so the grid keeps its frozen clock. Generated field names are unchanged; values are now the adapter's answer, pinned by new view-states tests.
- Updated dependencies [78b0d67]
- Updated dependencies [08db8af]
- Updated dependencies [43eab04]
  - @yadad/core@0.14.0

## 0.10.1

### Patch Changes

- 7345e6c: `restoreDraft` validates restored values against the current schema. A stale draft whose typed value no longer fits (text in a number field, a choice removed from a select) is kept AND reported in the new `invalidFields` — the renderer seeds it into `FormState.errors`, so the field frames invalid and the ErrorSummary names it — instead of restoring silently. Absent `required` values are not flagged at restore; the submit path already reports those. Fixes the fitnotes F10-era draft case: an old draft used to return with its broken value looking untouched.
- e2ae6de: Ship CHANGELOG.md in every published tarball. The `files` arrays shipped `dist` and `src` only, so a consumer upgrading from the registry could not read the upgrade notes — only `@yadad/components` shipped its changelog.
- Updated dependencies [e2ae6de]
  - @yadad/core@0.13.1

## 0.10.0

### Minor Changes

- 6a45b28: aggregateSeries(): the series widget's computation (RFC 0001 slice 2). Pages the entity like aggregate() — same 500-per-request walk, same 5000-record ceiling, same partial — and folds one slice-1 measure per group. Group values are exact (select, boolean, reference id, text) or date buckets (day, ISO-Monday week, YYYY-MM month); records without a group value are skipped and counted; a date series sorted by group has its empty buckets filled with 0 or no-value per op. Labels, formatting and charts stay out of the engine.
- d902a53: Series widgets get their own states. A `series` grid item on a dashboard adds a `widget:<itemId>` axis with `none`, `one`, `many` and a `partial` read (43a decision 7), and the state's `render.series` entry carries the records that make exactly that many groups — distinct `groupBy` values that still pass the view's filter and the entity's validation, dates spread over months when the widget buckets by month, the table padded past the aggregate cap for `partial`. A field that can show no group under the filter skips the widget with a reason instead of shipping an empty chart. The state adapter seeds those records over the collection widgets', so a series state's chart, computed through the adapter by `aggregateSeries`, shows the groups its axis picked.

### Patch Changes

- Updated dependencies [7a1e601]
  - @yadad/core@0.13.0

## 0.9.3

### Patch Changes

- 0c1d5ad: `submitEdit` no longer refuses an edit because the server served values the
  entity document does not declare. Served-but-undeclared keys are kept out of
  the merge that is validated and are never sent in the patch; a record the
  client builds is still checked strictly.
- 4a1c1bc: A refused save keeps the server's own words. When the records host
  answers 400 with the protocol's `errors[]`, every entry now becomes an
  error with its own `message`, `hint` and `path`: an entry at
  `/values/<field>` marks that field (it shows the message and gets
  `aria-invalid`), and an entry at `""` shows the server's hint at form
  level. Previously the form appended its generic "Reload and try again."
  after the server's precise message — advice that fixes nothing when the
  value itself is wrong — and a located field was never marked, because
  the protocol's pointer into the request body was not the path the form
  matches fields on. The generic line stays for failures with no protocol
  body (a network drop, a 5xx, an empty 400); conflict, not-found,
  unauthorized and forbidden keep their own mappings. `serverValidationIssues`
  is the shared mapping, used by both the form and the record-action
  failures.

## 0.9.2

### Patch Changes

- f8bad61: README documents the review-screen logic: running actions through the adapters (the `actions` handler option, `act`'s conflict semantics, cursor-paging option), the datetime functions and the one canonical instant, `availableActions` as the single answer for offer-or-withhold, and the word diff and compare helpers with the neighbour-window rule.
- Updated dependencies [cb8579e]
  - @yadad/core@0.12.1

## 0.9.1

### Patch Changes

- Updated dependencies [d67034d]
- Updated dependencies [48f10a8]
  - @yadad/core@0.12.0

## 0.9.0

### Minor Changes

- c11cfb5: `act` in the memory and key-value adapters (RFC 0007): the `AdapterOptions.actions` option carries host-supplied `ActionHandler`s keyed `<entity>.<action>`, and `act` checks, in protocol order, unknown action then unknown record (`RecordNotFoundError`), `baseVersion` (`RecordConflictError` with the current record), `can.actions[id] === false` and the `can.update` rules (`ForbiddenError`) — then runs the handler and applies its outcome: a values patch with a fresh version, or removal (returning `null`). A handler-thrown `RecordConflictError` passes through. Adapter conformance covers both paths plus the empty outcome and the permission-visible-to-the-handler case.
- 407bc6c: `act` over HTTP (RFC 0007): `POST {base}/{entity}/{id}/actions/{action}` with `{ input, entityRevision, baseVersion }`; `200` is the acted record, `204` (removed) is `null`, and `400` (paths `/input/<field>`), `401`, `403`, `404` and `409` map to the existing typed errors, the `409` carrying `current`. The HTTP adapter always offers `act` — unknown entity, record or action is the server's 404. `can.actions` is validated on read like the rest of `can`: an object of booleans passes, a malformed one is dropped as a whole (a hint, never an error).
- 317cde1: Add `availableActions`, `actionNeedsDialog` and `validateActionInput` (RFC 0007): the view's `recordActions` filtered by the action's `visibleWhen` for the record and viewer and by `record.can.actions`, in the view's order (unavailable actions are dropped, never disabled); the dialog rule (`confirm` or `input` opens one); and input checking that reuses `validateRecord` over the action's input fields with issue paths under `/input/`. Also the `ActionHandler`/`ActionOutcome` types the memory and key-value adapters consume.
- dbc6ded: Add `neighbourQuery` and `compareCells` (RFC 0007): the widened offset query that loads one row beyond the page edge for a `to` compare (`offset - 1` / `limit + 1`), and the per-row word diff of each cell against its neighbour row or another field of the same record. A row with no neighbour has no cell; an empty comparator counts as `""`, so everything is added. Cursor pages cannot be widened backwards — pass the previous page's last row as `edge` to `compareCells`.
- 0b2e595: Paging without a total (RFC 0007): the memory and key-value adapters take `paging: "cursor"` and answer like a counting-free server — no `total`, an opaque `next` (null on the last page) — while the default keeps offset paging with `total`. The HTTP adapter sends `cursor=` instead of `offset=` for a cursor page (never both) and passes `next` and an optional `total` through. A `count` whose server never counts walks the pages up to the 5,000-record ceiling and reports what it read, `partial` at the cap. The calendar and board loaders follow `next` up to their existing caps.
- 6babd0d: datetime helpers (RFC 0007): `formatDateTime`, `instantToLocal`, `localToInstant` and `instantRangeBounds`, pure Intl over the canonical instant form core checks with `isIsoDatetime`.
- bc971b7: Filter and sort the `datetime` field (RFC 0007): conditions compare canonical instants as strings (string order is time order), `null` is empty, and the in-process sort keeps empties last in both directions. The from/to quick-filter range uses 34a's `instantRangeBounds`, so a range typed as 10:00 to 10:30 includes 10:30:59.999. Adapter conformance now covers datetime order, empties-last both ways, and a range that includes the last millisecond.
- 7ca1105: `viewStates` gains the RFC 0007 axes. A table, board or calendar with `recordActions` gets one `action:<id>` axis per offered action (`available | withheld`); `withheld` sets `can: { actions: { <id>: false } }` on the first generated record, as the permission axis does with `update`, and combines with it. Tables get a `paging` axis (`total | cursor-more | cursor-end`): the render carries `total`, or an opaque `next` with more to come, or `next: null` for the last cursor page. Generated records carry a `datetime` value: a fixed instant 09:30 on `now`'s day in the new `options.timeZone` ("UTC" by default), so snapshots do not drift with the machine's zone. Old documents without actions gain no action axis.
- 878bfa3: Add `diffWords(before, after)` (RFC 0007): a word diff over runs of non-space characters and runs of whitespace, an LCS over the tokens with neighbours merged, deterministic on ties, and bounded — past 2,000 tokens on either side it returns one `removed` plus one `added` segment instead of computing.

## 0.8.3

### Patch Changes

- d13f4cb: Keep working with the RFC 0007 contract: `validateRecord` accepts a `datetime` value only in the canonical `YYYY-MM-DDTHH:MM:SS.sssZ` form, the HTTP adapter sends `cursor=` for a cursor query, and code that reads `Page.total` now copes with a page that has none (a count without a total reads zero until cursor paging lands). The state grid generates a `datetime` value.
- Updated dependencies [d13f4cb]
  - @yadad/core@0.11.0

## 0.8.2

### Patch Changes

- 869cd83: The README describes the current exports: boards, viewer facts and the state grid, with examples that type-check.
- Updated dependencies [869cd83]
  - @yadad/core@0.10.1

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
