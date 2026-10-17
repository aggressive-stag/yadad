---
"@yadad/testing": minor
---

Add `createStateAdapter(seed, options)`: a `DataAdapter` seeded with a view state's records (or a record list) that can load forever, fail every read with a message, refuse writes with a 400 (field error) or 403, or conflict on writes with a 409, and be switched while a test runs. Add `sourceStates(viewStates(...), documents)`, which adds a `source` axis (`ready`, `loading`, `error`, `refused`, `conflict`; only the ones that make sense for the view) to the data states from `@yadad/runtime`. `@yadad/testing` now depends on `@yadad/runtime`.
