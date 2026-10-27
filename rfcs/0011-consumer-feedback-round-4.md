# RFC 0011: Consumer feedback round 4

- Status: Draft
- Touches: `core` (a confirm subject field, `reference` fields as quick filters; the validators, `describeContract`), `runtime` (two regressions in `validateRecord`, the state grid's record generation, quick-filter options for references), `renderer` (a controlled dashboard tab, drill levels that keep their rows, the confirm subject line, the reference quick-filter picker), `testing` (a calendar check, state-grid axes for the new keys), `editor` (the matching editors), docs, and the components repo (a diff raw-text hook).
- Proposes the next `specVersion` with an identity `migrate()` step and a before/after fixture pair, once, when the first accepted contract item lands (items 2 and 3). Items 1 and 4 need no bump.

## Summary

All three consumers re-tested their open feedback on the RFC 0010 train (core 0.16.0, renderer 0.16.0, components 0.32.0) and filed it: a review UI (`docs/10-yadad-feedback.md`, wave 12 section: 16 fixed, 5 partly, 15 open), a household task app (F16) and a workout log (F15). The round mostly confirmed RFC 0010, and it also found **two regressions** that need fixing before anything new is built:
- `validateRecord` refuses every labelled select option.
- The state grid silently skips every state of an entity with a `readOnly` field.

Both are plain bugs, listed under "Fix without a contract change", so no owner decision is needed to start them.

This RFC asks four questions. Two are new: a controlled dashboard tab, and a confirm dialog that names its record. One revisits RFC 0010 item 3, because the consumer's choice lists turn out to be entities already. One re-asked item gets the earlier verdict with a recommendation not to build it. Every premise below was checked against `main` at `1ed71ca` on 2026-10-27.

Nothing here moves authority: the server stays the only one, documents decide what the screen offers, and `can` and conditions only narrow it (RFC 0006). The RFC adds no string expressions, no free-form props, no `custom` field type and no component names in documents.

### 1. A dashboard tab that belongs to the URL

**Source.** The review UI (12B3-2). RFC 0010 item 1 put drill-downs in the URL, but `DashboardRenderer` keeps its selected tab in private state (`dashboard-renderer.tsx:107`, `useState(initialTab ?? tabs[0]?.id ?? "")`), and it has no change callback. The consumer derives the tab from the drilled widget's id, so a link copied after switching tabs away from an open drill still opens the drilled widget's tab.

**Problem.** Back/forward and shared links can restore the drill but not the tab. "Which tab am I on" is the most basic place a viewer is in.

**Options.**
- (a) A controlled-optional pair, `tab?: string` and `onTabChange?(tab)`, shaped like `drills` / `onDrillChange` (49a2) and `savedFilter` / `onSavedFilterChange`. Unset, today's private state and `initialTab` behave as now. If the supplied tab is not visible to the viewer, the renderer falls back to the first visible tab and reports it through `onTabChange`.
- (b) A notify-only `onTabChange`. `initialTab` restores on load, but browser Back cannot move the tab without a remount.
- (c) Do nothing; hosts derive the tab from the drill.

**Recommendation.** (a). It is the third use of one precedent: the host owns the state and the renderer renders it. (b) leaves Back half-working.

**Contract impact.** `renderer`: the pair, plus a README line. `core`, `runtime`, `components`: none. `testing`: none (the grid already has a `tab` axis). `specVersion`: none.

### 2. A confirm dialog that names its record

**Source.** The review UI (9C2-Y4, now #2 in its top five). `ActionConfirm` is `{ title?, message, confirmLabel?, tone? }` (`document.ts:190`), and the dialog renders `message` verbatim. An "Apply this proposal?" dialog cannot say which proposal. An earlier build of the consumer interpolated the row's summary into the text.

**Problem.** The most consequential dialogs (apply, purge, reject) are the ones where naming the record matters most. RFC 0010 ("Considered, not proposed") ruled out `{summary}` interpolation under AGENTS.md rule 5, and said to revisit it only with a typed field-reference shape.

**Options.**
- (a) `ActionConfirm.subjectField?: <field id>`. The dialog shows that field's display value as a subject line under the message, rendered the way a table cell renders it, so labelled options show their label and references show their target's label. It is one typed field reference, not a template. The validator checks that the field exists on the entity.
- (b) Typed message parts: `message: [{ "text": "Apply " }, { "field": "summary" }, { "text": "?" }]`. This is more expressive, but it makes a small layout language out of a string, and translations get harder.
- (c) Do nothing. The dialog title and the row's position are all the context there is.

**Recommendation.** (a). It answers the real need (which record?) with one typed reference and leaves no template to grow.

**Contract impact.** `core`: `subjectField` on `ActionConfirm`, the validator, `describeContract`. `renderer`: the subject line in the confirm dialog, through the existing dialog slot (add an optional `subject?: string` to its props in `registry.ts`). `components`: render `subject`. `editor`: a field picker on the confirm editor. `testing`: a contract-kit fixture. `specVersion`: next.

### 3. Server-backed choices as reference quick filters (RFC 0010 item 3, revisited)

**Source.** The review UI (9A3-Y1, 9B2-Y1, now #1 in its top five) re-asks for `options.source: "entity"`. RFC 0010 item 3 chose (c), ratifying build-time filling, and said that if an in-contract path is wanted later, option (b), a `reference` quick filter, should be tried before (a). New evidence: the consumer's server-side choice lists (agents, namespaces) are already entities in its own document set, with their own tabs.

**Problem.** Build-time filling works, but the committed document carries a placeholder, and the loader has to fill it before validation. The one in-contract path that already models "pick a record of another entity" is the `reference` field, and quick filters refuse it (`validate.ts:2071`, `checkNotReference`: "Reference fields cannot be quick filters or sort keys in this version").

**Options.**
- (a) Allow a `reference` field as a quick filter.
  - The control is a picker over the target entity's records, labelled the way references already display. It loads through the target entity's data source, the same path reference display uses (`runtime/src/reference.ts`).
  - The filter matches on the stored id with `eq`, and `default` is a record id.
  - Sort keys stay refused.
  - The consumer moves its `agent` / `namespace` fields from `select` to `reference`.
- (b) Keep build-time filling (RFC 0010's verdict), and document the `whoami` pattern.
- (c) `options.source: "entity"`. Every reader of `options.values` (validation, `recordJsonSchema`'s `enum`, the state grid, board columns) would have to become asynchronous. RFC 0010 rejected it, and nothing has changed.

**Recommendation.** (a). It is the smaller path RFC 0010 named, it adds no new option source, and this consumer's lists are already entities.

**Contract impact.** `core`: lift the quick-filter half of `checkNotReference`, a reference `default` shape, `describeContract`. `runtime`: `initialQuickFilters` for a reference, and the option list for the picker. `renderer`: the picker in the quick-filter row (through the existing select input slot, with the loaded records as options). `testing`: a quick-filter axis value for a reference. `editor`: allow reference fields in the quick-filter panel. `specVersion`: next.

### 4. Two text-filter kinds (re-asked; recommendation: not now)

**Source.** The review UI (9E1-Y2, #5 in its top five): `contains` (substring) and word-match (full-text) search are different semantics with one control, so a mid-word search on a full-text server returns nothing and reads as an empty dataset. RFC 0010 ("Considered, not proposed") answered that the document cannot make a server do full-text search, and that item 5's label and placeholder let a document say which match the server runs. The consumer has since adopted exactly that: the placeholder now reads "Words in the fact text" (12B1).

**Options.**
- (a) `QuickFilter.match?: "contains" | "words"`. `words` sends a new condition op that servers may refuse with `400`. The memory adapter would implement a naive word match.
- (b) Keep the RFC 0010 verdict: the server owns the matching, and the label and placeholder tell the viewer which one it runs.

**Recommendation.** (b), until a second consumer needs a document to choose the match. One consumer, one server, and the placeholder already says it.

**Contract impact.** If (a): a new condition op in `core`, the validator, both adapters, the protocol doc and `specVersion`. If (b): none.

## Fix without a contract change (cards, no owner decision)

Verified on `main` at `1ed71ca`:
- **`validateRecord` refuses every labelled select option.** `runtime/src/record.ts:92` checks `field.options.values.includes(value)` on the raw list, so `{ value: "open", label: "Open" }` never matches `"open"`. The hint prints `[object Object]`. Every other reader goes through `optionValue()`. This has been broken since labelled options landed (core 0.15.0, 2026-10-25): a form or inline edit over a labelled select fails client validation, and state-grid records with labelled values are skipped. *Regression; fix first.*
- **The state grid silently skips every state of an entity with a `readOnly` value.** Since 48i, `validateRecord` refuses a value for a `readOnly` field. `view-states.ts` validates its generated *stored* records with it (`:222`, `:815`, `:1054`), so every generated record that carries the server-set id is "not valid".
  - On the workout log's documents, every `sessions` state with records is skipped, and the series widget's axis is dropped. That is the `widget:` axis loss F15 asked about, and its `field:id` loss.
  - The checks still pass because a skipped state is not a failure.
  - Fix: a stored-record mode for `validateRecord` (mirroring `recordJsonSchema`'s `mode`), used by the state grid. *Regression; fix first.* The workout log's `REQUIRED_AXES` workaround should then be reverted.
- **The calendar `done-missing` check ignores the day cap.** `testing/src/state-checks.tsx:703` compares drawn checkboxes against every item, but a calendar with `maxEntriesPerDay` draws at most that many per day and a "+N more". Count only the entries the cap renders (F16 finding A).
- **A controlled drill reloads every open hop** when a new hop opens (12B3-1): each level's filter is rebuilt on every `drill` change, so hop 1 is fetched twice once hop 2 is open. Keep a level's rows when its step is unchanged.
- **Telling two renders of one view apart is undocumented.** Two consumers re-filed this as open: the batch composer rendered on a dashboard and in a table's add panel (F15 finding 3, F16), and two tags quick filters (F14, F15). The hooks exist: `data-yadad-grid-item`, `data-yadad-add-form`, `data-yadad-filter-field` and `data-yadad-form`. Scoping by those ancestors is the design, but the renderer README never says so. Add a "Telling instances apart" section.
- **The saved-filter state check needs the driver to pass `render.savedFilter`.** testing 0.12 (`d4ce13b`) added the `saved-filter` check, so a hand-written driver that ignores `state.render.savedFilter` now fails ("lit in the state but not pressed"; F16 finding A). Add an upgrade note to the testing README and CHANGELOG.
- **The action dialog input has no hook** (9C2-Y1): its id is the generated `yadad-action-<action>-<record>-<field>` (`record-actions.tsx:231`). Add `data-yadad-action-input="<field id>"`.
- **Diff cells have no raw-text hook** (9B3-Y3, 9D2-Y2; two lanes): the components set splits a diff into labelled spans, so `textContent` never matches the source string. Add a raw-text attribute in the components repo.
- **Docs:**
  - One README line saying the built app makes no requests to yadad infrastructure (9A2-Y2).
  - What one grid row (`h`) means on screen, in `describe` (9C3-Y4).

## Answered by earlier verdicts or by the protocol (not re-asked)

- **Count probes that need `limit: 0`** (9C3-Y3, #3 in the review UI's top five):
  - `docs/records-protocol.md:87` makes `limit=0` legal (minimum 0, `items` empty, `total` the real count).
  - `:188` documents the walk to the 5,000-record cap for a server that does not count.
  - A server that refuses `limit=0` is outside the protocol. That is a consumer-server fix, not a runtime fallback, which would hide the protocol break.
- **A total in cursor paging** (9E2-3): a server that returns `total` gets offset paging and "Page N of M" (`table-renderer.tsx:444-447`). Cursor mode exists only when there is no total, so there is nothing to show. Count widgets beside the table are the pattern.
- **A view `filter` as a list** (9A3-Y2): `{ "op": "and", "conditions": [...] }` and `op: "in"` are valid. Only a quick filter takes one value (RFC 0010).
- **Server-side relative dates** (F15 finding 5): `docs/records-protocol.md:91` now states that relative dates are resolved before they reach the server.
- **Semantic colour tokens** (11B1-Y1, partly): RFC 0010 item 12 made the eight-colour palette the vocabulary, and theme 0.3.0 draws it in light and dark. "Success / warning / neutral" tokens have no document key to use them.

## Considered, not proposed

- **Danger placement for row actions** (9B5-Y2), **folding long text** (9F1-Y1), **a `listAll` adapter helper** (9F4-Y1) and **a nested-list mapping** (9F3-Y1): RFC 0010 gave these the same verdicts, and they still have one consumer each.
- **A warning when a document is stamped older than the installed core** (F16 finding B): older stamps are valid by design (AGENTS.md rule 8), and the identity steps change nothing but the stamp. An upgrade note ("run `migrate()` to restamp") in the core README covers it without a warning on every document.
- **Registry `time` metadata** (9A1-Y2): a property of the package registry, not of yadad.

## Owner questions

1. **Item 1:** a controlled `tab` / `onTabChange` (a), or notify-only (b)?
2. **Item 2:** `confirm.subjectField` (a), typed message parts (b), or nothing?
3. **Item 3:** allow `reference` fields as quick filters (a), or keep build-time filling (b)?
4. **Item 4:** keep the RFC 0010 verdict on text-match kinds (b), or add `match` (a)?

## Owner decisions

_Pending. The owner has not yet decided any item._
