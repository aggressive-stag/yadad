---
"@yadad/renderer": patch
---

A board grouped by a reference field no longer stays `aria-busy` forever. It is busy only while a target fetch it started is in flight; the default records grouping and an unwired target (which still warns) are not busy.
