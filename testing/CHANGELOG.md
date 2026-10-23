# @yadad/testing

## 0.10.0

### Minor Changes

- d902a53: Series widgets get their own states. A `series` grid item on a dashboard adds a `widget:<itemId>` axis with `none`, `one`, `many` and a `partial` read (43a decision 7), and the state's `render.series` entry carries the records that make exactly that many groups — distinct `groupBy` values that still pass the view's filter and the entity's validation, dates spread over months when the widget buckets by month, the table padded past the aggregate cap for `partial`. A field that can show no group under the filter skips the widget with a reason instead of shipping an empty chart. The state adapter seeds those records over the collection widgets', so a series state's chart, computed through the adapter by `aggregateSeries`, shows the groups its axis picked.
- 9cad9a4: Series widgets get a mock and a contract. `mockRegistry.widgets.series` draws a group as a plain table — one row per group with its label and formatted text, notes for skipped records and a partial read — so engine tests and the state sweep can check `widgets.series` without the components repo. The contract kit gained `seriesChecks`: a registry that ships `widgets.series` must name it by its label, carry every group's label and text in the accessible tree (a chart of bars alone is decoration, not data), show its `measureLabel`, and survive `groups: []` and a gap bucket with no value without throwing or unmounting itself. A registry without the key is skipped, as every optional key is.

### Patch Changes

- Updated dependencies [6a45b28]
- Updated dependencies [d902a53]
- Updated dependencies [7a1e601]
  - @yadad/runtime@0.10.0
  - @yadad/core@0.13.0

## 0.9.0

### Minor Changes

- 7cb8c4a: `checkViewStatesReport(options)` reports what the state grid actually
  covered: `{ results, states, strategy, complete, axes, skipped }`. A green
  `checkViewStates` on a view with thousands of combinations may prove only
  a pairwise cover — above `limit` the grid is not every combination, and
  the results used to read like it was. `checkViewStates` keeps its
  signature and returns the report's `results`; `states` sizes test
  timeouts honestly.
- 7778f4b: `checkViewStates` / `checkViewStatesReport` gain `expectAxes`. A table
  whose last editable column disappears in a refactor loses its
  `permission` axis — and every locked-record state with it — and stays
  green with fewer states. Name the axes a view must cover and each
  missing id now fails as an `axis-missing` problem on the first result.
  A consumer pins its critical axes and the grid can no longer shrink
  silently.
- c0b470a: `console.warn` is now collected beside `console.error`: a warning whose
  message starts with `yadad:` — the renderer's own signal for wiring
  mistakes, like a reference column whose target entity was never passed —
  becomes a `yadad-warning` problem instead of scrolling past a green run.
  Other code's warnings reach the console untouched. A consumer's state
  checks now catch a page wired that way.

### Patch Changes

- 8c3051d: Testing README: the `checkViewStates` example now carries a complete
  `render` case for every view kind — form drafts, the calendar's
  `initialMode`/`initialAnchor` with `key`, the board's `initialGroupBy`,
  the dashboard's `initialTab` — builds its set with `documentSet`, and
  validates the page's slice with `validateDocuments`. Plus a "what state
  checks don't check" list. A consumer used to find these recipes by
  failing; the sample is a test in the renderer package, so it cannot rot.

## 0.8.2

### Patch Changes

- dca431a: `checkViewStates` no longer hunts for a tab button that cannot exist:
  when the viewer sees exactly one tab the dashboard renders no strip, so
  the state opener returns instead of failing with `no tab named … to
  open`. The case it guards is a viewer whose only visible tab is not the
  document's first — no current fixture has that shape; the guard is
  defensive. Sweeps of one-tab dashboards stay green either way.
- Updated dependencies [0c1d5ad]
- Updated dependencies [4a1c1bc]
  - @yadad/runtime@0.9.3

## 0.8.1

### Patch Changes

