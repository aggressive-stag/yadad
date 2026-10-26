---
"@yadad/runtime": minor
"@yadad/testing": minor
---

The state grid covers saved filters and the doneField toggle. Runtime: tables with `filters` get a `filter` axis and `savedFilter` on the render, and a calendar or board with `doneField` gets the `permission` axis so a disabled toggle is rendered. Testing: new state checks `saved-filter`, `done-missing`, `done-offered`; the contract kit gains Calendar and Board checks that a done toggle renders a checkbox named "Done: <label>"; the mock registry draws that shape.
