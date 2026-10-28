# @yadad/renderer

## 0.18.7

### Patch Changes

- dd0b18f: A plain action button pressed on a record that the action moves (to another board column, calendar day or table position) now returns focus to the same record's control in its new place, the same way a press from a panel does. Focus still never lands on a neighbour that took the old place, and a record that left the view leaves focus alone. Table rows that offer actions carry an empty hidden marker in their first cell so the row can be found again.

## 0.18.6

### Patch Changes

- 71e230e: Fix the focus return after a record action or a move when the host's adapter is slow or changes the record's id. The return now stays armed until the action's reload has landed (no fixed clock), so a table row's confirm dialog keeps focus on the row's control after a slow reload. An action that moves its record to another place in the order (a snooze that re-sorts a board) puts focus back on the record's trigger. A calendar move or a save whose answer carries a new record id (a derived record whose id holds the moved value) now follows that id: focus lands on the entry under the id the adapter answered with, never on a neighbour.

## 0.18.5

### Patch Changes

- 395f280: Focus now returns to the record's trigger after a confirm or input dialog action run from a panel (it ended on the page body before), and the focus return finds the record in its own view when another view on the page shows the same record (a calendar move ended on the body when a board above it showed the same booking). Each record title carries `data-yadad-record-view`, one value per view. Cancelling or closing the dialog is unchanged.

## 0.18.4

### Patch Changes