- 27b07f1: README documents the RFC 0007 test surface: the `action-offered` / `action-missing` and `diff-offered` / `diff-missing` state checks, `checkViewStates`' `timeZone` for generated datetime values, `act` on the state adapter, and the contract kit's optional `layout.Dialog` and `fields.datetime` checks.
- Updated dependencies [cb8579e]
- Updated dependencies [f8bad61]
  - @yadad/core@0.12.1
  - @yadad/runtime@0.9.2

## 0.8.0

### Minor Changes

- f34f54e: `checkViewStates` takes a `timeZone`, passed through to `viewStates` so generated `datetime` values render in a chosen zone instead of only the default UTC.

## 0.7.0

### Minor Changes

- d67034d: The confirm and input dialog (RFC 0007): pressing an action with `confirm` or `input` opens `layout.Dialog` — the renderer builds the content (the message, the input fields as FieldFrame plus the type's Input, an ErrorSummary, Cancel and Confirm), the component only provides the modal behaviour. Confirm validates with `validateActionInput` before the server sees anything, then calls `act` with Confirm disabled and "Working..." announced. A 400 keeps the dialog open and puts each `/input/<id>` issue on its field; 403/409/404 close it, show the view's ErrorSummary and reload (nothing merged, nothing retried); any other failure keeps it open with the message so the viewer can retry. Cancel and Escape never call `act`, and the modal returns focus to the pressed button. The 35f restriction is gone: every offered action is now pressable. `ButtonProps` gains the optional `tone: "danger"` (the mock renders `data-tone`), so a `danger` confirm reaches the Button.
- 1bec34b: The contract kit now checks the RFC 0007 components: a datetime Display must show the given text on an element carrying the stored instant, a text Display must mark a diff's additions and removals with `ins` and `del`, a Table must draw each row's actions as buttons named by their labels, disabled while pending, under an `actionsLabel`, and the Dialog must be modal, named by its label, and take focus on open and return it on close. Checks are only registered for the keys a registry provides. `describeActionScenarios` drives the dialog flows through one line of host wiring — press an action, answer the confirm and the input, and make the source refuse with 403 or go stale with 409 — found by role and accessible name, with no renderer import in the kit.
- 4f24577: The mock registry gains the RFC 0007 keys: `fields.datetime` (`<input type="datetime-local">`, a `<time>` Display), `layout.Dialog` (modal, focus in and back to the opener, Escape closes), action buttons on table rows (an `actionsLabel` column when any row has `actions`), board cards and calendar entries, and `<ins>`/`<del>` with hidden "added:"/"removed:" text on the text Display when it gets a `diff`.
- 3b15482: Record actions on tables (RFC 0007): a view's `recordActions` now reach the table on their own — no host prop. `useRecordActions` builds each row's `RecordActionItem`s with `availableActions`, presses run `adapter.act` with the record's last-read version as the guard, the row's buttons go gray while its record is in flight, a success announces "<label> done" and reloads the page, and a 403/409/404 shows the view's ErrorSummary and reloads. A data source that cannot run actions (`act` absent) or an action that needs a dialog the registry does not provide replaces the view with an ErrorSummary (`/dataSource`, `/layout/Dialog`). Until the action dialog lands, an action with `confirm` or `input` is not offered — it must never run without its confirmation. Boards and calendars reuse the same hook in their next cards. `@yadad/testing`: the state adapter now answers `act` like the working source it pretends to be (guard order as the memory adapter; writes obey the refused/conflict matrix), so views with `recordActions` state-check like every other view.
- d0853c2: `checkViewStates` now checks record actions and compare cells in every view state. A table, calendar entry or board card that offers an action the state withholds (`can.actions`, `lockedTo`, `visibleWhen`) — or hides one the state allows — is reported against `availableActions`. A compare column whose Display was handed no `diff` despite a neighbour, or a `diff` compared against nothing, is reported against `compareCells`. The fixture sweep covers `fixtures/valid` and `fixtures/valid-sets`, including the review and action sets.

### Patch Changes

- 48f10a8: Datetime fields in the viewer's zone (RFC 0007): every renderer takes an optional `formatting?: { locale?, timeZone? }` and passes it down (dashboard pass it to each embedded view). A datetime Display gets `text` from `formatDateTime` plus the stored instant for a `<time dateTime>`; the Input shows the local wall time (`instantToLocal`) and stores the instant back (`localToInstant`, DST-safe: an ambiguous local time is the earlier instant). A registry without `fields.datetime` still shows an `ErrorSummary` naming the key. `@yadad/core` gains the optional `DatetimeDisplayExtras.text`; the mock Display renders `text ?? value`. The quick filter gains a from/to range for `datetime`: the control is a text box, the typed local times convert through `instantRangeBounds` (the `to` end covers its whole minute), read in the viewer's zone.
- Updated dependencies [d67034d]
- Updated dependencies [48f10a8]
  - @yadad/core@0.12.0
  - @yadad/runtime@0.9.1

## 0.6.6

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

## 0.6.5

### Patch Changes

- d13f4cb: The mock registry gains a `datetime` field, so documents with datetime fields render in tests. The contract kit leaves the optional `fields.datetime` entry unchecked for now.
- Updated dependencies [d13f4cb]
- Updated dependencies [d13f4cb]
  - @yadad/core@0.11.0
  - @yadad/runtime@0.8.3

## 0.6.4

### Patch Changes

- 153018d: The contract kit's board checks now find the board and its columns by role and accessible name, as RFC 0005 describes them (a group named by the board label; each column a group or region named "<label>, <count> cards"; cards as list items inside their column), instead of looking for `data-testid="board"` and `data-testid^="column-"`. A component set no longer needs those test ids to pass.

## 0.6.3

### Patch Changes

- 869cd83: The README describes the current exports: boards, viewer facts and the state grid, with examples that type-check.
- Updated dependencies [869cd83]
- Updated dependencies [869cd83]
  - @yadad/core@0.10.1
  - @yadad/runtime@0.8.2

## 0.6.2

### Patch Changes

- b69d9e0: `checkViewStates` reports `mode-ignored` and `anchor-ignored` when a calendar state is in one mode or on one range but the rendered calendar shows another.
- 347d075: `checkViewStates` reports `group-by-ignored` when a board state is grouped by one field but the rendered board uses another.

## 0.6.1

### Patch Changes

- Updated dependencies [3d50d86]
  - @yadad/runtime@0.8.1

## 0.6.0

### Minor Changes

- a788d3d: `checkViewStates` checks the viewer axes of RFC 0006. It passes the state's viewer to form rules, and adds three checks found by wrapping the registry: `viewer-visibility` (tabs and table columns shown or missing against what the state's viewer may see), `editable-offered` (an inline edit, `onMove`, `movable: true` or an open handler offered where the viewer condition is false or the record is locked) and `editable-missing` (the reverse). A dashboard state on a tab the viewer may not see no longer fails with "no tab to open". The mock registry and contract kit are unchanged: components are not told about the viewer.

