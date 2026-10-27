---
"@yadad/core": minor
---

A table quick filter takes three optional keys: `default`, the filter's initial state (a string for select, text and time fields, a boolean, a string array for tags, or `{ from?, to? }` for number, date and datetime fields); `label`, the control's own label; and `placeholder`, for text filters only. A select default must be one of the options, and range bounds are checked like the same value in a condition. Existing documents are unchanged.
