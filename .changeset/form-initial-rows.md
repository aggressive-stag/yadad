---
"@yadad/renderer": minor
"@yadad/runtime": minor
"@yadad/testing": minor
---

`FormRenderer` takes `initialRows` (default 1, clamped to 1..50, the new `BATCH_ROW_CAP`) so a batch composer can start with several rows; "+ another" now stops at the cap. The runtime's state grid gives a batch form a `rows` axis (one row, three rows queued) and the form render carries `rows`; pass it to `initialRows`.