## 0.5.0

### Minor Changes

- 668fee0: Add `checkViewStates` and `problems`, exported from `@yadad/testing/state-checks`. They render every data and source state of a view with a `render` function the host passes in, and report states that throw, log a console error, show or lack a field against its `visibleWhen`, disagree with `requiredWhen` on the required marker, have an interactive element without an accessible name, or fail to load without a visible message.

### Patch Changes

- Updated dependencies [7aedd18]
  - @yadad/runtime@0.8.0

## 0.4.0

### Minor Changes

- 088510c: Add `BoardRenderer` (RFC 0005) and render `board` views in the dashboard `view` widget. It takes the same props as `CalendarRenderer` plus `groupBy` and `onGroupByChange` for host-controlled grouping (uncontrolled by default), loads cards and reference columns through the runtime, moves cards optimistically with `baseVersion` and reverts with an error and a live-region message on 400, 403 or 409. A registry without `layout.Board` gets an error summary. `@yadad/testing` gains a plain mock board (no drag) and board contract checks.
- 4017e95: Add `createStateAdapter(seed, options)`: a `DataAdapter` seeded with a view state's records (or a record list) that can load forever, fail every read with a message, refuse writes with a 400 (field error) or 403, or conflict on writes with a 409, and be switched while a test runs. Add `sourceStates(viewStates(...), documents)`, which adds a `source` axis (`ready`, `loading`, `error`, `refused`, `conflict`; only the ones that make sense for the view) to the data states from `@yadad/runtime`. `@yadad/testing` now depends on `@yadad/runtime`.

