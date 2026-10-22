# RFC 0008: Consumer feedback round 1

- Status: Draft (2026-10-22). Items 1–15, all drafted.
- Touches: `core` (`RowBinding`, `ReferenceField.display`/`colorFrom`, `CalendarView.doneField`/`maxEntriesPerDay`, `BoardView.doneField`/`columnsFrom`, `TableView.addForm`, `StaticOptions`, `FormItem.label`, `TextField.multiline`/`maxLength`, new `time`/`tags` field types, the validators, `describeContract`, `recordJsonSchema`), `runtime` (condition/quick-filter helpers, reference labels, `canUpdate` narrowing, board columns), `renderer` (completion toggle, table add, reference display, pager slot, quick filters, forms), `testing` (contract kit, state checks), `editor` (the matching editors), `docs/records-protocol.md` (`can.fields`, `tags` values), `apps/showcase`, and the components repo (select/textarea/tags/time inputs, headings, pager styles).
- Bumps `specVersion` from 6 to **7** (read `SPEC_VERSION`; if another step landed first, take the next number) with an identity `migrate()` step (everything here is optional and additive) and a before/after fixture pair.

## Summary

Two consumers — a household todo app and a workout log — built real screens on yadad and filed what the document format could not express. This RFC collects the contract changes from that round, one section per item, each with the source, the problem, the options, a recommendation and the contract impact. The owner decides per item; only accepted items get code, and the `specVersion` bump happens once, when the first accepted item lands.

Nothing here moves authority: the server remains the only one, documents decide what the screen *offers*, and `can` and conditions only narrow it (RFC 0006). No string expressions, no free-form props, no `custom` field type, no component names in documents.

### 1. A row action can bind the record's own id

**Source.** A workout log: a session row should open the sets that belong to it. `RowAction.bind` reads `row[field]` — the record's *values* — and the record's own id is not a value, so there was no `field` to name. Unblocking it took a backend change (serve `id` inside `values`) and a self-reference field (`{ id, type: "reference", entity: "session" }`) on the session entity, because `bindable()` (validate.ts) requires both sides to be the same field type, and for references the same target entity. A plain text `id` field fails validation against a `reference` target. Our own review set has the same scar: it binds a `code` field because the id is unreachable (the gap RFC 0003 carried forward).

**Problem.** "Filter the children by *this record*" is the most common drill-down there is, and it is inexpressible without duplicating the id into a server-filled field — on both sides, with a write-rejection to keep it honest. That is a data-model tax every parent/child screen pays, and it is invisible until the documents refuse to validate.

**Options.**
- (a) An `id` pseudo-field: `RowBinding.field` may name the reserved `"id"`, resolved from the record's id; `bindable()` special-cases it as a string on both sides, valid against a `text` or `reference` target.
- (b) A binding-level flag: `{ id: true, to: "session" }` beside the existing `{ field, to }`.
- (c) Do nothing; document the self-reference workaround.

**Recommendation.** (a). It reads as the obvious thing (`field: "id"`), the diff is one reserved word in the type and one special case in `bindable()`, and the self-reference field keeps working for anyone mid-flight. (b) splits the binding vocabulary for no gain.

**Contract impact.** `core`: `RowBinding.field` doc + `validate.ts` binding checks; documents only — records, the records protocol and the JSON Schema are untouched. No registry keys. `specVersion`: 7 (a new accepted `field` value).

### 2. A reference may display a date or datetime field

**Source.** The workout log's sets table wanted "a session shown by its date". The validator refused verbatim: `"display" must be a text or select field, but "date" on "session" is a date field.` The session entity's only text field is `notes`, so the column shows notes — or the raw id when notes are empty.

**Problem.** `ReferenceField.display` is text-or-select, but plenty of targets are *identified* by a moment: sessions by their date, shifts by their start. And the error, while true, does not say what would pass — the consumer had to open the validator to find the fix.

