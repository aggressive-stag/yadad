---
"@yadad/testing": minor
---

`checkViewStatesReport(options)` reports what the state grid actually
covered: `{ results, states, strategy, complete, axes, skipped }`. A green
`checkViewStates` on a view with thousands of combinations may prove only
a pairwise cover — above `limit` the grid is not every combination, and
the results used to read like it was. `checkViewStates` keeps its
signature and returns the report's `results`; `states` sizes test
timeouts honestly.
