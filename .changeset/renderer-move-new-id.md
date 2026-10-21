---
"@yadad/renderer": patch
---

A move or update whose saved record comes back under a **new** id now
shows exactly one copy. The renderers matched the response on
`saved.id`, so a records host whose ids encode the moved value
(occurrence ids like `3:2026-10-19` -> `3:2026-10-24`) matched nothing:
the old copy stayed under its old day or column, the new one was never
added, and the cleared pending flag left nothing on screen saying the
move happened. The record the renderer sent is replaced by the saved
one, and a saved id that collides with another loaded record drops the
duplicate.
