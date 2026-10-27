# @yadad/core

## 0.17.0

### Minor Changes

- 3856559: `ActionConfirm` gains an optional `subjectField`: a field id of the action's entity. The dialog shows that field's display value as a subject line under the message, so a confirmation can name its record without a template. Any field type is allowed, including read-only ones; an unknown field is an `unknown-reference` error.
- ff70dc0: A `reference` field may be a quick filter (RFC 0011 item 3). The control is a picker over the target entity's records, the filter matches the stored id with `eq`, and its `default` is a record id (a non-empty string). `placeholder` stays text-only, and a reference field is still refused as a sort key. Use it for a server-backed choice list that is already an entity, instead of a `select` filled at build time.
- 4a7c283: `specVersion` is now 10. Documents stamped 0 to 9 still validate, and `migrate()` restamps them to 10 with an identity step (the shape of 8 to 9); nothing in a document has to change. The version carries the accepted items of RFC 0011 that later releases add as optional keys. `describeContract` now says what one dashboard grid row (`h`) means on screen: a fixed `--yadad-grid-row-height` (4rem by default), plus the grid gap between rows, and rows size to their content once the grid stacks.

## 0.16.0

### Minor Changes

- 616b2fb: `@yadad/core` exports `COLOR_PALETTE`, the components set's eight option colours as an ordered readonly array of `{ hex, name }` (the colour slot is the index), and `isPaletteColor(hex)`. An option colour (a select field's or a viewer select fact's `color`) outside the palette is now a validation warning that names the eight allowed values, because it paints nothing; it becomes an error in a later specVersion. The calendar's `legend` slot entries gain `color?`, the same `#RRGGBB` the entries of that slot receive. An editable board whose `groupBy` field, or an editable calendar whose `dateField`, is `readOnly` is a validation error, because a move writes that field. `describeContract()` no longer calls select `values` "unique texts"; it describes `{ value, label?, color? }` entries and the palette.
- ba3a7bd: An entity field may declare `"readOnly": true` (only `true` is accepted): the server sets it, such as an id or a created-at. A read-only field is valid in table columns, conditions and bindings, and may also be `required` (stored records carry it), but a form item, an editable column or an inline edit that names it is a validation error saying the field is read-only. `recordJsonSchema(entity, { mode: "write" })` returns the create/update body shape, which leaves read-only fields out of `properties` and `required` so a write that sends one is rejected; the default stored shape is unchanged apart from a `readOnly: true` annotation on those properties. `describeContract()` documents the flag. The runtime does not skip it on create and update yet.
- 56470ba: A list `Page` may carry an optional `notice: { tone: "info" | "warning"; text: string }`, the server's statement about one answer (for example "served without vector search"). It is protocol data, so documents and `specVersion` are unchanged. `docs/records-protocol.md` documents the `notice` key on a list response. The HTTP adapter passes a well-formed `notice` through and drops a malformed one with a console warning.
- 6a95a8d: A table quick filter takes three optional keys: `default`, the filter's initial state (a string for select, text and time fields, a boolean, a string array for tags, or `{ from?, to? }` for number, date and datetime fields); `label`, the control's own label; and `placeholder`, for text filters only. A select default must be one of the options, and range bounds are checked like the same value in a condition. Existing documents are unchanged.
- 24212d8: Add the relative instant `{ "hoursFromNow": N }` (a whole number, negative is the past) as the value of eq, neq, gt, gte, lt and lte on a `datetime` field, for windows such as "the last 24 hours". It is refused on other field types, in `in` and `contains`, and `{ "daysFromToday" }` stays refused on `datetime`. `resolveRelativeDates()` and `evaluateCondition()` resolve it against `now` to the stored `...Z` instant, so adapters and servers receive a concrete instant. `describeContract()` gains `conditions.relativeInstant`. New runtime exports: `instantFromNow()` and `resolveComparisonValue()`.
- 9c2ebdc: `TableRenderer` renders what specVersion 9 declared. A quick filter opens on its `default` (seeded by the runtime's `initialQuickFilters`, never persisted), is labelled `filter.label ?? field.label`, and a text filter passes its `placeholder` to the text input slot; `@yadad/core` adds the optional `placeholder` to the text `Input` props (`TextInputExtras`). A header is plain text, and clicking does nothing, when the view or the column sets `sortable: false`. A `readOnly` field is never an inline input, even on a column marked `editable`.
- 0945183: `specVersion` is now 9. Version 9 is the carrier for the accepted items of RFC 0010; `migrate()` upgrades version-8 documents with an identity step that only changes the stamp, so every existing document stays valid. New documents should say `specVersion: 9`.
- 939df3b: A table view and a table column may declare `"sortable": false` (only `false` is accepted; `true` is an `invalid-value` error, since sorting is the default). The view flag turns sorting off for every column, for a list the server serves in one order; the column flag opts one column out. A declared `sort` that names an unsortable column, or any field on an unsortable view, is a validation error that names the column. `describeContract()` documents both flags. The renderer does not use them yet.

### Patch Changes

- dae59e6: A row action binding may name the reserved field `id` (RFC 0008 item 1), which the validator used to reject. It binds the record's own id to a `text` field, or to a `reference` to the same entity, and is used only when the entity declares no field named `id` (a declared field wins). `@yadad/runtime` adds `bindingValues(record, entity)`, the values a row action's bindings read; the table, calendar and board renderers use it.
- 547299f: `recordJsonSchema` now emits a `text` field's `maxLength`, so a server validating with the published record schema refuses the over-long strings the runtime already refuses.
- fad57e0: The table shows a list page's `notice` in a polite status region above the rows (inside a `layout.Section`, as `<p role="status" data-yadad-page-notice data-tone>`), replaced on every load. The `datetime` input slot gets optional `minLocal` / `maxLocal` (`YYYY-MM-DDTHH:mm`, the field's `min` / `max` in the viewer's zone) beside the stored instants; core's `FieldInputExtras.datetime` is now `DatetimeInputExtras`. The calendar legend already receives each entry's `color`.

## 0.15.0

### Minor Changes

- d11aad3: `specVersion` 8 (D49): an identity `migrate()` step for everything RFC 0008 and RFC 0009 accepted, plus the `time` and `tags` field types. Every item landed optional and additive, so every version 7 document stays valid and `migrate()` only stamps the version.
  
  This commit also completes RFC 0008 item 3, which card 47a's commit left unlanded: `doneField` on `CalendarView` and `BoardView` (the id of a boolean field; the entry/card renders a completion toggle that patches just that field through the adapter's normal save, disabled without `can.update`). The board's `doneField` may not be one of its `groupBy` fields. The contract tables also gain the rows 47a omitted for `addForm`, `maxEntriesPerDay`, `columnsFrom` and `doneField`, so `describeContract()` now reports every key the validator accepts.
  
  Fixtures: a 7→8 before/after pair under `fixtures/migrate/`, a whole-set v8 document exercising the new keys (`fixtures/valid-sets/rfc-0008-9-v8.json`), and a record with a `time` value and a `tags` list (`fixtures/data/record-time-tags.json`).
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
- 9574fa8: Author the RFC 0008 and RFC 0009 contract keys (card 47g).
  
  Editor: `doneField` and `maxEntriesPerDay` rows in the calendar editor; `doneField` and a
  `columnsFrom` switch in the board editor; an `addForm` picker and named-filter rows (`filters`)
  in the table editor; option label + colour rows in the field-options editor; per-item
  `FormItem.label`, `multiline`/`maxLength`, `colorFrom`, the sub-record section builder and the
  `repeat: "batch"` toggle in the form editor; and the `fieldEqFact` leaf (field + declared-fact
  pickers, no free text) in the condition builder.
  
  Core: `TextField.multiline` and `TextField.maxLength` (validated, ceiling
  `TEXT_MAX_LENGTH_CEILING`), the keys the text-field panel writes.
