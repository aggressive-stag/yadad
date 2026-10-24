# RFC 0009: Consumer feedback round 2 — the task app's SPA audit

- Status: Draft (2026-10-24). Items 1–7, all drafted.
- Touches: `core` (a new condition leaf, `steps` sub-records, `quickFilters` naming, possibly a form repeat), `runtime` (condition evaluation, the state-grid axis for the new leaf, quick-filter helpers), `renderer` (the sub-record section, saved-filter chips, the composer), `testing` (contract kit, state checks), `editor` (the matching editors), `docs/records-protocol.md` (the membership verdict), and the components repo (chips, repeatable rows).
- `specVersion` stays at **7** while this is a draft (read `SPEC_VERSION`; 0008's 6→7 step has landed). The bump to 8 happens once, when the first accepted item lands, with an identity `migrate()` step and a before/after fixture pair — the same rule 0008 followed.

## Summary

The household task app audited its whole single-page app against the shipped packages (thirteen screens, every capability claim read from the installed `.d.ts` files) and asked, screen by screen, what would make it documents. Six screens are document-ready now, four are host-appropriate forever, and the remaining asks collapse to a short list. RFC 0008 already owns several of that list — the time-of-day field is its item 14, and this RFC deliberately does not re-draft anything 0008 covers (row-id bind, reference display, `doneField`, `addForm`, labelled selects, calendar caps, colour-from-target, per-field `can`, board columns from reference options, `layout.Pager`, headings, multi-line text, `time`, `tags`). What is left is the contract surface for: a record field compared to a viewer fact, one list over two entities, sub-record checklists, a batch composer, named filters, a cross-field search box, and an explicit verdict on membership editing.

Nothing here moves authority: the server remains the only one, documents decide what the screen *offers*, and `can` and conditions only narrow it (RFC 0006). No string expressions, no free-form props, no `custom` field type, no component names in documents. The write-only/masked-field row from the same audit is *not* drafted here: secrets must not pass through a document system that logs drafts, and that is a boundary, not a gap.

### 1. A record field may be compared to the viewer's value of a fact

**Source.** The task app's "My Day" screen (audit Screen 2): "open no-due-date tasks from *the viewer's home list*". `home` is a per-user fact a `viewer` document can declare, but a condition leaf compares a record field only to a literal, and `viewerIn` reads the viewer's *own* value for a fact — it names no record field. The two read alike in prose and are not the same thing; the audit asks for the names to be settled before anyone builds it.

**Problem.** One arm of one screen, plus any future "my ___" view: a filter that is legal per-user and illegal as a literal. Without it the whole screen stays host code.

**Options.**
- (a) A new leaf on the record condition: `{ op: "fieldEqFact", field, fact }` — true when `record[field]` equals the viewer's value of the named fact. `viewerIn` keeps its meaning untouched; the new leaf names both sides in its own name.
- (b) Overload `viewerIn` with an optional `field` — rejected: it would mean "the viewer's value is in…" and "the record's field equals the viewer's value" in one name, exactly the prose collision the audit flagged.
- (c) Host-side filtering in the adapter — rejected as the *contract* answer: it hides a viewer-dependent rule from the document, the state grid and the validators.

**Recommendation.** (a). The fact must be declared in the context's `viewer` document (same check `viewerIn` passes); the value comparison reuses `eq`'s type rules, including the reference case (a reference field compared to a fact whose declared options are record ids — which is what "home list" is). The state grid gains one viewer axis per fact a view compares this way, next to `viewerIn`'s axes.

**Contract impact.** `core`: the leaf in `Condition`, `CONDITION_OPS`, validators (field exists on the view's entity, fact exists and is declared on the context's `viewer` document, types line up), `describeContract`. `runtime`: `evaluateCondition`, quick-filter/state-grid axis extraction (`conditionFields` today skips `viewerIn` because it names no field; this leaf names both and must be walked on both sides). `renderer`: nothing (conditions arrive pre-evaluated). `testing`: contract-kit leaf fixtures, `checkViewStates` for the new axis. `editor`: the condition builder gets the leaf wherever `eq` appears. `specVersion`: 8 (once, with the first accepted item).

### 2. One table over two entities (the "My Day" union)

**Source.** The same screen's other arm: tasks *and* occurrences in one list — one list that pages and sorts as a unit and where a checkbox works across both. The Completed screen solved the same problem by *making* a union: a read-only `completion` entity the host's adapter serves from shared SQL, in production since the round-2 lane.

**Problem.** A view document names exactly one `entity`. Two widgets stacked (what the shipped dashboard does) page and sort independently and cannot act as one list.

**Options.**
- (a) A table whose `dataSource` answers a union of N entities with a shared column vocabulary — a document would have to name the entities and map each column onto each of them; every validator that resolves a field against "the entity" (`checkViewFields`, quick filters, sort, rowAction bind, compare columns, the record-action refs) grows a per-entity branch, and the server contract grows a cross-entity query the adapter may not be able to answer at all.
- (b) Keep the host-side union entity as the *documented pattern*: a read-only entity whose adapter serves the union (the `completion` precedent, proven in production), one document, one entity, all validators unchanged.
- (c) A `union:` clause on the table that names sibling *documents* (entity+view pairs) and a shared sort — the middle road; the renderer interleaves pages client-side. Honest flaw: paging a union from N independent adapters means "page 3" is undefined without a shared total; it degrades the moment one side lags.

**Recommendation.** (b), said loudly: the union belongs in the data source, not the contract. The audit's own evidence is that the workaround *is* the production shape, and it costs the contract nothing. Revisit (a) only when a second consumer hits a union (b) genuinely cannot serve; until then the protocol should document (b) as the pattern in `docs/records-protocol.md` rather than grow a second entity model.

**Contract impact.** None if (b) is accepted: one documentation section ("union lists are read-only host entities"). (a) or (c) would be the largest contract change since the viewer RFC and are not recommended.

### 3. A checklist inside a record (sub-records)

**Source.** The task panel's centrepiece (audit Screen 6): per-task steps, each with its own id, done flag, title and order, edited inline with focus staying on the row being typed. The audit's own question: is a checklist a *field type* or an *entity with an embedded table*, in the author's head?

**Problem.** `FieldValue` is `string | number | boolean | null` — no array, no nested record — so neither shape is legal today. This is the load-bearing third of the task panel; without it the screen stays hand-built.

**Options.**
- (a) A `steps` field type carrying `[{id, done, title}]` inside `RecordValues` — rejected: it smuggles a record-with-identity into a value bag the whole protocol treats as atomic (optimistic concurrency, `can`, the Editor's JSON panel, `recordJsonSchema`), and a step's own history becomes invisible to the server that owns it.
- (b) A declared sub-record section on the *form*: the form names a second entity with a `reference` back to the form's entity (`{ entity: "step", via: "task", titleField, doneField, orderField? }`), rendered as an inline repeating editor; creates/updates go through the adapter as ordinary writes to `step`, optionally inside RFC 0002's parent-children transaction when the parent itself is being created.
- (c) Two documents side by side (a form + a table of steps in a dashboard grid) — works visually today and should keep working; it fails the "one screen, focus preserved, add-a-step-while-editing-the-parent" test, which is the actual ask.

**Recommendation.** (b), and answer the audit's question directly: a checklist is an **entity with a declared sub-record section**, not a field type. The step keeps its own record, its own `can`, its own version; the form only *hosts* the editing affordance. The renderer keeps focus on the row being typed the way the table keeps focus after an action (the round-3 focus return); an added step lands focused. (a) stays rejected even as sugar.

**Contract impact.** `core`: `FormView.subRecords?: { entity, via, titleField, doneField, orderField?, addLabel? }[]` + validators (the entity exists, `via` is a reference field on it pointing at the form's entity, title/done/order fields exist with the right types). `runtime`: ordering helper; sub-records enter the state grid through the existing record axes (a locked `can` on the step record is already a state). `renderer`: the repeating section in the form, keyboard add/edit/delete. `editor`: the section editor. `testing`: contract kit + state checks. `specVersion`: 8 (with the first accepted item).

### 4. A batch-create composer

**Source.** The composer at the top of every list (audit Screen 12): multi-line quick-add, batch create on Enter, prefix sugar (`#`/`!`) that stays host code either way. The batch verb already exists — `BatchOperations.create` takes `RecordValues[]` and placement is proven.

**Problem.** No renderer mounts a widget over `batch create`: a form's submit is exactly one write, so the last document-ready screen still needs ~40 lines of host UI.

**Options.**
- (a) A form-level repeat: `TableView.addForm` already opens a form to add a row; give the *form document* a `repeat: "batch"` flag — after a submit the form stays open, clears, and each submit queues one write; on blur/leave (or an explicit "Add N" press) the queue flushes through `batch create`. One document kind, one new optional.
- (b) A separate composer widget kind in the dashboard grid — rejected first cut: the composer lives *beside a table*, not in a grid, and a new widget kind drags in grid/registry surface for what is a form mode.
- (c) The host keeps the ~40-line composer against `batch create` — the honest second option, and the audit itself says it weakens the document-ify case to "don't".

**Recommendation.** (a) if this earns an accept at all; otherwise (c) with the audit's blessing. A repeatable form reuses every form validator, every field widget, and the existing write path; the only new contract word is `repeat`, and the only new runtime verb is already shipped.

**Contract impact.** `core`: `FormView.repeat?: "batch"` + validator (not with `create`-less forms; not together with a `subRecords` section — a parent with children is one transaction, not a batch of parents). `runtime`: batch flush helper over `BatchOperations.create`. `renderer`: keep-open-and-clear submit path, a queued-count control, and the focus return already shipped for actions. `editor`: one checkbox. `specVersion`: 8 (with the first accepted item).

### 5. Named saved filters

**Source.** All five smart lists (audit Tally: "named saved filters (quickFilter is field-only)"). A `QuickFilter` is `{ field }` — the chip exists, but a *named, pre-combined* filter set (like "open + this list + starred") cannot be a document concept; today every saved slice becomes its own view document.

**Problem.** Without named filters, "save this slice" pushes hosts to mint near-duplicate view documents (five smart lists are five files), which the validator then treats as five unrelated surfaces to keep in sync.

**Options.**
- (a) `TableView.savedFilters?: { id, label, filter: Condition }[]` — document-level named queries a chip row offers beside the field quick-filters; one is active at a time, `and`-combined with the view's fixed `filter`.
- (b) Host-owned bookmarks (the host stores `{viewId, quick}` per user, today's mechanism) — honest, but invisible to validators, the state grid, and every other consumer.

**Recommendation.** (a), with the guard that a saved filter is *only* a `Condition` over the view's entity — the same leaf grammar the view's `filter` already uses, checked by the same `checkCondition`, so nothing new enters the language. This is query *shape*, not query *state*: it declares what the screen offers, which is the line documents are allowed to draw. Per-user persistence of *which* one is chosen stays the host's.

**Contract impact.** `core`: `SavedFilter` + validator (id unique among `quickFilters`-free names, condition fields on the entity). `runtime`: helper to combine the active saved filter. `renderer`: a chip row (reuses quick-filter chips). `editor`: a named-filter editor over the existing condition builder. `specVersion`: 8 (with the first accepted item).

### 6. A cross-field search box

**Source.** The All Tasks screen (audit Screen 5): live search across title + notes + tags. A document can pre-filter with one `contains` on one field; the box itself is host code translating to `Query.filter`.

**Problem.** Cosmetic by the audit's own tally: the adapter hook exists, the widget doesn't.

**Options.**
- (a) `TableView.searchFields?: string[]` — the renderer shows one box; each keystroke becomes `{op:"or", conditions:[{op:"contains",field:f,value:v} …]}` over the named fields, applied as the viewer's own filter contribution.
- (b) The host keeps translating its own box into `Query.filter` (today).

**Recommendation.** (b) for now — the cheapest honest option; the audit rates it cosmetic and (a) is a 20-line renderer convenience, not a contract gap. Drafted here so the *rejection* is recorded rather than drifting. If two consumers ask for the same box, (a) becomes a micro-RFC against this item.

**Contract impact.** If (a) ever lands: `core` one optional `string[]` + validators; `renderer` the box. `specVersion`: would ride whatever item bumps it.

### 7. Membership editing: boundary, with a named exception

**Source.** The share popover (audit Screen 9): members with add/remove, "Leave this list". The audit asks explicitly: deliberately outside the protocol, or just unbuilt? It filed it as boundary, flagged for the author.

**Problem.** `RecordPermissions.can` is read-only output from the server; nothing in the contract edits *who may see* a record. The audit correctly notes a `member` table could render add/remove for owners, and that "Leave this list" looked like it maps to no document verb.

**Verdict (this item asks the owner to ratify it, not to build it).** Access *control* is the server's and stays out of documents — `can` is an output by design (RFC 0006). But membership *rows* are ordinary records: a `member` entity (`reference list`, `reference person`) as a table is a legitimate document, and the "Leave this list" button is a record action on the member's own row whose server-side check enforces "only that member (or the owner)". That is the whole feature, expressed with shipped verbs — what was missing from the audit's read is that record actions (RFC 0007) cover it. The boundary stands for *permissions*; it never excluded *rows about people*.

**Contract impact.** None. `docs/records-protocol.md` gains one paragraph: membership is records, authorization is not; the leave pattern is a record action, and the server is still the only authority.

## Owner questions

Per-item accept/reject, as with 0008. The decisions that need an owner, not an agent:

1. **Item 1** — accept the leaf, and accept the name `fieldEqFact` (the audit specifically wants the name settled before anyone codes)?
2. **Item 2** — accept "union lists are read-only host entities" as the documented pattern and close the union ask, or keep (a) alive on the board?
3. **Item 3** — confirm the verdict: checklist = entity + declared sub-record section, never a field type. This is the biggest surface in the RFC; it is also the audit's "shortest path" claim.
4. **Item 4** — widget or host: accept `repeat: "batch"`, or record "the host keeps the ~40-line composer" as the answer?
5. **Item 5** — is a document-level named filter inside "documents declare what the screen offers", or does it belong to the host's bookmarks?
6. **Item 6** — ratify the deferral (or say build it).
7. **Item 7** — ratify the boundary-plus-exception paragraph for `docs/records-protocol.md`.

`time`-of-day is RFC 0008 item 14 — not re-drafted here; the task panel's `due_time` waits on it, not on this RFC.
