---
"@yadad/runtime": patch
---

Keep working with the RFC 0007 contract: `validateRecord` accepts a `datetime` value only in the canonical `YYYY-MM-DDTHH:MM:SS.sssZ` form, the HTTP adapter sends `cursor=` for a cursor query, and code that reads `Page.total` now copes with a page that has none (a count without a total reads zero until cursor paging lands). The state grid generates a `datetime` value.
