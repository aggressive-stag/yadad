---
"@yadad/runtime": minor
---

Add `createHttpAdapter({ baseUrl, fetch?, credentials?, headers? })`, a `DataAdapter` client for the HTTP records protocol. The memory and key-value adapters now implement record versions, stale `baseVersion` conflicts, atomic `batch`, and unknown-field validation. Form saves pass the loaded record's version and report adapter failures through the existing form error display.
