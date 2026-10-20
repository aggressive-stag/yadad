---
"@yadad/testing": minor
---

`checkViewStates` now checks record actions and compare cells in every view state. A table, calendar entry or board card that offers an action the state withholds (`can.actions`, `lockedTo`, `visibleWhen`) — or hides one the state allows — is reported against `availableActions`. A compare column whose Display was handed no `diff` despite a neighbour, or a `diff` compared against nothing, is reported against `compareCells`. The fixture sweep covers `fixtures/valid` and `fixtures/valid-sets`, including the review and action sets.
