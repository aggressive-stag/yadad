---
"@yadad/runtime": minor
---

Paging without a total (RFC 0007): the memory and key-value adapters take `paging: "cursor"` and answer like a counting-free server — no `total`, an opaque `next` (null on the last page) — while the default keeps offset paging with `total`. The HTTP adapter sends `cursor=` instead of `offset=` for a cursor page (never both) and passes `next` and an optional `total` through. A `count` whose server never counts walks the pages up to the 5,000-record ceiling and reports what it read, `partial` at the cap. The calendar and board loaders follow `next` up to their existing caps.