**Options.**
- (a) Allow `date` and `datetime` as `display`; the label formats through the existing date/datetime display (time zone rules per RFC 0007 for `datetime`).
- (b) Keep the restriction; make the error name the qualifying fields: `"session" has no text, select, date or datetime field to display — add one or drop "display".`
- (c) Both.

**Recommendation.** (c). (b) alone still forces a fake text field onto the target; (a) alone leaves the next consumer guessing at the old message. Both are additive.

**Contract impact.** `core`: `ReferenceField.display` doc + validator (and its message); `renderer`/`testing`: reference label resolution formats date/datetime (the formatters exist in `runtime`); components: none (date display ships already). `specVersion`: 7.

### 3. A completion control without declaring an action

**Source.** The household todo app's calendar: the server declares `done` writable and accepts it; the calendar offers "Move to day…" and nothing else. The renderer *has* completion via `useRecordActions`, but that needs `entity.actions` **and** `view.recordActions` — two host-side declarations to get a checkbox for a boolean the server already accepts.

**Problem.** A writable boolean is a completion by any name, and there is no control for it on calendars or boards without hand-declaring an action per field. "Tick it off" is the single most common household interaction, and it was unreachable.

**Options.**
- (a) `doneField` on the calendar and board views: the id of a `boolean` field; the entry/card renders a toggle that patches just that field through the adapter's normal save (not `act`), disabled without `can.update`.
- (b) Require `recordActions` (today); document the pattern.
- (c) Auto-toggle every writable boolean — rejected: unordered, unstyled, and it contradicts the view-declares-what-it-shows rule.

**Recommendation.** (a), one field per view, opt-in like everything else. A keyboard path mirrors "Move to day…". The board gets the same control on its cards for free; without it the board has the identical hole.

**Contract impact.** `core`: `CalendarView.doneField`, `BoardView.doneField` + validators (field exists, is boolean, not the `dateField`/`groupBy` field). `renderer`: calendar entry, board card. `testing`: state grid gains nothing new (the record-locked axis already covers `can.update` false). Registry: reuses the `boolean` input — no new key. `specVersion`: 7.

### 4. A table can add a row

**Source.** The todo app: "the user's lists with name and color; rename in place and add a new list" split into two documents (`lists` table + `add_list` form) with the host inventing the "table plus its form" join — an add button, an opened form, a reload after save. Every app that wants add-next-to-list re-invents that glue.

**Problem.** `TableView` has columns, sorting, paging, filters and `rowAction`; creating is nowhere in the type or the renderer. Form-creating is right (`FormRenderer` owns create), but the *link* between a table and its create-form should live in the document, like `rowAction.open` does.

**Options.**
- (a) `TableView.addForm`: the id of a form view over the same entity; the table renders an "Add {entity}" affordance that opens that form (inline panel, host-chrome is a components question), and reloads the table after a save.
- (b) Document a "table + form" host pattern and change nothing.
- (c) A synthetic create record action — rejected: record actions act on *existing* records; there is nothing to bind.

**Recommendation.** (a). The validator can already check the target exists, is a form, and shares the entity; the renderer already knows how to reload. It is `rowAction` in the other direction.

