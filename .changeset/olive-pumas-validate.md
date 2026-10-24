---
"@yadad/editor": patch
---

The states preview runs the core set validators on the draft: a broken reference — a field a view still names after the entity dropped it, or any cross-document break `npm test` would catch — is named in the status line as soon as the draft changes, instead of surfacing only after the copy-and-test round trip. The host's `checkStates` hook still adds per-state host checks on top.
