---
"@yadad/core": minor
---

Add relative dates to conditions: a comparison on a date field may take `{ "daysFromToday": N }` as its value. The validator rejects non-integers, non-date fields, and use in `in`/`contains`. `specVersion` is now 1 (version 0 documents stay valid), `migrate()` upgrades older documents, and `describeContract()` reports the relative date.
