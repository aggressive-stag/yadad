---
"@yadad/testing": patch
---

`checkViewStates` no longer hunts for a tab button that cannot exist:
when the viewer sees exactly one tab the dashboard renders no strip, so
the state opener returns instead of failing with `no tab named … to
open`. The case it guards is a viewer whose only visible tab is not the
document's first — no current fixture has that shape; the guard is
defensive. Sweeps of one-tab dashboards stay green either way.
