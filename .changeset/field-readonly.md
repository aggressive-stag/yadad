---
"@yadad/core": minor
---

An entity field may declare `"readOnly": true` (only `true` is accepted): the server sets it, such as an id or a created-at. A read-only field is valid in table columns, conditions and bindings, and may also be `required` (stored records carry it), but a form item, an editable column or an inline edit that names it is a validation error saying the field is read-only. `recordJsonSchema(entity, { mode: "write" })` returns the create/update body shape, which leaves read-only fields out of `properties` and `required` so a write that sends one is rejected; the default stored shape is unchanged apart from a `readOnly: true` annotation on those properties. `describeContract()` documents the flag. The runtime does not skip it on create and update yet.
