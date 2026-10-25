---
"@yadad/editor": minor
"@yadad/core": minor
---

Author the RFC 0008 and RFC 0009 contract keys (card 47g).

Editor: `doneField` and `maxEntriesPerDay` rows in the calendar editor; `doneField` and a
`columnsFrom` switch in the board editor; an `addForm` picker and named-filter rows (`filters`)
in the table editor; option label + colour rows in the field-options editor; per-item
`FormItem.label`, `multiline`/`maxLength`, `colorFrom`, the sub-record section builder and the
`repeat: "batch"` toggle in the form editor; and the `fieldEqFact` leaf (field + declared-fact
pickers, no free text) in the condition builder.

Core: `TextField.multiline` and `TextField.maxLength` (validated, ceiling
`TEXT_MAX_LENGTH_CEILING`), the keys the text-field panel writes.
