---
"@yadad/runtime": minor
"@yadad/testing": minor
---

Series widgets get their own states. A `series` grid item on a dashboard adds a `widget:<itemId>` axis with `none`, `one`, `many` and a `partial` read (43a decision 7), and the state's `render.series` entry carries the records that make exactly that many groups — distinct `groupBy` values that still pass the view's filter and the entity's validation, dates spread over months when the widget buckets by month, the table padded past the aggregate cap for `partial`. A field that can show no group under the filter skips the widget with a reason instead of shipping an empty chart. The state adapter seeds those records over the collection widgets', so a series state's chart, computed through the adapter by `aggregateSeries`, shows the groups its axis picked.