**Contract impact.** `core`: `TableView.addForm` + validator. `renderer`: table header add control + form panel (reuse `FormRenderer` with the view's `dataSource`). `editor`: table editor gets an Add-form picker. `testing`: state checks add an add-form source state (refused covers it). Registry: none new — the form renders through existing keys. `specVersion`: 7.

### 5. Select options with labels — and colour

**Source.** The todo app's lists have a `color` from a fixed 8-hex palette. Modelled as a `select`, the cell renders `#D13438`: `StaticOptions` is `{ source: "static", values: readonly string[] }` — the value *is* the label, and there is no colour anywhere in the format.

**Problem.** Every select is forced to make its stored values human-readable, and a palette, a status tone or a severity cannot render as anything but its stored string. Hosts that want "red" with value `#D13438` today keep a private mapping outside the document.

**Options.**
- (a) Richen static options: `values: readonly (string | { value: string; label?: string; color?: string })[]` — string entries stay legal, `label` defaults to `value`, `color` is a `#RRGGBB` display hint the select display draws as a swatch. Filters, conditions and stored records keep using `value`.
- (b) A dedicated `color` field type (hex-constrained, swatch display).
- (c) Both.

**Recommendation.** (a). It fixes the general problem (value ≠ label) and colour is just the case that exposed it; the field stays a `select`, so quick filters, conditions, board columns and the records protocol are untouched. A `color` type adds a second way to do what a labelled select does; revisit only when someone wants a free colour picker.

**Contract impact.** `core`: `StaticOptions` (accepts objects), validators (unique `value`s, hex form when `color`), `describeContract`. Viewer `select` facts reuse the same shape (`default` still names a `value`). Records and their JSON Schema: unchanged (still strings). `specVersion`: 7. Components: select display v2 renders label + swatch (its own repo).

### 6. A form item can relabel its field

**Source.** The todo app's add-task card says "Important"; the entity field is `flag` (select, label "Flag"). A form references fields by id and cannot rename them, so the screen said "Flag" where the product said "Important".

**Problem.** A field's label serves every view; a *view's* label serves one screen. Today there is only the former.

**Options.**
- (a) `FormItem.label?: string`, falling back to the field label.
- (b) Rename the entity field — rejected: moves one view's wording into every view and into the contract.
- (c) A per-view label map `labels: { fieldId: label }` — rejected: parallel structure to the items, harder to edit and to state-check.

**Recommendation.** (a). Display-only, one field, the editor gets a Label input beside each item.

**Contract impact.** `core`: `FormItem.label` + validator (non-empty, bounded length). `renderer`: form item label precedence. `editor`: form view editor Label input. `testing`: nothing. `specVersion`: 7.

### 7. Calendar detail lines, and the busy-day cap

**Source.** The todo app's calendar asked for `detailFields: ["due_time", "done"]`; every entry rendered a bare "No" — a boolean's `plainText`, unlabelled, unreadable in a day cell — and the `done` line was dropped. Separately (Unanswered): "+N more" picks **3** as the visible cutoff and nothing in the document surface configures it; a household with ten things on a Tuesday sees 30% of its day.

**Problem.** A detail line is the value with no context, and the busiest day — the one you opened the calendar for — is the one the cutoff truncates hardest.

**Options.**
- (a) Detail lines render `field.label` by default (self-describing: "Done: No"), with the current bare value as a view-level opt-out.
- (b) A `detailLabels` array parallel to `detailFields`.
- (c) `CalendarView.maxEntriesPerDay?: number` — positive integer, default **3** (today's fixed value), replacing the constant.

**Recommendation.** (a) + (c). (b) is a second list to keep in step for a boolean the label already answers. The label-by-default is a rendering change on an existing prop; if the owner wants zero surprises, (b) is the conservative variant. (c) changes no document today — the default is the constant it replaces.

**Contract impact.** `core`: `CalendarView.maxEntriesPerDay` + validator (1–31); `renderer`: entry detail line + cutoff. No registry keys, no protocol change. `specVersion`: 7 (one new view field).

### 8. A reference `colorField` may use the target's own colour

**Source.** The todo app: `colorField: "list"` (a reference to the entity that *has* the `color`) painted "Home" red and "Work" slate — `colorSlot(value, "reference")` is `fnv1a32(value) % CALENDAR_COLOR_SLOTS`, a stable hash of the foreign-key string; nothing reads the referenced record. The consumer accepted it (consistent per list) and asked whether the hash was intended design or a first pass — the README does not say.

**Problem.** A reference target with a colour (per item 5's option-coloured select, or a plain hex text field) cannot lend it to the entry that names it; the label path already loads the referenced record, so the colour is one property away.

**Options.**
- (a) `ReferenceField.colorFrom?: string` — a field on the target whose value is a colour (hex `text`, or a `select` whose chosen option carries `color` per item 5); the renderer reads it from the record it already loaded for the label.
- (b) Infer the target's colour field by convention (name `color`); rejected — no name-based inference anywhere else in the format.
- (c) Keep the hash as the only answer and document it as intended.

**Recommendation.** (a), with the stable hash kept as the fallback when `colorFrom` is absent or the record failed to load. The fallback question the consumer could not get answered gets a README sentence either way.

**Contract impact.** `core`: `ReferenceField.colorFrom` + validator (target field exists, is colour-shaped once item 5 lands). `renderer`/`runtime`: calendar entry colour resolution (the reference records are already loaded). `specVersion`: 7.

### 9. Per-field write capability (`can.fields`)

**Source.** The todo app's recurring occurrences: the server accepts `done` but refuses any `day` patch ("recurring tasks follow their schedule") — yet every occurrence renders `draggable="true"` plus the Move button, because the records host emits no `can` at all and `canUpdate(record)` is `can?.update !== false` — fail-open. The refusal itself lands perfectly (in-page alert, record stays put); the view invited an attempt it knew would be refused.

**Problem.** `can.update` is one boolean per record. "You may edit *some* fields" is invisible to the view, so a field-level refusal is discovered by dragging, every time, by every viewer. And a first-party host that *could* answer and doesn't inherits fail-open as a feature.

**Options.**
- (a) Records protocol: optional `can.fields?: { [fieldId]: boolean }` beside `can.update`; a field absent means `can.update`. The calendar's `movable` requires `canUpdate` **and** `can.fields?.[dateField] !== false` (same for a board's `groupBy` field and item 3's `doneField`); inline editing already consults `can.update` and gains the same narrowing.
- (b) Hosts emit `can.update: false` for locked records wholesale; rejected — it also hides the `done` tick that *is* writable.
- (c) Do nothing; the server refuses honestly and the alert is good.

**Recommendation.** (a). It is the smallest protocol addition that lets the view decline politely, it degrades to today's behaviour for hosts that never speak it, and it is exactly the data the refusing server already computed.

**Contract impact.** `docs/records-protocol.md`: `can.fields` on the record shape; `core`: `recordJsonSchema` (and `RecordPermissions` type); `runtime`: `canUpdate`/movability helpers; `renderer`: calendar, board, table inline-edit gates. Documents unchanged. `specVersion`: none required for this item (protocol + schema, not documents) — it rides the bump other items need.

### 10. Board columns from reference options

**Source.** The todo app's board, grouped by an assignee reference: columns come only from values present in the *loaded records*, so a person with no open cards has no column — and no drop target. Reachability-by-drag dies with the column.

**Problem.** A reference names an entity, and the entities of that entity are the full column set; deriving columns from a page of records silently drops legitimate destinations. The label machinery already fetches reference records (`loadReferenceOptions`).

**Options.**
- (a) `BoardView.columnsFrom?: "options"` (default `"records"`): for a reference `groupBy`, build columns from the target entity's records through the adapter (the same fetch the picker uses), labelled by `display`, empty columns droppable.
- (b) Always build reference columns from the target; rejected — breaks hosts whose target is huge or slow and changes behaviour nobody asked to change.

**Recommendation.** (a), opt-in per view. Guardrails: a documented cap consistent with the reference fetch's existing 500-id limit, and the state grid gets the empty-column state.

**Contract impact.** `core`: `BoardView.columnsFrom` + validator (only meaningful with a reference `groupBy`). `runtime`/`renderer`: column building through the adapter. `testing`: state grid gains the no-cards-but-column state. `specVersion`: 7.

### 11. A `layout.Pager` registry key

**Source.** The todo app: `[data-yadad-pager]` has zero rules in the components CSS while every sibling styles itself — hosts must know the attribute exists to make the pager horizontal. Components 0.19 shipped a `Pager` set with **no key to plug it into**: the table renderer draws its own `<nav data-yadad-pager>` markup unconditionally.

**Problem.** One piece of chrome the renderer owns outright, in a package whose whole design is registry-injected components.

**Options.**
- (a) An optional registry key `layout.Pager` (props: page state, `onPage`, the cursor pair from RFC 0007); when the registry has it, the table renders it; otherwise today's markup stays as the base fallback.
- (b) Style the renderer's markup in the base set (CSS-only); no key, no injection.

**Recommendation.** (a) **and** (b): the key for hosts with opinions, base styling for everyone else. Precedent exists — every other slot is a key with base components behind it.

**Contract impact.** `core`: one optional registry key name (registry keys never enter documents — **no `specVersion`**); `renderer`: pager slot lookup + fallback; components: `Pager` gets the key and the styles. `testing`: mock registry gains it.

### 12. Panel and widget titles as headings

**Source.** The todo app: dashboard panel and widget titles (and table captions) render as `div`s — the a11y snapshot is a heading-less page and hosts paper over it with their own `h1`.

**Problem.** The component knows it is a title (`data-part=title`); the element it emits disagrees.

**Options.**
- (a) Components render their title as `h2` by default (the level the page context suggests), no document change.
- (b) `headingLevel` on the dashboard (per-widget) — a document decides an a11y detail the document should not own, and every existing dashboard is wrong until edited.

**Recommendation.** (a). Headings are markup, not contract; documents say *what* a surface is, not which heading tag it wears. If a real need for a level appears, add it as a component prop, not a document field.

**Contract impact.** Components repo only (title markup, theme selectors keyed on `h2[data-part=title]`). **No `specVersion`, no core change.** Renderer untouched if the titles are components' — the one exception (table `caption`, which is renderer markup) follows the same rule.

### 13. Multi-line text

**Source.** The todo app's notes fields are long prose (one allows 4,000 characters) and `text` renders a single-line input wherever it appears.

**Problem.** `TextField` is `{ type: "text" }` — a note and a title are the same type, and the input follows the type, not the content.

**Options.**
- (a) `TextField.multiline?: boolean` — the form input becomes a textarea, the display keeps line breaks; storage unchanged (still a string), so filters, conditions, records and the JSON Schema are untouched.
- (b) A separate `longText` field type; rejected — a second type for one display choice fragments every `switch` on `type` for no validation gain.
- (c) `TextField.maxLength?: number` alongside either — the client can then refuse "too long" before the round trip; today only the server knows.

**Recommendation.** (a) + (c). `multiline` defaults false (no rendering change today); `maxLength` mirrors `number`'s `min`/`max` pattern (validator checks positive integer; form enforces, display never truncates).

**Contract impact.** `core`: `TextField.multiline`, `TextField.maxLength` + validators, `describeContract`; `renderer` via the existing `text` registry key (input switches on the field's own option — the key may version to render a textarea); `editor`: field options checkboxes; components: a textarea variant of the text input. `specVersion`: 7.

### 14. A time-of-day field type

**Source.** The todo app stores due time as `HH:MM` in a `text` field. The lab form accepted `25:99` client-side; only the server refused it (400 `invalid-value`, rendered verbatim — one stray developer sentence on screen).

**Problem.** There is no time type, so the format check lives on the server alone and a household user sees the server's prose instead of a clock.

**Options.**
- (a) A `time` field type: stored `"HH:MM"`, 24-hour; optional `min`/`max` (`"HH:MM"`) and `step` (minutes, default any), mirroring `date`. Conditions: `eq`, `ne`, `lt`/`le`/`gt`/`ge`, `between` — comparison is lexicographic on the stored form, which is order-correct for `HH:MM`; quick filters get a "time from/to" pair like `date`'s. Form input: a time field from the registry (components ship one).
- (b) `TextField.format: "HH:MM"`; rejected — a format string is the free-form-prop door the format has kept shut, and validation still ends at the server.
- (c) A `datetime` with a date-part-only display; rejected — couples every due time to a day it may not have.

**Recommendation.** (a). **Combination with `date`:** separate fields (`due_date` + `due_time`), as today — `time` never implies a day; the calendar's `dateField` stays `date`-only (a `time` field cannot place an entry), and a `datetime` remains the one-field answer when instant *is* the fact. **Conditions and quick filters** per (a), with `runtime` helpers mirroring `date`'s.

**Contract impact.** `core`: `TIME` in `FIELD_TYPES`, `TimeField` + validators + `describeContract` + `recordJsonSchema` (pattern `^([01]\d|2[0-3]):[0-5]\d$`); `runtime`: comparison/quick-filter helpers; `renderer`: display + form wiring through the registry; `testing`: contract kit + state axes; `editor`: field-type map entry (the exhaustive per-type map *forces* this); components: time input + display. `specVersion`: 7.

### 15. A multi-value field (tags)

**Source.** The todo app's task tags cannot appear in any document: every field type stores one string, so a tag list is invisible to tables, filters and displays alike.

**Problem.** `FIELD_TYPES` has no multi-value type. Faking tags as a delimited string inside `text` makes filters string-match against `,react,vue,`-style hacks — the kind of convention this format refuses.

**Options.**
- (a) `tags`: free-text values (array of strings), with optional suggestions — the adapter may serve distinct existing values (`GET {base}/{entity}/fields/{field}/values`); absent, the input offers only what is already typed.
- (b) `multiselect` over `StaticOptions` (item 5's rich options).
- (c) Both eventually; (a) first — the household case is free-form, and a closed option list re-invents the taxonomy problem labels just solved.

**Recommendation.** (a) now, (b) only when someone needs a closed vocabulary.

**Stored shape:** `string[]` — order preserved as entered, empty strings refused, server may trim/dedupe and the client must tolerate it.
**Conditions:** `contains` (array has this value) and `notContains`; `in`/`notIn` mean *some element* is in the list — a record matches `tags in [a,b]` when any tag is `a` or `b`; every operator absent means no filter. Sort: not allowed (validator refuses — no total order on sets).
**Board `groupBy`:** not allowed (validator refuses — columns need one value per card).
**Quick filters:** chip-list over the field's known values (suggestions or loaded distincts), multi-select, matching on any-element.
**Records protocol:** `values[field]` is an array of strings for this type — the one place `string[]` appears; the JSON Schema gains `array of string, min 0, uniqueItems: true` for `tags` fields.
**Contract impact.** `core`: `TAGS` in `FIELD_TYPES`, `TagsField`, validators (condition operators, no sort/groupBy, `describeContract`), `recordJsonSchema`; `runtime`: condition/quick-filter evaluation over arrays; `renderer`: display (chips) + form input via the registry; `testing`: contract kit, state grid (empty-tags); `editor`: field options + quick-filter UI; `docs/records-protocol.md`; components: tags input/display. `specVersion`: 7.

## Owner questions

1. Bind the record's own id: reserved `field: "id"` (recommended), a `{ id: true, to }` binding, or the documented workaround?
2. Reference `display`: accept `date`/`datetime` **and** improve the error (recommended), or improve the error only?
3. Completion: `doneField` on calendar **and** board (recommended), or hold the line on `recordActions`?
4. Add-a-row: `TableView.addForm` (recommended), or a documented host pattern?
5. Select options: `{ value, label?, color? }` (recommended), a `color` field type instead, or both?
6. `FormItem.label`: accept (recommended), or keep one label per field everywhere?
7. Detail lines: label-by-default (recommended) or an opt-in `detailLabels`; and `maxEntriesPerDay` with default 3 (recommended)?
8. Reference colour: `colorFrom` reading the target's own colour, hash as fallback (recommended), or declare the hash intended?
9. `can.fields` in the records protocol, used by `movable` and inline edit (recommended), or keep fail-open `can.update`?
10. Board `columnsFrom: "options"` for reference group-by (recommended), or stay record-derived?
11. `layout.Pager` registry key (recommended) plus base-set styling, or styling only?
12. Headings: components render `h2` (recommended), or a `headingLevel` document field?
13. `multiline` + `maxLength` on `text` (recommended), or a `longText` type?
14. A `time` field type (recommended), or `format` on text (rejected in the draft — confirm)?
15. `tags` first (recommended), `multiselect` later, or both now?
