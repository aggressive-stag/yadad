# @yadad/testing

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
