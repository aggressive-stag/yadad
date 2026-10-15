---
"@yadad/core": minor
---

Add the `reference` field type (RFC 0002 slice 1): `{ type: "reference", entity, display? }` stores another entity's record id. The validator checks the target entity and display field across a set and rejects reference fields as quick filters, table sort keys and in ordering conditions. The registry gains the `reference` key, whose Input gets the picker options and whose Display gets the resolved label (`ReferenceOptions`, `ReferenceInputExtras`, `ReferenceDisplayExtras`).
