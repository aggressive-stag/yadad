---
"@yadad/core": minor
"@yadad/renderer": patch
"@yadad/testing": patch
---

`SeriesWidgetProps.aggregation` — the chart stops reading English (card 45g). The series widget told its component what the number was only as prose (`measureLabel: "Minimum weight"`), and `/git/yadad-components`' `measureFitsData()` sniffed the label's first word to decide whether the axis may start above the data — so a copy edit or a translation silently changed chart behaviour. The engine already knows (`measure.op`); the renderer now passes it as `aggregation: Measure["op"]` alongside the unchanged `measureLabel`. **Breaking for hand-implementers:** components that build `SeriesWidgetProps` by hand must add the required `aggregation` field; components that only receive it are unaffected. Consumer sets should switch `measureFitsData` to read `aggregation` (yadad-components card 19).
