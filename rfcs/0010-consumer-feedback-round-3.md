# RFC 0010: Consumer feedback round 3

- Status: Draft
- Touches: `core` (`QuickFilter.default`/`label`/`placeholder`, a relative-instant condition value, `Field.readOnly`, `TableColumn.sortable`/`TableView.sortable`, `Page.notice`, possibly `StaticOptions`; the validators, `describeContract`, `recordJsonSchema`), `runtime` (relative-instant resolution, create validation that skips read-only fields, quick-filter initial state), `renderer` (controlled drill state, `FormRenderer` `initialRows`, quick-filter commit timing, the notice region, sortable headers), `testing` (state-grid axes for the new states), `editor` (the matching editors), `docs/records-protocol.md` (the `notice` page key, read-only fields), and the components repo (header, notice and quick-filter markup).
- Proposes the next `specVersion` with an identity `migrate()` step (everything here is optional and additive) and a before/after fixture pair, once, when the first accepted contract item lands. Items 1 and 7 are renderer API and need no bump.

## Summary

Three consumers filed feedback after adopting the RFC 0008/0009 train (core 0.15.0, renderer 0.14.0): a review UI (the longest report, re-tested on 0.15.0 with a Status column), a workout log and a household task app. This RFC collects what is still a contract or renderer-API question, one section per item, each verified against current `main` before it was written. Asks that are already possible, or that are plain bugs, are listed at the end and not re-asked; the CLOSED verdicts of 0008/0009 (`multiselect` deferred, the cross-field search box, the union list) are respected, and no item here reopens one.

Nothing here moves authority: the server remains the only one, documents decide what the screen *offers*, and `can` and conditions only narrow it (RFC 0006). No string expressions, no free-form props, no `custom` field type, no component names in documents.

### 1. Drill-downs that have a URL

