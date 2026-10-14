# RFC 0003: Row drill-down

- Status: Draft, needs owner decision
- Touches: `core` (table view, validator), `runtime` (binding to filter), `renderer` (table, dashboard, navigation), `editor` (table panel), registry contract (maybe one `layout` key)
- Bumps `specVersion` (0 to 1) with a `migrate()` step and a before/after fixture pair.

## Summary

Add an optional `rowAction` to a table view: clicking (or pressing Enter on) a row opens another view, scoped to that row. Scoping is declared as typed bindings, `{ field, to }`, which add `eq` conditions to the target view's filter using the clicked row's values. The target can also be a form that edits the clicked record. No parameterized view documents, no navigation language, no new condition syntax.

## Motivation

Documents are static: a table shows a fixed set of rows and nothing links one view to another. Generic cases:

- A summary of items; click an item to see its history (the same entity filtered by the clicked row's value).
- A list of customers; click one to see that customer's orders (a different entity, filtered by a reference).
- A list of tasks; click one to open an edit form for that record.
- A dashboard with a table widget; click through to a full-size filtered table.

Without it, the user has to re-enter the value as a quick filter by hand, or the host writes custom navigation code outside the documents.

## Detailed design

### Document shape

```jsonc
{ "kind": "table", "id": "exercises_summary", "entity": "workout_set", ...,
  "rowAction": {
    "open": "exercise_history",          // id of a table or form view
    "bind": [ { "field": "exercise", "to": "exercise" } ],
    "mode": "replace"                    // "replace" | "dialog"; default "replace"
  } }
```

- `open`: the target view id. A table target is shown filtered; a form target is opened to edit the clicked record (see below).
- `bind`: a list of `{ field, to }`. `field` is a field of the clicked row's entity (the source table's); `to` is a field of the target's entity. At open time, for each binding, the target's effective filter becomes its own fixed `filter` AND `eq(to, row[field])`. An empty row value becomes `empty(to)`. Bindings are applied by the runtime on top of the target's document; the document itself is never modified.
- Source and target may be different entities (the customer to orders case), joined only through the bound values; the validator checks the `field` exists on the source entity, `to` exists on the target entity, and that their field types are compatible (same type, or a `reference` to the source entity's id is out of scope here).
- `mode: "replace"` swaps the table in its container for the target with a Back control; `"dialog"` shows it in a dialog. The first slice implements `replace` only.
- Back restores the previous view with its page, sort and quick filters (state kept above the table, not remounted from scratch).

### Targets

1. **Table target:** the table renders as usual, with the extra binding filter applied and shown as read-only "chips" (for example `exercise = Squat`) so the user sees why rows are limited. Quick filters on the target still work, narrowing further. The bound fields' quick filters, if any, are hidden or disabled.
2. **Form target (edit record):** the row action is `{ "open": "edit_set", "edit": true }` with no `bind`. The validator requires `edit: true` exactly when the target is a form, and the form must be on the same entity as the table. The clicked record is loaded by id into the form (update with `baseVersion`, existing conflict handling).
3. **Dashboard target:** out. A dashboard has no entity to bind to, and parameterizing widgets is the general parameterized-view problem; see Alternatives.

### No cycles

The validator walks `rowAction` chains across a set (`validateDocuments`): a chain may not revisit a view already opened (A to B to A is `invalid-value`), and its depth is limited to 3. The row binding semantic keeps the graph small and checkable.

### Where it works

- A table on its own page: drilling replaces it in place.
- A table inside a dashboard widget (`widget: "view"`): the target replaces that widget's contents inside its grid cell, with Back. The grid layout does not change. A larger "open in dialog" is slice 2.
- Hosts that own routing can observe it: the renderer takes an optional `onOpenView(request)` prop, `{ view, bindings: { to, value }[], record?: id }`. When provided, the host decides what to do (change URL, push history); when absent, the renderer handles it internally. This keeps URLs/deep links a host concern and keeps routing out of the documents, consistent with "no API URLs in documents".

### Data adapter and protocol

None. The target's filter is an ordinary `Condition`, sent through the existing `filter` query parameter, and form-edit uses `findOne`/`update`. No new endpoint.

### Renderer, registry, editor

- Table rows become interactive when `rowAction` is set: a clickable row with `role="link"`-like semantics, focusable, Enter/Space activates, an accessible name that says what opens ("Open history for Squat" built from the target view's `title` and the first bound value). Inline-edit cells keep their own behavior and do not trigger the row action.
- Registry: the `Table` layout component receives `onRowActivate?` and `rowActionLabel`; the engine does not render a link itself. `Dialog` (slice 2) would be one new `layout` key.
- Runtime: a pure `bindFilter(target, row, bindings)` that returns the condition. Unit-tested without a DOM.
- Editor: the table panel gets a "Row action" section: target view picker (table and form views), bindings (source field to target field pickers, type filtered), mode. Emits JSON Patch.

## Fit with the hard rules

- No string expressions and no formula: bindings are `{field, to}` pairs; the filter is the existing AST.
- No escape hatches: no params bag, no templated URLs; one closed shape. Registry keys only; a view id is an id, not a path or component name.
- Documents stay the contract and stay static: the runtime computes a derived filter at open time; nothing is written to the document.
- `core` gains one optional table property and its validation, so `specVersion` 0 to 1, identity `migrate()` (additive), before/after fixtures, valid and invalid fixtures (unknown view, field mismatch, cycle, depth, form target without `edit`).
- Dependency direction preserved: types and validation in `core`; `bindFilter` in `runtime`; navigation state in `renderer`.

## Alternatives considered

- **Parameterized views**: a view declares `params` and conditions take `{ "param": "exercise" }` as a value. More general (dashboards, forms, multiple uses of a param, defaults), but it changes `Condition` (shared with `visibleWhen`, the editor's condition builder and the server's filter whitelist), needs a param-supply protocol for every entry point, and invites a mini language. It also collides with relative-date values being added to conditions (`daysFromToday`): both would then be value references and should be designed together. Recommendation: do the binding form now; if a second use for params appears, reopen as its own RFC.
- **Quick filters as the mechanism**: drill-down could just set the target table's `quickFilters` (field to value). That is nearly this design, but quick filters match text by substring and are viewer-editable; an exact, locked scope is needed for a history view.
- **A `link` column type**: per-cell links work for navigation but not for "click anywhere on the row" and keep the action out of the table's single place in the document.
- **Host-only**: the host listens to row clicks and routes itself. Possible today only if the renderer exposes row events, which it does not; `onOpenView` here supplies that hook while the documents carry the default behavior.

## Phasing

1. **Slice 1:** `rowAction` with a table target, `replace` mode, `bind`, Back, validator checks (existence, types, cycle, depth), `bindFilter`, mock-registry render test, editor panel, fixtures.
2. **Slice 2:** form target (`edit`), `onOpenView` host hook, `dialog` mode and its `layout.Dialog` key.
3. **Later:** dashboard-in-cell navigation polish; deep links via the host hook.

Where I would stop: one hop at a time with fixed bindings, no parameters, no forms prefilled from the clicked row (creating a new child pre-filled with a reference is RFC 0002's territory), no drill into dashboards.

## Open questions for the owner

1. Is binding-based scoping enough, or do you want general parameterized views now (and relative-date condition values redesigned alongside)?
2. `replace` with Back inside the same container, `dialog`, or both in slice 1? Dialog costs a new registry layout key and a components-repo change.
3. Should the engine own back-stack and URL history, or stay with the `onOpenView` host hook (proposed)?
4. Should form-edit be part of this RFC, or stay a separate table feature (an "edit record" row action)?
5. Is a depth cap of 3 and "no revisits" right, or should chains be unrestricted since each hop is a fixed binding?
