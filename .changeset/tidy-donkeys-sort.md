---
"@yadad/renderer": minor
"@yadad/runtime": patch
"@yadad/core": patch
"@yadad/testing": patch
---

RFC 0009 renderer surfaces (items 3, 4, 5) — the three build items, on the contracts 47c landed.

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
