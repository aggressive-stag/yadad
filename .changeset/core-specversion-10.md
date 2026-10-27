---
"@yadad/core": minor
---

`specVersion` is now 10. Documents stamped 0 to 9 still validate, and `migrate()` restamps them to 10 with an identity step (the shape of 8 to 9); nothing in a document has to change. The version carries the accepted items of RFC 0011 that later releases add as optional keys. `describeContract` now says what one dashboard grid row (`h`) means on screen: a fixed `--yadad-grid-row-height` (4rem by default), plus the grid gap between rows, and rows size to their content once the grid stacks.
