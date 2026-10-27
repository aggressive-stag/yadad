---
"@yadad/core": patch
"@yadad/runtime": patch
"@yadad/renderer": patch
---

A row action binding may name the reserved field `id` (RFC 0008 item 1), which the validator used to reject. It binds the record's own id to a `text` field, or to a `reference` to the same entity, and is used only when the entity declares no field named `id` (a declared field wins). `@yadad/runtime` adds `bindingValues(record, entity)`, the values a row action's bindings read; the table, calendar and board renderers use it.
