---
"@yadad/testing": minor
"@yadad/runtime": minor
---

Skipped states are no longer silent. `SkippedState` (runtime) gains `kind: "fault" | "limit"`: a fault is a state the grid could not build a valid sample for (a generated record that fails validation, no records could be generated); a limit is a declared limit of the grid (a dashboard cannot embed a dashboard, a view not among the documents, a series over a non-table, a value the field forbids). `checkViewStates` and `checkViewStatesReport` (testing) turn every fault skip into a failing result with the new check `grid-fault`, so `problems(results)` lists it. `StateCheckReport` gains `skippedStates` (`{ id, reason, kind }`), and the new option `maxSkipped` fails the report with `too-many-skipped` when the limit-skip count exceeds it.

Upgrade: expect new `grid-fault` failures in hosts whose state checks used to stay green while states were skipped. They are real grid or validator bugs, so report them rather than skipping the check. Hand-built `SkippedState` values need a `kind`.
