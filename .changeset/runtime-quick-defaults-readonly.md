---
"@yadad/runtime": minor
---

`initialQuickFilters(view, entity, timeZone)` returns the quick-filter state a table opens with, seeded from each filter's `default` (a boolean as "Yes"/"No", a range as `quickRangeKey("from"|"to", field)` values, a datetime bound as local time in the zone); nothing stores it. `validateRecord` skips `readOnly` fields for the required check and refuses a write that sends one ("<label> is set by the server"), agreeing with `recordJsonSchema(entity, { mode: "write" })`; `submitEdit` no longer carries a served read-only value into the merge.
