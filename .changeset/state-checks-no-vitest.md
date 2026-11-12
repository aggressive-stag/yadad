---
"@yadad/testing": patch
---

`checkViewStates` (`@yadad/testing/state-checks`) no longer imports Vitest: it swaps `console.error` by hand, as it already did `console.warn`, and puts back whatever was there (a host's own spy included). A host can now run the checks in a page and pass them as `StatesPreview`'s `checkStates`; the README shows how.
