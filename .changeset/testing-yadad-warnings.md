---
"@yadad/testing": minor
---

`console.warn` is now collected beside `console.error`: a warning whose
message starts with `yadad:` — the renderer's own signal for wiring
mistakes, like a reference column whose target entity was never passed —
becomes a `yadad-warning` problem instead of scrolling past a green run.
Other code's warnings reach the console untouched. A consumer's state
checks now catch a page wired that way.
