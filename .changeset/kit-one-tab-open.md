---
"@yadad/testing": patch
---

`checkViewStates` no longer hunts for a tab button that cannot exist: a
dashboard showing the viewer exactly one tab has no strip to click, so
the state opener returns instead of failing with `no tab named … to
open`. Sweeps of one-tab dashboards (and of multi-tab ones whose other
tabs are viewer-hidden) stay green.