**Source.** The review UI, two independent lanes: `rowAction.open` pushes onto a private stack (`table-renderer.tsx:131`, `const [stack, setStack] = useState<readonly Level[]>([])`), so nothing can render a drill at a URL or deep-link into hop 2 of a two-hop chain. They hosted the same documents twice, once at top level with a host-bound filter, and kept a hash route in sync by convention. Verified: no `onDrill`/`opened` prop exists in `packages/renderer/src` (the `opened` in `calendar-renderer.tsx:88` is the calendar's own private state).

**Problem.** A drill is a place the viewer is in, but only the renderer knows it. Back/forward, reload and shared links all lose it.

**Options.**
- (a) A controlled-optional pair on `TableRenderer`/`DashboardRenderer`, exactly the shape `savedFilter`/`onSavedFilterChange` already has (`table-renderer.tsx:67-69`): `drill?: readonly { viewId: string; bindings: Readonly<Record<string, string>> }[]` and `onDrillChange?`. Unset, the renderer keeps today's private stack. The renderer re-validates a supplied drill through the same `resolveRowAction` checks, so a stale URL degrades to the top level with a notice.
- (b) A notify-only `onDrill(view, bindings)` callback: the host can write a URL but cannot restore from one.
- (c) Do nothing; keep the two-entry-points workaround.

**Recommendation.** (a). It reuses a precedent the renderer already follows (the host owns the state, the renderer renders it) and closes the restore half that (b) leaves open.

**Contract impact.** `core`: none (renderer API; document and records protocol untouched). `runtime`: none. `renderer`: the two props and the stack seeding. `components`: none. `testing`: state grid gains a "drilled" seed only if the owner wants it. `specVersion`: none.

### 2. A relative instant in filters

**Source.** The review UI's 24-hour widget on an audit-log `at` field. `{ daysFromToday }` is a date value (`condition.ts:14`, `RELATIVE_DATE_OPS` at `condition.ts:24`), and `validate.ts:2162-2185` rejects it on a `datetime` field ("can only be compared with a date field"). A date bound cuts the day, not the last 24 hours. They compute `Date.now() - 24h` when building the document set, so a page left open keeps its bound, and the label carries the wall-clock instant.

**Problem.** "The last N hours" is the commonest audit/log window and has no spelling. The load-time shim also puts a moving value into a committed document.

**Options.**
- (a) A sibling value `{ "hoursFromNow": <whole number> }` (negative is the past, mirroring `daysFromToday`), valid on `datetime` fields with the `RELATIVE_DATE_OPS` comparison ops only, not in `in`/`contains`. Resolved by the runtime at query time to the stored `...Z` instant, so the adapter receives a concrete instant (as with dates, see `docs/records-protocol.md`).
- (b) The same with the review UI's spelling, `{ "hoursAgo": 24 }` (non-negative only). Reads naturally, but cannot express "starting in 2 hours" and diverges from `daysFromToday`.
- (c) Let `{ daysFromToday }` apply to `datetime` as a local-midnight bound. Cheapest, but it is the thing the consumer already said does not help.

**Recommendation.** (a). One more relative shape, one more whole-number range check, no new operator.

**Contract impact.** `core`: `condition.ts` (the value type and its guard), `validate.ts` (the relative-value checker at `:939` and the field-type check at `:2162`), `describeContract` text at `contract.ts:564`. `runtime`: resolution beside the relative-date resolution. `renderer`/`components`: none; datetime quick filters stay from/to ranges. `testing`: contract-kit leaf fixtures. `specVersion`: next.

### 3. Select options that live on the server

**Source.** The review UI, two lanes: filter choices (agents, namespaces) come from the API, but `StaticOptions.source` is `"static"` only (`document.ts:72`; the doc comment on `:70` already says "Dynamic sources come later"). They fill the real lists at host build time and a loader replaces the placeholder before validation (`documents.ts:6`).

**Problem.** Build-time filling works, but the committed document carries a placeholder and the loader owns a validation-order trick. Against that, a dynamic source touches more than the picker: `validateRecord` checks `field.options.values.includes(value)` (`runtime/src/record.ts:~71`), `recordJsonSchema` emits the options as an `enum`, the state grid enumerates options, and board columns read them.

**Options.**
- (a) `{ source: "entity", entity, labelField, valueField? }`: the options are the records of another entity. Every consumer of `options.values` above has to learn to run asynchronously.
- (b) Allow `reference` fields as quick filters (today refused at `validate.ts:1985`): the filter becomes a picker over the target entity, matching on the stored id. No new option source; the choice lists already load from the form's data source.
- (c) Ratify build-time filling as the documented pattern (in the README and `docs/records-protocol.md`), the way 0009 item 2 ratified the union.

**Recommendation.** (c) for now, and say so loudly, as 0009 did for the union: option text is part of a document's validation story, and a server-driven list is data, which the data source and `reference` fields already model. If the owner wants an in-contract path later, (b) is the smaller one and should be tried before (a).

**Contract impact.** If (c): one documentation section, none in `core`. (b) would be `validate.ts` plus a renderer picker; (a) the largest of the three and not recommended. `specVersion`: next only for (a) or (b).

### 4. A quick filter can start with a value

**Source.** The review UI: "open on pending" needed a second table document cloned for the other state, folded into two dashboard tabs. Verified: `QuickFilter` is `{ field }` only (`document.ts:484-486`); `default` is rejected as `unknown-property`.

**Problem.** An initial filter state is something the document should declare ("what the screen offers"), and the workaround doubles the documents.

**Options.**
- (a) `QuickFilter.default?`: the value in the shape the filter already takes (a string for select/text, a boolean, or `{ from?, to? }` for ranges). Initial state only: the viewer clears it like any chip, and the renderer never persists it. It is validated like the same value in a condition (select value must be an option, and so on).
- (b) A controlled `filterValues` prop, like item 1's `drill`: host-owned, no document change.
- (c) Keep two views.

**Recommendation.** (a). Both consumers of this screen want the same first state every time, which is document data; (b) can follow if a host ever needs to restore a viewer's choice.

**Contract impact.** `core`: `QuickFilter.default` + validator, `describeContract`. `runtime`: initial quick-filter state. `renderer`: seed the state. `testing`: the quick-filter state-grid axis gains "default applied" and "default cleared". `editor`: a default input in the quick-filter row. `specVersion`: next.

### 5. A quick filter has its own label and placeholder

**Source.** The review UI: the search box's label is the entity field's label, so labelling it "Search" renames the column header with it. Verified: `label` and `placeholder` are both rejected on a quick filter.

**Problem.** The control and the column are different things to a viewer, and the field label cannot serve both.

**Options.**
- (a) Optional `label` and `placeholder` on `QuickFilter`; the field's label stays the default. Placeholder applies to text filters only.
- (b) Only `label`.
- (c) Do nothing.

**Recommendation.** (a). The same two optionals, one validator branch each; and a placeholder is the document's way to tell a viewer a text filter is a substring match.

**Contract impact.** `core`: two optionals on `QuickFilter` + validators. `renderer`/`components`: use them. `specVersion`: next, with item 4.

### 6. A column or view that cannot be sorted

**Source.** The review UI: every header invites a click the cursor-paged API cannot serve. Verified: `sortable` is rejected on a column and a view; the adapter refuses with a message ("This list is always newest first.") instead.

**Problem.** The document is where "this column sorts" is known, and the refusal lives in the server and wastes a round trip.

**Options.**
- (a) `TableColumn.sortable?: false` only.
- (b) `TableView.sortable?: false` only.
- (c) Both: the view-level flag is shorthand for every column; a column can opt out individually. A declared `sort` on an unsortable column is a validation error.

**Recommendation.** (c). The consumer asked for either; the view flag is the cheap way to say "always newest first", the column flag the cheap way to say "all but this one".

**Contract impact.** `core`: the two optionals + the `sort` cross-check. `renderer`/`components`: unsortable headers render as plain text. `testing`: the state grid already has a sort axis; one cell becomes "not offered". `specVersion`: next.

### 7. A notice beside a table

**Source.** The review UI: a "vector search is off" banner had nowhere to live; they stamped the degradation as a column on every row. Verified: the table's one notice surface is the failed-load `ErrorSummary`; a `notice` key on a table is rejected.

**Problem.** The text is not static document data. It is the *server's* statement about this answer ("served without vector search"), so a document key cannot carry it.

**Options.**
- (a) An optional `notice?: { tone: "info" | "warning"; text: string }` on the list `Page` (`data-adapter.ts:71`) and in the records protocol. The renderer shows it in a polite status region above the table, using the same registry keys as today's error summary tone; the document is untouched.
- (b) A static `TableView.notice` in the document. Fits permanent copy only, which no consumer has asked for.
- (c) Keep the host wrapper: a banner element beside `TableRenderer`, fed from the adapter.

**Recommendation.** (a). It is the smallest place the dynamic statement can live, and it matches how `can` already works: the server speaks per response, the client renders what it is told.

**Contract impact.** `core`: `Page.notice` type (no document change). `docs/records-protocol.md`: the key. `renderer`: the status region. `components`: a small notice style. `testing`: a `notice` source-state. `specVersion`: none (a protocol and type addition; see open question 5).

### 8. A server-set field is not required on create

**Source.** A workout log (F14): `Session id is required.` refuses every create from a form whose entity carries a server-generated `id` marked `required: true`. The validator loops all entity fields view-blind (`runtime/src/record.ts:46`, `field.required === true`), so a field the viewer can never fill still gates the form. They dropped `required` from the generated `id` in the entity document.

**Problem.** The document has no way to say a field is set by the server. `required` means two things at once: "must be present on a stored record" and "the person filling the form must supply it".

**Options.**
- (a) `Field.readOnly?: true` (read-only on create and update): the field is shown in tables, never in a form input; client validation and `recordJsonSchema` do not require it on write, and a write that sends it is rejected; it is allowed in `values` on reads and in conditions and bindings.
- (b) Make the validators skip any field not placed in the form's `sections` for create validation. Fixes this case but reads as magic: a form that forgets a required field silently stops enforcing it.
- (c) Reject `required` on a field named `id` and document "do not author it".

**Recommendation.** (a). It names the fact in the data model, where the server can state it once, and `required` keeps one meaning. Combining `readOnly` and `required` is allowed (stored records must have it) but never a form requirement.

**Contract impact.** `core`: `FieldBase.readOnly`, the validators (not in form `items`, not an editable column or inline edit), `recordJsonSchema`'s `required` list for writes. `runtime`: create and update validation skip it; `renderer`: tables never inline-edit it. `testing`: contract kit fixtures. `editor`: a toggle. `specVersion`: next.

### 9. The batch composer takes an initial row count

**Source.** The task app (F15 finding 4's leftover): the composer's row count is internal state (`form-renderer.tsx:81`, `useState<readonly FormState[]>([emptyFormState])`), so the state grid cannot drive a "three rows queued" state.

**Problem.** A state the grid cannot reach cannot be checked, and the first composer axis is the one most likely to hide a layout bug.

**Options.**
- (a) `FormRenderer` prop `initialRows?: number` (default 1, capped at the composer's own row cap), ignored when `view.repeat` is not `"batch"`.
- (b) A controlled `rows`/`onRowsChange` pair, like `drill` in item 1; the host owns the values too.
- (c) Nothing; hand-written drivers keep clicking "Add another".

**Recommendation.** (a). The grid needs to set a state, not own it; (b) is a bigger renderer API than the need.

**Contract impact.** `renderer`: the prop only. `testing`: one state-grid axis. No `core`, no document change, no `specVersion`.

### 10. When a quick-filter input commits

**Source.** Two reports. The task app (F15 finding 2): typing a tag into a tags quick filter does nothing until Enter (`fill` leaves 8 rows, Enter gives 1). Verified in the F15 driver's output; the components agent found chips already commit on add, so only a typed-but-unadded draft is at stake. The review UI (9E2-1): a text quick filter refires `setQuick` and `setPage(0)` per keystroke; `table-renderer.tsx:301` debounces drafts only, not quick filters.

**Problem.** The two inputs take opposite risks: text sends a request per character; tags sends nothing for a viewer who types and walks away.

**Options.**
- (a) Text quick filters debounce (default 300 ms, no document knob); a tags draft stays uncommitted until Enter or chip-add (today).
- (b) (a) plus commit a tags draft on blur: leaving the field turns the typed text into a chip, so "typed" never looks like "nothing happened".
- (c) (a) plus the tags draft filters live (debounced) without becoming a chip.

**Recommendation.** (b). Debounce is a behavior fix any renderer owner would accept; the tags blur-commit matches how a chip input already feels, while (c) makes an invisible filter state.

**Contract impact.** None in `core`/`runtime`. `renderer`: the debounce and the blur hook. `components`: the tags input exposes blur-commit. `testing`: nothing new. `specVersion`: none. (This is an owner decision because it changes what a viewer sees, not because it changes a contract.)

### 11. The record JSON Schema carries a text field's `maxLength`

**Source.** Found while fixing 9C2-Y2 (below): `validateRecord` now enforces `text.maxLength` (`0ff673e`, runtime 0.13.1), but `recordJsonSchema` in `core` does not emit `maxLength` for `text` fields, so a records server that validates with the published schema accepts what the client refuses. `docs/records-protocol.md` now tells servers to check it themselves.

**Problem.** The schema is the server's copy of the rules; a rule the client enforces and the schema omits is a drift the parity test has to list as a known difference.

**Options.**
- (a) `recordJsonSchema` emits `maxLength` for `text` fields that declare it (JSON Schema counts code points, as the runtime does).
- (b) Leave it to the protocol doc.

**Recommendation.** (a). One line in the schema builder; it closes a parity gap rather than adding a feature.

**Contract impact.** `core`: `recordJsonSchema` and its parity test. No document change; records stay valid unless they already broke the declared limit. `specVersion`: none (the document vocabulary does not change).

## Not in this RFC (fixed without a contract change)

- **Components ship no token fallbacks** (the review UI's 9C3-Y1): fixed in `@yadad/components` (`055dbf1`, a zero-specificity default-token layer in the stylesheet).
- **Action input `maxLength` is not enforced** (9C2-Y2): `validateRecord` ignored `text.maxLength` everywhere; fixed in `0ff673e` (runtime 0.13.1), which covers action input too. The components text input setting the `maxlength` attribute is a components follow-up.
- **The task app's `doneField` toggle not drawn by the component set** (F15 finding 1; the workout log's calendar version of it): renderer builds the `done` slot, the components do not render it. Fixed in the components repo.
- **Batch composer hooks are not instance-scoped** (F15 finding 3): fixed in `f7b93f1 feat(renderer): scope quick-filter and batch composer dom hooks`.
- **The state grid has no axis for saved filters, the batch composer or `doneField`** (F15 finding 4, the grid half): fixed in `013d887` and `d4ce13b`. Only the composer's row count is left (item 9).
- **Two tags inputs with no distinguishing attribute** (F14): fixed with the scoped quick-filter hooks above.

## Considered, not proposed

- **A view `filter` as a list of ANDed conditions, or `in`** (9A3-Y2): `op: "in"` and `{ op: "and", conditions }` are already valid (`CONDITION_OPS`, `condition.ts:62`); only a *quick* filter takes one value, which item 4's default does not change.
- **Interpolation in `confirm.message`** (9C2-Y4): a string template is a small expression language; AGENTS.md rule 5 forbids it. Revisit only with a typed field-reference shape and a second consumer.
- **`contains` versus `words` text-filter kinds** (9E1-Y1/Y2): the document cannot make a server do full-text search; item 5's label and placeholder let a document say "Search words".
- **Collapsible long text** (9F1-Y1): a cell/component concern. The cut length is a server transport cap either way.
- **A declarative nested-list to child-entity mapping** (9F3-Y1): it is the union verdict again (0009 item 2): the data source flattens, the document stays unaware.
- **`applySystemTheme` in `@yadad/theme`** (9C3-Y5): a theme-package helper with no contract impact; needs only an owner "go", not a decision here.
- **Danger placement for row actions** (9B5-Y2), **a count probe that retries without `limit: 0`** (9C3-Y3), **a total slot in cursor paging** (9E2-3), **a runtime `listAll` helper** (9F4-Y1): runtime and components work with no document change; not a contract question.
- **A `describeContract` check that a declared `doneField` is rendered by the installed component set** (F14): a published-set smoke fixture covering every slot is the better fix and lives in the components repo.

## Owner questions

1. **Item 1**: controlled-optional `drill` props (a), or notify-only `onDrill` (b)?
2. **Item 2**: the spelling. `{ hoursFromNow: -24 }` (a, recommended) or the consumer's `{ hoursAgo: 24 }` (b)?
3. **Item 3**: ratify build-time filling as the pattern (c), or build an in-contract source: allow `reference` as a quick filter (b), or `source: "entity"` (a)?
4. **Item 4**: initial state only (`default`), or also a host-controlled `filterValues` prop (b)?
5. **Item 7**: is a `notice` on the list page response (a protocol key, no document change) inside "the server is the only authority", and does it need a `specVersion` bump?
6. **Item 8**: `readOnly` as the name, or `serverSet`/`generated`? Should it also be refused as an inline-edit column?
7. **Item 10**: tags draft committed on blur (b), filtered live (c), or Enter-only (a)?
8. **`applySystemTheme`**: go, or leave to hosts?
9. **Item 11**: emit `maxLength` in `recordJsonSchema` (a)?

## Owner decisions

_Pending. The owner has not yet decided any item._
