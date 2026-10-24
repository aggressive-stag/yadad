---
"@yadad/runtime": patch
---

The state grid builds its table shapes through `runQuery` instead of a hand-rolled copy: `matching` now follows the view's `sort` (the copy ignored it), `next` is what the matched set actually has (one record no longer claims a second page), and a filter a real adapter would reject (viewerIn) skips the state with the adapter's message instead of silently matching nothing. `runQuery` gained an optional `now` so the grid keeps its frozen clock. Generated field names are unchanged; values are now the adapter's answer, pinned by new view-states tests.
