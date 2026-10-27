---
"@yadad/runtime": minor
---

Reference quick filters (RFC 0011 item 3). `initialQuickFilters` seeds a reference `default` as its record-id string. New `loadReferenceFilterChoices(adapter, targetEntity, referenceField, limit?)` loads the picker's choices as `{ value: id, label }` (label by the reference display rule, sorted by it, capped at `REFERENCE_OPTION_LIMIT` = 200 and flagged with `more`); choosing one filters with `{ field, op: "eq", value: id }`.
