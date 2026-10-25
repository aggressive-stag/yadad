---
"@yadad/core": patch
"@yadad/editor": patch
---

Add the `time` and `tags` field types (RFC 0008 items 14 and 15).

- `time` stores a time of day as `"HH:MM"` — 24-hour, zero-padded, no day and no zone. It compares with eq/neq/gt/gte/lt/lte/in/empty/notEmpty (never `contains`, never a relative date), takes optional `min`/`max` bounds and a `step` in whole minutes, and can be an action input. A `time` field is never a stand-in for `date`: it cannot place a calendar entry, and `due_date` plus `due_time` stay two fields.
- `tags` stores an array of non-empty strings in the order entered — the only field type whose value is a list. `contains` and `in` match ANY element (wrap in `not` for the negation); it has no ordering, so gt/gte/lt/lte are refused. It cannot be a sort key or a board `groupBy` (a card carries many tags and a column needs one value per card), and it declares no properties beyond label and required — no options, static or from an entity.
- `recordJsonSchema`: `time` is a string with the `HH:MM` pattern; `tags` is an array of string with `uniqueItems`. `validateRecord` is the step gate and leaves duplicates to the input, so the two deliberate divergences are pinned in the parity table.
- Editor: both types appear in the new-field type menu with no property panel of their own, and the input/display dispatcher routes them through the registry. The mock registry drives them with a native time box and a comma-separated text box; the real widgets (including the tags chips input) ship with the components repo's card 23a. `tags` is not an action input until that chips widget exists.
