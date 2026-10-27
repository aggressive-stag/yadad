---
"@yadad/testing": minor
"@yadad/runtime": minor
---

The state grid reaches the RFC 0010 states. A table whose quick filter declares a `default` gains the `quick` axis ("default applied", "default cleared"; `TableStateRender.quickDefaults`), and a table gains the `notice-info` and `notice-warning` source states (the state adapter's lists carry `notice`, and the new source value is part of `SourceState`). The checks gain `sort-offered` and `sort-missing` (a header is sortable exactly when the view and the column allow it), `notice-missing` and `quick-default`. A host with a hand-written table must draw the page notice, or skip `notice-missing`. The mock registry's text input renders `placeholder`.