- afa08dd: RFC 0008 view/field contract keys (validator side; the renderer follows in its own card).
  
  - `StaticOptions.values` entries may now be `{ value, label?, color? }` as well as plain strings (item 5): `label` defaults to `value`, `color` is a `#RRGGBB` display hint. Stored records, filters and conditions keep using `value`. Helper `optionValue()` returns the stored value of either form.
  - `FormItem.label?` relabels a field in one form view (item 6).
  - `CalendarView.maxEntriesPerDay?` replaces the fixed "+N more" cutoff of 3 (item 7); default is still 3, so no document changes meaning.
  - `ReferenceField.colorFrom?` names a colour-shaped field on the target (item 8); the renderer consumes it later.
  - `TableView.addForm?` names a form view over the same entity the table offers as "Add" (item 4); the set validator checks existence, kind and entity.
  - `BoardView.columnsFrom?: "options" | "records"` opts a reference grouping into target-derived columns (item 10); default `"records"` is today's behaviour.
  
  No `specVersion` bump: every new key is optional and old documents validate and render exactly as before.

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
- 920dffa: Add the `time` and `tags` field types (RFC 0008 items 14 and 15).
  
  - `time` stores a time of day as `"HH:MM"` — 24-hour, zero-padded, no day and no zone. It compares with eq/neq/gt/gte/lt/lte/in/empty/notEmpty (never `contains`, never a relative date), takes optional `min`/`max` bounds and a `step` in whole minutes, and can be an action input. A `time` field is never a stand-in for `date`: it cannot place a calendar entry, and `due_date` plus `due_time` stay two fields.
  - `tags` stores an array of non-empty strings in the order entered — the only field type whose value is a list. `contains` and `in` match ANY element (wrap in `not` for the negation); it has no ordering, so gt/gte/lt/lte are refused. It cannot be a sort key or a board `groupBy` (a card carries many tags and a column needs one value per card), and it declares no properties beyond label and required — no options, static or from an entity.
  - `recordJsonSchema`: `time` is a string with the `HH:MM` pattern; `tags` is an array of string with `uniqueItems`. `validateRecord` is the step gate and leaves duplicates to the input, so the two deliberate divergences are pinned in the parity table.
  - Editor: both types appear in the new-field type menu with no property panel of their own, and the input/display dispatcher routes them through the registry. The mock registry drives them with a native time box and a comma-separated text box; the real widgets (including the tags chips input) ship with the components repo's card 23a. `tags` is not an action input until that chips widget exists.