- 19517f0: Focus now stays with the record after an action or move run from a panel that closes with the press (a card's "Actions…" menu, a "Move to…" or "Move to day…" panel). The reload used to leave focus on the page body. A component can mark the control that opens the panel, and the panel itself, with a shared `data-yadad-focus-return` value so focus returns to that trigger; without it focus goes to the record's first focusable control. A move the viewer made follows the record to its new column or day. Board cards and calendar entry titles carry `data-yadad-record`. Additive, no document change.

## 0.18.3

### Patch Changes

- 09966dd: Keep focus on a record's action button when a second reload rebuilds it. After a press the focus return used to end as soon as one restore survived a render; a reload that landed later (a sibling widget refreshing after `onChanged`, or a second fetch of the same view) swapped the control again and dropped focus to the page. The restore now stays armed for a short window, follows the control it last focused, and ends at once when the viewer presses a key or the pointer, or moves focus elsewhere.

## 0.18.2

### Patch Changes

- 4900137: Keyboard focus stays on a record's Done checkbox after it is ticked on a calendar or a board. The checkbox is disabled while the change saves, which made the browser drop focus to the page; focus now returns to the same record's checkbox once the save settles (also after a refused save), reusing the focus return that record actions have. When the record is no longer shown, focus is left alone.

## 0.18.1

### Patch Changes

- 38a8b74: The board's hidden empty no-value column stays reachable. The renderer now passes it as the new optional `BoardProps.hiddenColumns` (editable boards with a non-required grouping field only). A component that honours it lists it in "Move to…" and shows it as a drop target while a card is dragged; one that ignores it behaves as before. `@yadad/testing`'s mock board lists it in "Move to…".
- Updated dependencies [38a8b74]
  - @yadad/core@0.17.1
  - @yadad/runtime@0.18.1

## 0.18.0

### Minor Changes

- 53eddc2: Boards put the "no value" column last and hide it while it has no cards (`boardColumns` and `boardRecordColumns` return it last; the new `shownBoardColumns` drops it when empty). It was first, even when empty. The calendar scrolls today's cell into view once when it first loads. A direct press on a record action no longer loses its focus return when an unrelated render commits before the action's pending state does. The packages' READMEs now say a built yadad app makes no requests to yadad infrastructure.

### Patch Changes

- Updated dependencies [53eddc2]
  - @yadad/runtime@0.18.0

## 0.17.2

### Patch Changes

- Updated dependencies [5bfb5a5]
  - @yadad/runtime@0.17.0

## 0.17.1

### Patch Changes

- 3d40b9a: A board grouped by a reference field no longer stays `aria-busy` forever. It is busy only while a target fetch it started is in flight; the default records grouping and an unwired target (which still warns) are not busy.
- 4cd4a49: Data fetches and the drill-level cache now depend on the content of `entity`, `view`, `dashboard`, `documents`, `entities`, `viewer`, `drill`, `drills` and `dataSources`, not their object identity. A host that rebuilds its documents on every render no longer refetches rows. Data adapters are still compared by identity.
- Updated dependencies [0b65de0]
  - @yadad/runtime@0.16.0

## 0.17.0

### Minor Changes

- 6c9d461: `DashboardRenderer` takes a controlled-optional `tab` and `onTabChange(tab)`, shaped like `drills` / `onDrillChange`, so the selected tab can live in a URL. Unset, it behaves as before. A supplied tab the viewer cannot see falls back to the first visible tab and is reported through `onTabChange`.
- af14589: A record action's confirm dialog shows its `subjectField` as a `<p data-yadad-confirm-subject>` under the message, drawn the way a table cell draws that field. A `reference` quick filter renders as a picker over the target entity's records (cut at 200 with a note) and filters on the chosen id.

### Patch Changes

- 2292782: A record action dialog wraps each input in `data-yadad-action-input="<field id>"`, and the README documents how to tell two renders of one view apart.
- df5dc55: A controlled `drill` keeps the loaded rows of every level whose step did not change. Opening hop 2 no longer refetches hop 1, and Back to hop 1 does not refetch it.
- 108094a: After a record action, focus returns to a rebuilt control only when its record kept its place in the view (its column, day or position). A record that moved no longer sends focus to the neighbour that took its old spot.
- 9543bfd: A direct action press returns focus to the record's button even when the view rebuilt the whole card while it reloaded (a board clears its cards during a reload). The new node is found by its place under the nearest surviving ancestor, only while its record is still shown.
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

- 857c23d: `FormRenderer` takes `initialRows` (default 1, clamped to 1..50, the new `BATCH_ROW_CAP`) so a batch composer can start with several rows; "+ another" now stops at the cap. The runtime's state grid gives a batch form a `rows` axis (one row, three rows queued) and the form render carries `rows`; pass it to `initialRows`.
- 38eff32: A text quick filter on a `TableRenderer` now waits 300 ms after the last keystroke before it reloads the table, instead of sending a request per character. The box still shows what is typed at once, and clearing it commits immediately. A tags quick filter is unchanged: a typed-but-unadded draft still waits for Enter, because the tags input slot has no blur or draft callback yet.
- 2f807c2: `TableRenderer` takes an optional `drill` and `onDrillChange`, and `DashboardRenderer` takes `drills` (keyed by grid item id) and `onDrillChange(itemId, drill)`, so a drill-down can live in a URL. Unset, the renderer keeps its private stack as before. A supplied drill is re-validated level by level and a stale one is cut back to its valid prefix with a polite notice. A controlled Back returns focus to the row it came from. `DrillStep` is exported.
- 9c2ebdc: `TableRenderer` renders what specVersion 9 declared. A quick filter opens on its `default` (seeded by the runtime's `initialQuickFilters`, never persisted), is labelled `filter.label ?? field.label`, and a text filter passes its `placeholder` to the text input slot; `@yadad/core` adds the optional `placeholder` to the text `Input` props (`TextInputExtras`). A header is plain text, and clicking does nothing, when the view or the column sets `sortable: false`. A `readOnly` field is never an inline input, even on a column marked `editable`.
- fad57e0: The table shows a list page's `notice` in a polite status region above the rows (inside a `layout.Section`, as `<p role="status" data-yadad-page-notice data-tone>`), replaced on every load. The `datetime` input slot gets optional `minLocal` / `maxLocal` (`YYYY-MM-DDTHH:mm`, the field's `min` / `max` in the viewer's zone) beside the stored instants; core's `FieldInputExtras.datetime` is now `DatetimeInputExtras`. The calendar legend already receives each entry's `color`.

### Patch Changes

- dae59e6: A row action binding may name the reserved field `id` (RFC 0008 item 1), which the validator used to reject. It binds the record's own id to a `text` field, or to a `reference` to the same entity, and is used only when the entity declares no field named `id` (a declared field wins). `@yadad/runtime` adds `bindingValues(record, entity)`, the values a row action's bindings read; the table, calendar and board renderers use it.
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

## 0.15.1

### Patch Changes

- Updated dependencies [0ff673e]
  - @yadad/runtime@0.13.1

## 0.15.0

### Minor Changes

- f7b93f1: Quick-filter controls are wrapped in `data-yadad-filter-field="<field id>"`, and the batch composer's `data-yadad-batch-controls`, `-count` and `-status` attributes now carry the form view id as their value, so drivers can scope two instances of the same view.

### Patch Changes

- Updated dependencies [d4ce13b]
  - @yadad/runtime@0.13.0

## 0.14.0

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

### Patch Changes

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

## 0.13.2

### Patch Changes

- 2cef0fe: Return focus to the row's live control after a direct action press. The focus return added for todo-app F9:227 held the pressed button and focused it once the flight ended, but a completing row's action set changes on the reload that follows (Complete unmounts, Reopen mounts — measured in Chromium: the pressed node is removed ~90ms into the press while the row survives), so the held node was gone and the restore silently no-op'd with focus on body. The press now also holds the button's parent (the action cell, which survives the swap) and the effect retries across renders until a restore survives a commit: focus goes back to the pressed button when it lives, or the parent subtree's first live button when it was replaced. A removed record still leaves focus where it is, and a focus the viewer moved elsewhere is never stolen.

## 0.13.1

### Patch Changes

- b876e67: A record action returns focus to its row after the reload: the pressed control is remembered, and when the flight ends with focus on nothing (the browser drops it when `pending` disables the button), focus goes back to the pressed button — never over a dialog or a viewer who moved on, and nowhere when the record was removed.

## 0.13.0

### Minor Changes

- 37ff50e: A failed read tells the same story in every view: table, calendar, board and both dashboard widgets now render `Could not load records: {detail}` with the one hint "Retry, or reload the page." through the shared `loadFailure` (previously three hints across five sites).

### Patch Changes

- 08db8af: `SeriesWidgetProps.aggregation` — the chart stops reading English (card 45g). The series widget told its component what the number was only as prose (`measureLabel: "Minimum weight"`), and `/git/yadad-components`' `measureFitsData()` sniffed the label's first word to decide whether the axis may start above the data — so a copy edit or a translation silently changed chart behaviour. The engine already knows (`measure.op`); the renderer now passes it as `aggregation: Measure["op"]` alongside the unchanged `measureLabel`. **Breaking for hand-implementers:** components that build `SeriesWidgetProps` by hand must add the required `aggregation` field; components that only receive it are unaffected. Consumer sets should switch `measureFitsData` to read `aggregation` (yadad-components card 19).
- Updated dependencies [78b0d67]
- Updated dependencies [37ff50e]
- Updated dependencies [08db8af]
- Updated dependencies [a13f16d]
- Updated dependencies [43eab04]
  - @yadad/core@0.14.0
  - @yadad/runtime@0.11.0

## 0.12.1

### Patch Changes

- 7345e6c: `restoreDraft` validates restored values against the current schema. A stale draft whose typed value no longer fits (text in a number field, a choice removed from a select) is kept AND reported in the new `invalidFields` — the renderer seeds it into `FormState.errors`, so the field frames invalid and the ErrorSummary names it — instead of restoring silently. Absent `required` values are not flagged at restore; the submit path already reports those. Fixes the fitnotes F10-era draft case: an old draft used to return with its broken value looking untouched.
- 2c5eda1: Drill-down row-action label joins with " — " instead of " for ". A target view titled "Sets for session" used to render "Open Sets for session for 3 (…)" — the connector stuttered against the title's own preposition. An em dash cannot collide with free-text titles.
- e2ae6de: Ship CHANGELOG.md in every published tarball. The `files` arrays shipped `dist` and `src` only, so a consumer upgrading from the registry could not read the upgrade notes — only `@yadad/components` shipped its changelog.
- Updated dependencies [7345e6c]
- Updated dependencies [e2ae6de]
  - @yadad/runtime@0.10.1
  - @yadad/core@0.13.1

## 0.12.0

### Minor Changes

- c76f953: Dashboards draw series widgets. A `series` grid item on a table view now loads through `aggregateSeries` and hands the registry's `widgets.series` ready-to-draw props: group labels per field type (select/text raw, boolean Yes/No, dates formatted with the viewer's locale — day, "Week of …", "October 2026" — references through the references hook, with the 39b unwired-target warning), the measure's words (`measureLabel`), and `skipped`/`partial` pass-through. No `widgets.series` in the registry names the missing key like a missing `layout.Calendar` does; a failed read shows the same load error the stat widget shows. `checkDashboard` reports a series pointed at a calendar/board view, a missing `groupBy` field, and a bad measure field.

### Patch Changes

- Updated dependencies [6a45b28]
- Updated dependencies [d902a53]
- Updated dependencies [7a1e601]
  - @yadad/runtime@0.10.0
  - @yadad/core@0.13.0

## 0.11.0

### Minor Changes

- dbe7ac0: `DocumentSet` — the type of `DashboardRenderer`'s `documents` prop and the
  row-action sets — is exported from the package root, and `documentSet(...)`
  builds one from a flat pile of core `Document`s: entities and views sorted
  into their maps, the last viewer document picked up. A consumer that loads
  documents as a list no longer redeclares the shape by hand to pass a prop
  it cannot import.
- 274c5ff: Open a board or a dashboard on a chosen view without taking control of
  it. `BoardRenderer` takes `initialGroupBy`: the grouping the board opens
  on, read only on the first render, so a state grid can open a board in
  another grouping and the viewer can still use the switcher — the
  controlled `groupBy` prop froze it. `DashboardRenderer` takes
  `initialTab` for the same reason (a states preview opens a dashboard on
  a second tab). An unknown id is never an empty render: an unknown
  grouping falls back to the board's default, and a tab that names no tab
  — or a tab this viewer may not see — falls back to the first visible
  one. After the first render the viewer's own choice always wins.
- dca431a: A dashboard with one visible tab renders no tab strip. A strip holding
  a single tab repeats the page title (a consumer's "Home" appeared
  twice) and pushes the content down on a phone. When the viewer sees
  exactly one tab, the grid renders directly inside a region named by the
  dashboard's title — its id when untitled — so the page keeps a named
  landmark; two or more visible tabs render `layout.Tabs` as before. The
  rule follows the tabs the **viewer** may see, not the document's: a
  two-tab dashboard whose second tab is viewer-hidden now drops the strip
  for that viewer too.
- e9ebdb1: Table in-place edits draft. Pass `drafts={{ store }}` to `TableRenderer` —
  opt-in, same `DraftStore`, same debounced write-back, same notice and
  Discard as the form — and unsaved input in an open row edit is kept under
  `yadad:draft:<viewId>:<recordId>` and comes back when that row's edit is
  reopened: after a refresh, after the row scrolls out of the page and
  back, after navigating away. Saving or Cancel clears the draft; a refused
  save (validation, conflict) keeps it; Discard starts from the saved
  record again. A row's draft belongs to that record, so two rows being
  edited never share text. `DashboardRenderer` hands `drafts` to embedded
  tables as it already does to embedded forms.
- 11909b4: Widgets refresh their neighbours after a write. `TableRenderer`,
  `BoardRenderer` and `CalendarRenderer` take an optional `onChanged`,
  called once after each successful user-initiated write made inside them:
  an in-place edit, a move, a record action. A dashboard passes it to every
  view widget, so a write in one cell reloads the others — the count and
  stat widgets beside a table, board or calendar now update immediately
  instead of holding the old number until the page reloads. (A form widget
  already did this through `onSaved`; the other writers were left behind.)
  A load or a reload never calls `onChanged`, so wiring the dashboards
  reload bump through it cannot loop.

### Patch Changes

- 552a446: A move or update whose saved record comes back under a **new** id now
  shows exactly one copy. The renderers matched the response on
  `saved.id`, so a records host whose ids encode the moved value
  (occurrence ids like `3:2026-10-19` -> `3:2026-10-24`) matched nothing:
  the old copy stayed under its old day or column, the new one was never
  added, and the cleared pending flag left nothing on screen saying the
  move happened. The record the renderer sent is replaced by the saved
  one, and a saved id that collides with another loaded record drops the
  duplicate.
- f8df983: `useReferences` logs a one-time `yadad:` console warning when a reference
  field's target entity was not passed in the renderer's `entities` prop. A
  page that forgot the target showed a column of raw ids with no console
  signal, no network call and nothing for a test to catch; the raw-id label
  is unchanged, so there is no contract change.
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
- Updated dependencies [0c1d5ad]
- Updated dependencies [4a1c1bc]
  - @yadad/runtime@0.9.3

## 0.10.1

### Patch Changes

- b56f232: README documents the review screen: per-row record actions offered only where `availableActions` allows and drawn through `layout.Dialog`, compare columns handing the text Display a `diff`, datetime cells formatted for the viewer's zone, and cursor paging (Previous/Next over a visited-cursor stack) when a page carries no total.
- Updated dependencies [cb8579e]
- Updated dependencies [f8bad61]
  - @yadad/core@0.12.1
  - @yadad/runtime@0.9.2

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
