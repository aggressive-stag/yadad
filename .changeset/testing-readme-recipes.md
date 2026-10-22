---
"@yadad/testing": patch
---

Testing README: the `checkViewStates` example now carries a complete
`render` case for every view kind — form drafts, the calendar's
`initialMode`/`initialAnchor` with `key`, the board's `initialGroupBy`,
the dashboard's `initialTab` — builds its set with `documentSet`, and
validates the page's slice with `validateDocuments`. Plus a "what state
checks don't check" list. A consumer used to find these recipes by
failing; the sample is a test in the renderer package, so it cannot rot.