- 5d25641: RFC 0009 contract (items 1, 3, 4, 5), all additive.
  
  - `fieldEqFact` condition leaf: `{ op: "fieldEqFact", field, fact }` — the record's
    value of `field` equals the viewer's value of a fact declared in the context's
    `viewer` document. A record leaf: legal wherever `eq` is, banned in filter places
    (a filter is a server query and the server cannot resolve the viewer's value).
  - Named saved filters on a table: `filters?: [{ id, name, condition }]`, each
    condition checked by the same `checkCondition` the table's own `filter` uses.
  - `repeat?: "batch"` on a form view: the host renders the field set N times and
    the write path creates N records atomically.
  - Sub-record checklist sections: a form section holds `items` OR `subRecords`
    (`{ entity, via, titleField, doneField, orderField?, addLabel? }`) — a declared
    checklist over a child entity whose `via` reference points back at the form's
    entity. `sectionItems(section)` is the accessor for the now-optional `items`.
  
  `specVersion` stays 7; card 47c lands the 7-to-8 bump with RFC 0008's items.
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

## 0.14.0

### Minor Changes

- 78b0d67: New export `defaultTitleField(entity)` in @yadad/core: the single owner of the "an omitted view titleField falls back to the entity's first text field" rule. The validator's calendar/board title checks and both runtime `titleFieldOf` helpers now call it instead of re-encoding the rule — the four copies could drift apart silently, validator against runtime. Behaviour unchanged.
- 08db8af: `SeriesWidgetProps.aggregation` — the chart stops reading English (card 45g). The series widget told its component what the number was only as prose (`measureLabel: "Minimum weight"`), and `/git/yadad-components`' `measureFitsData()` sniffed the label's first word to decide whether the axis may start above the data — so a copy edit or a translation silently changed chart behaviour. The engine already knows (`measure.op`); the renderer now passes it as `aggregation: Measure["op"]` alongside the unchanged `measureLabel`. **Breaking for hand-implementers:** components that build `SeriesWidgetProps` by hand must add the required `aggregation` field; components that only receive it are unaffected. Consumer sets should switch `measureFitsData` to read `aggregation` (yadad-components card 19).

### Patch Changes

- 43eab04: Validator internals, behaviour frozen: the calendar and board field checkers shared a verbatim preamble (find/idsOfType/unknown/typed), a title fallback and a filter/sort/actions tail — three copies of rules that had to be edited together. Now one file-local ViewFieldChecker factory, checkViewTitle and checkViewFilterSortTail, plus entityFieldIds for the seven repeated field-id lists. Same codes, paths, messages and check order, pinned by the untouched document-fixture suites.

## 0.13.1

### Patch Changes

- e2ae6de: Ship CHANGELOG.md in every published tarball. The `files` arrays shipped `dist` and `src` only, so a consumer upgrading from the registry could not read the upgrade notes — only `@yadad/components` shipped its changelog.

## 0.13.0

### Minor Changes

- 7a1e601: series widget, specVersion 7: dashboards can group a table view's records by one field and show a measure per group as a table, bar or line chart (RFC 0001 slice 2). Documents written for version 6 stay valid; migrate() stamps them to 7.

## 0.12.1

### Patch Changes

- cb8579e: README documents the RFC 0007 contract surface: entity actions and view recordActions with a validated example, the datetime field's one stored form, compare columns, optional page totals with the opaque cursor, and the optional `layout.Dialog` and `fields.datetime` registry keys.

## 0.12.0

### Minor Changes

- d67034d: The confirm and input dialog (RFC 0007): pressing an action with `confirm` or `input` opens `layout.Dialog` — the renderer builds the content (the message, the input fields as FieldFrame plus the type's Input, an ErrorSummary, Cancel and Confirm), the component only provides the modal behaviour. Confirm validates with `validateActionInput` before the server sees anything, then calls `act` with Confirm disabled and "Working..." announced. A 400 keeps the dialog open and puts each `/input/<id>` issue on its field; 403/409/404 close it, show the view's ErrorSummary and reload (nothing merged, nothing retried); any other failure keeps it open with the message so the viewer can retry. Cancel and Escape never call `act`, and the modal returns focus to the pressed button. The 35f restriction is gone: every offered action is now pressable. `ButtonProps` gains the optional `tone: "danger"` (the mock renders `data-tone`), so a `danger` confirm reaches the Button.
- 48f10a8: Datetime fields in the viewer's zone (RFC 0007): every renderer takes an optional `formatting?: { locale?, timeZone? }` and passes it down (dashboard pass it to each embedded view). A datetime Display gets `text` from `formatDateTime` plus the stored instant for a `<time dateTime>`; the Input shows the local wall time (`instantToLocal`) and stores the instant back (`localToInstant`, DST-safe: an ambiguous local time is the earlier instant). A registry without `fields.datetime` still shows an `ErrorSummary` naming the key. `@yadad/core` gains the optional `DatetimeDisplayExtras.text`; the mock Display renders `text ?? value`. The quick filter gains a from/to range for `datetime`: the control is a text box, the typed local times convert through `instantRangeBounds` (the `to` end covers its whole minute), read in the viewer's zone.

## 0.11.0

### Minor Changes

- d13f4cb: Review screens, part one (RFC 0007). `specVersion` is now 6; older documents stay valid and `migrate()` only stamps the new version.
  
  What you change when you upgrade:
  
  - `fields.datetime` is a new **optional** registry key, so existing component sets still type-check. A document that uses a `datetime` field with a registry that lacks it shows an error naming the key. `Registry.fields` is now `RegistryFields<N>`.
  - `Page.total` is now **optional** and `Page` gains `next?: string | null`, an opaque cursor. Code that reads `page.total` as a number must handle `undefined`.
  - `Query.page` is now a **union**: `{ offset, limit }` or `{ cursor, limit }`. Code that reads `query.page.offset` must narrow first (`"cursor" in query.page`).
  - `RecordPermissions` gains `actions?: Readonly<Record<string, boolean>>` (action id to allowed; only `false` restricts).
  - `DataAdapter` gains an **optional** `act(entity, id, action, request)` method, with the `ActionRequest` type. Existing adapters need no change.
  
  What is new:
  
  - A `datetime` field type: an instant stored as `YYYY-MM-DDTHH:MM:SS.sssZ` (UTC, milliseconds, `Z`), with `min` and `max`. It cannot be a calendar `dateField` or a board `groupBy`.
  - Entity `actions` (id, label, `confirm`, typed `input`, `visibleWhen`) and view `recordActions` on tables, boards and calendars, with the validator's shape, reference and viewer-fact checks.
  - A table column `compare` (`{ to: "previousRow" | "nextRow" }` or `{ field }`) for text fields.
  - Optional registry types: `layout.Dialog` (`DialogProps`), `RecordActionItem` with `actions` on `TableRow`, `BoardCard` and `CalendarEntry`, `TableProps.actionsLabel`, and `diff` (`DiffSegment`) on the text `Display`.
  - `recordJsonSchema` emits `format: "date-time"` and a canonical pattern for `datetime` fields; `describeContract` lists all of the above.

## 0.10.1

### Patch Changes

- 869cd83: The README describes the current exports: boards, viewer facts and the state grid, with examples that type-check.

## 0.10.0

### Minor Changes

- 9ff56b5: Align the board registry types with RFC 0005. Registry implementers of `layout.Board` must change: `BoardColumn` has `id` (stable: `v:<value>`, `empty` or `other`), `count` and `droppable` instead of `value`; `BoardProps.groupedBy` is now `groupField`; `onGroupChange` is now `onGroupBy`; and `onMove` is called with `(recordId, columnId)` where `columnId` is a column `id`, not a raw value. Column order and `cards` are as before.
- 6a83b20: Add viewer facts and per-record permissions to the contract (RFC 0006, slice 1). `SPEC_VERSION` is now 5; `migrate()` stamps older documents and changes nothing else, and documents that use none of the new keys behave as before. New: the `viewer` document kind (`ViewerDocument`, `ViewerFact`, `VIEWER_FACT_TYPES`, `VIEWER_FACTS_MAX`, `VIEWER_FACT_VALUES_MAX`, `ResolvedViewer`, `ViewerFactValue`); the `viewerIn` condition op and the `ViewerCondition` subset; `conditionViewerFacts()`; optional viewer-only `visibleWhen` on table columns, `rowAction`, dashboard tabs and grid items, and `editableWhen` on table columns, calendars and boards; `DataRecord.can` (`RecordPermissions`); `describeContract()` gains `viewer` and `conditionPlaces`. A viewer leaf is rejected in any `filter`, and a record leaf in a viewer-only place.
  
  What users must change: code that switches exhaustively on `Condition["op"]`, or reads `condition.field` in a default branch, needs a `viewerIn` case (it has `fact` and `values`, no `field`; `conditionFields()` returns nothing for it). Code that switches on `Document["kind"]` needs a `"viewer"` case; `DOCUMENT_KINDS` and `Document` gain it, and `ViewerDocument` is not a `ViewDocument`. Everything else is additive and optional.

## 0.9.0

### Minor Changes

- b7012ca: Add the `board` view kind (RFC 0005) and bump `specVersion` to 4. A board groups the records of one entity into columns by a `select`, `boolean` or `reference` field (`groupBy`, 1 to 5 entries, no duplicates, never a required boolean, the first is the default grouping), with each card titled by `titleField` (a `text` or `select` field, defaulting to the entity's first text field; required when the entity has none) and optional `title`, `cardFields` (up to 3), `filter`, `sort`, `editable` and `rowAction` — all reused from the table view's patterns. A dashboard `view` widget can embed one; `count` and `stat` widgets still take table views only. `migrate()` upgrades version 3 documents by stamping version 4, and older documents stay valid. New exports: `BoardView`, `BoardGroupBy`, the board limits in `contract.ts`, and the registry types `BoardProps`, `BoardColumn`, `BoardCard` and `BoardGroupChoice`. `Registry.layout.Board` is optional for now, so existing registries keep type-checking; `describeContract()` gains `board` and a `layout.Board` entry in `optionalRegistryKeys`. `ViewDocument` and `DOCUMENT_KINDS` gain `board`, so code that switches over view kinds needs a board case (or a default).

## 0.8.0

### Minor Changes

- 524f917: Add the `calendar` view kind (RFC 0004) and bump `specVersion` to 3. A calendar places the records of one entity on the days of a month or week by one `date` field (`dateField`), with optional `titleField`, `detailFields`, `colorField`, `filter`, `sort`, `modes`, `weekStartsOn`, `editable` and `rowAction`. A dashboard `view` widget can embed one; `count` and `stat` widgets still take table views only. `migrate()` upgrades version 2 documents by stamping version 3, and older documents stay valid. New exports: `CalendarView`, `CALENDAR_MODES`, `CalendarMode`, the calendar limits in `contract.ts`, and the registry types `CalendarProps`, `CalendarDayProps` and `CalendarEntry`. `Registry.layout.Calendar` is optional for now, so existing registries keep type-checking; `describeContract()` gains `calendar` and `optionalRegistryKeys`. `ViewDocument` and `DOCUMENT_KINDS` gain `calendar`, so code that switches over view kinds needs a calendar case (or a default).

## 0.7.0

### Minor Changes

- 0d0c2d0: Add `recordJsonSchema(entity)`, which compiles an entity to a standard JSON Schema (draft 2020-12) for a record's `values`, so a backend can validate records with any JSON Schema library instead of re-implementing the field rules. `pnpm record-schema <entity.json>` prints the schema for an entity file. Nothing existing changes. Known differences from `validateRecord` are listed in `docs/records-protocol.md`.

## 0.6.0

### Minor Changes

- 6ec0fed: Add the `reference` field type (RFC 0002 slice 1): `{ type: "reference", entity, display? }` stores another entity's record id. The validator checks the target entity and display field across a set and rejects reference fields as quick filters, table sort keys and in ordering conditions. The registry gains the `reference` key, whose Input gets the picker options and whose Display gets the resolved label (`ReferenceOptions`, `ReferenceInputExtras`, `ReferenceDisplayExtras`).
- 7b3c167: Table views gain an optional `rowAction` (`{ open, bind: [{ field, to }], mode? }`, RFC 0003 slice 1): a row opens another table view filtered by the row's values. The validator checks the target is a table, both fields exist with the same type, no cycles and at most 3 hops (`MAX_ROW_ACTION_DEPTH`). `describeContract()` reports it.
- 696677d: `specVersion` is now 2. Version 0 and 1 documents stay valid, and `migrate()` stamps them as version 2.
- de5d2d3: Add the `stat` dashboard widget (RFC 0001, slice 1): a `measure` of `count`, `sum`, `avg`, `min`, `max` or `countDistinct` over a table view's records, with `product: [a, b]` for sum and avg. `describeContract()` lists the measure ops, the validator checks view, field ids and field types, and `CountWidgetProps` gains an optional preformatted `text`.

## 0.5.0

### Minor Changes

- e21c2e7: Add relative dates to conditions: a comparison on a date field may take `{ "daysFromToday": N }` as its value. The validator rejects non-integers, non-date fields, and use in `in`/`contains`. `specVersion` is now 1 (version 0 documents stay valid), `migrate()` upgrades older documents, and `describeContract()` reports the relative date.

## 0.4.0

### Minor Changes

- 3b26d75: `describeContract()`: a pure function that returns a plain JSON description of everything a document can contain (document kinds and their properties, field types and their type-specific properties, condition ops with their exact shapes, widget types, grid limits, the id pattern, the error codes). It is generated from the same constants the validator uses, so it cannot describe what the validator rejects; the new drift tests in `contract.test.ts` prove it (every listed property is accepted at its path, every unlisted one is rejected, every op shape validates). The root script `pnpm describe-registry` prints the description (readable text by default, `--json` for machines) directly from the TypeScript source, so it works from a fresh clone after `pnpm install` with no build step.

## 0.3.1

### Patch Changes

- 12bb9fa: Each package now ships a short README describing what it is and linking to the repo README and ARCHITECTURE.md, so the published packages say what they are without opening the repo.

## 0.3.0

### Minor Changes

- 4bb09dc: Breaking: table views use `quickFilters` (type `QuickFilter`) instead of `filters`; rename the key in existing documents. Validation results now carry `warnings` (code `empty`) for valid but empty documents, which the editors show; condition errors name the key each op takes and show its exact shape.

## 0.2.0

### Minor Changes

- 01ed46c: Add `validateDocuments(inputs)`, which validates a set of documents together, on top of checking each one alone: every form/table view's `entity` exists, every field id used by forms (items and conditions), tables (columns, sort, quick filters and fixed filter) and a dashboard `count` widget's filter exists on the view's entity, dashboard `view` widgets point at an existing form or table and `count` widgets at a table, and document ids are unique per kind. New closed error code `unknown-reference`; `DocumentError` gains optional `document` (the id of the document the error belongs to) and `allowed` (the ids or values that would have been accepted).
- 7ed972d: `DataRecord` now carries an opaque `version`, `WriteMeta` accepts `baseVersion`, `DataAdapter.delete` accepts write metadata, and `DataAdapter.batch` creates and deletes records atomically. Adapter failures are typed `AdapterError` subclasses (`RecordNotFoundError`, `RecordConflictError`, `RecordValidationError`, `UnauthorizedError`, `ForbiddenError`) with the records-protocol error codes.

## 0.1.0

### Minor Changes

- 2535b59: Add number, boolean, select and date fields across the engine: document validation, record validation, rendering, mock components and the contract kit. Inputs get `describedBy` and FieldFrame an `errorId` so errors are linked to their input.
- 9b53d91: Add JSON conditions: `visibleWhen`, `requiredWhen` and `clearWhenHidden` on form items; a fixed `filter` and quick `filters` on table views; `Query.filter`; `evaluateCondition`, `evaluateFormRules` and `applyFormRules` in runtime.
- 3e64a96: Add the pre-contract walking-skeleton contract: entity and form view documents (text fields only), the `{ path, code, message, hint }` error format, the `Registry` and `DataAdapter` interfaces, and `validateDocument`. Phase 1 replaces it with contract-v0.
- 804f491: Add dashboards: a `dashboard` view kind with tabs and a grid of view and count widgets; `DashboardRenderer` and `DocumentSet`; `Tabs`, `Panel` and the `count` widget in the registry, mock registry and contract kit.
- dc3605f: Add `ErrorSummary` to the registry layout; the renderer uses it for setup and save errors.
- 8f6a1b0: Add table views: a `table` document kind with columns, default sort and page size; sorting in `Query` and the memory adapter; `submitEdit`; and `TableRenderer` with sorting, paging and in-place editing. The registry's layout gains `Section`, `Button` and `Table`, and inputs accept `labelledBy`.
