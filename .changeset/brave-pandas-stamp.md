---
"@yadad/core": minor
---

`specVersion` 8 (D49): an identity `migrate()` step for everything RFC 0008 and RFC 0009 accepted, plus the `time` and `tags` field types. Every item landed optional and additive, so every version 7 document stays valid and `migrate()` only stamps the version.

This commit also completes RFC 0008 item 3, which card 47a's commit left unlanded: `doneField` on `CalendarView` and `BoardView` (the id of a boolean field; the entry/card renders a completion toggle that patches just that field through the adapter's normal save, disabled without `can.update`). The board's `doneField` may not be one of its `groupBy` fields. The contract tables also gain the rows 47a omitted for `addForm`, `maxEntriesPerDay`, `columnsFrom` and `doneField`, so `describeContract()` now reports every key the validator accepts.

Fixtures: a 7→8 before/after pair under `fixtures/migrate/`, a whole-set v8 document exercising the new keys (`fixtures/valid-sets/rfc-0008-9-v8.json`), and a record with a `time` value and a `tags` list (`fixtures/data/record-time-tags.json`).
