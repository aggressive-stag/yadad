---
"@yadad/editor": patch
---

One `runEdit` owns what a rejected save does (card 45e): the four view editors (`board`, `calendar`, `form`, `table`) each carried the same nine-line `run` callback, and each `applyAndAnnounce` repeated its apply-and-report half. The rule and the apply step now live in `save-result.ts` — `runEdit`, `editRunner`, `applyEdit` — and the editors bind them. `viewer-panel`'s `run` sets the session only after its conflict check, so it stays its own function (renamed `runViewerEdit` to say so). No behaviour change is intended; if a rejected save announces itself differently anywhere, that is the bug.
