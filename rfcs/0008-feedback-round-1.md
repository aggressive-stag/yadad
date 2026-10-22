# RFC 0008: Consumer feedback round 1

- Status: Draft (2026-10-22). Items 1–6; items 7–15 land with the next card.
- Touches: `core` (`RowBinding`, `ReferenceField.display`, `CalendarView`/`BoardView.doneField`, `TableView.addForm`, `StaticOptions`, `FormItem.label`, the validators, `describeContract`), `renderer` (calendar and board completion toggle, table add, reference display of a date, select labels), `testing` (contract kit, state checks), `editor` (the matching editors), `apps/showcase`, and the components repo (select display with label and swatch).
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

## Owner questions

1. Bind the record's own id: reserved `field: "id"` (recommended), a `{ id: true, to }` binding, or the documented workaround?
2. Reference `display`: accept `date`/`datetime` **and** improve the error (recommended), or improve the error only?
3. Completion: `doneField` on calendar **and** board (recommended), or hold the line on `recordActions`?
4. Add-a-row: `TableView.addForm` (recommended), or a documented host pattern?
5. Select options: `{ value, label?, color? }` (recommended), a `color` field type instead, or both?
6. `FormItem.label`: accept (recommended), or keep one label per field everywhere?
