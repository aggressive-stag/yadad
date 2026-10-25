---
"@yadad/core": minor
"@yadad/runtime": minor
"@yadad/renderer": minor
"@yadad/testing": minor
---

RFC 0008 renderer surfaces (card 47e).

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