### Patch Changes

- ef2cfdb: The mock registry's board puts focus back on a moved card's "Move to…" action after the card is rebuilt in its new column, or put back by a refused move, so keyboard focus is no longer lost to the page.
- Updated dependencies [91a2d86]
- Updated dependencies [9ff56b5]
- Updated dependencies [b6a63f6]
- Updated dependencies [6a83b20]
- Updated dependencies [6a83b20]
  - @yadad/runtime@0.7.0
  - @yadad/core@0.10.0

## 0.3.1

### Patch Changes

- Updated dependencies [b7012ca]
  - @yadad/core@0.9.0

## 0.3.0

### Minor Changes

- ff5da2e: The mock registry now has a `layout.Calendar`: a plain, semantic month or week grid (day cells named by their full date, entries as buttons, a "Move to day…" control per movable entry, a polite live region), with no drag. The contract kit gains `layout.Calendar` checks (grid and day names, week, navigation and mode switcher, entries and `onOpenEntry`, "Move to day…" and `onMove`, live region and `aria-busy`, axe). The checks run only when the registry has a calendar, because the key is optional.

## 0.2.2

### Patch Changes

- Updated dependencies [524f917]
  - @yadad/core@0.8.0

## 0.2.1

### Patch Changes

- Updated dependencies [0d0c2d0]
  - @yadad/core@0.7.0

## 0.2.0

### Minor Changes

- 6ec0fed: The mock registry and the contract kit cover the `reference` field. `FieldSample` gains `inputExtras`, `displayExtras` and an optional `shown` text; custom samples must provide the first two.
- 624dcb6: The mock count widget shows the optional `text` prop, and the contract kit checks that a count component does.

### Patch Changes

- Updated dependencies [6ec0fed]
- Updated dependencies [7b3c167]
- Updated dependencies [696677d]
- Updated dependencies [de5d2d3]
  - @yadad/core@0.6.0

## 0.1.5

### Patch Changes

- Updated dependencies [e21c2e7]
  - @yadad/core@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies [3b26d75]
  - @yadad/core@0.4.0

## 0.1.3

### Patch Changes

- 12bb9fa: Each package now ships a short README describing what it is and linking to the repo README and ARCHITECTURE.md, so the published packages say what they are without opening the repo.
- Updated dependencies [12bb9fa]
  - @yadad/core@0.3.1

## 0.1.2

### Patch Changes

- Updated dependencies [4bb09dc]
  - @yadad/core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [01ed46c]
- Updated dependencies [7ed972d]
  - @yadad/core@0.2.0

## 0.1.0

### Minor Changes

- 2535b59: Add number, boolean, select and date fields across the engine: document validation, record validation, rendering, mock components and the contract kit. Inputs get `describedBy` and FieldFrame an `errorId` so errors are linked to their input.
- 4e14c41: Add the contract test kit: `describeRegistryContract()` and `registryContractChecks()` check a registry's text field and FieldFrame (labelling, value round-trip, JSON type on change, clearing, aria-invalid, errors, Display, axe).
- 804f491: Add dashboards: a `dashboard` view kind with tabs and a grid of view and count widgets; `DashboardRenderer` and `DocumentSet`; `Tabs`, `Panel` and the `count` widget in the registry, mock registry and contract kit.
- dc3605f: Add `ErrorSummary` to the registry layout; the renderer uses it for setup and save errors.
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
