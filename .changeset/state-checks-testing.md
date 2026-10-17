---
"@yadad/testing": minor
---

Add `checkViewStates` and `problems`, exported from `@yadad/testing/state-checks`. They render every data and source state of a view with a `render` function the host passes in, and report states that throw, log a console error, show or lack a field against its `visibleWhen`, disagree with `requiredWhen` on the required marker, have an interactive element without an accessible name, or fail to load without a visible message.
