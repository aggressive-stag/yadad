---
"@yadad/core": minor
"@yadad/runtime": patch
"@yadad/renderer": patch
"@yadad/editor": patch
"@yadad/testing": patch
---

RFC 0008 view/field contract keys (validator side; the renderer follows in its own card).

- `StaticOptions.values` entries may now be `{ value, label?, color? }` as well as plain strings (item 5): `label` defaults to `value`, `color` is a `#RRGGBB` display hint. Stored records, filters and conditions keep using `value`. Helper `optionValue()` returns the stored value of either form.
- `FormItem.label?` relabels a field in one form view (item 6).
- `CalendarView.maxEntriesPerDay?` replaces the fixed "+N more" cutoff of 3 (item 7); default is still 3, so no document changes meaning.
- `ReferenceField.colorFrom?` names a colour-shaped field on the target (item 8); the renderer consumes it later.
- `TableView.addForm?` names a form view over the same entity the table offers as "Add" (item 4); the set validator checks existence, kind and entity.
- `BoardView.columnsFrom?: "options" | "records"` opts a reference grouping into target-derived columns (item 10); default `"records"` is today's behaviour.

No `specVersion` bump: every new key is optional and old documents validate and render exactly as before.
