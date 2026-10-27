---
"@yadad/renderer": minor
"@yadad/core": patch
---

The table shows a list page's `notice` in a polite status region above the rows (inside a `layout.Section`, as `<p role="status" data-yadad-page-notice data-tone>`), replaced on every load. The `datetime` input slot gets optional `minLocal` / `maxLocal` (`YYYY-MM-DDTHH:mm`, the field's `min` / `max` in the viewer's zone) beside the stored instants; core's `FieldInputExtras.datetime` is now `DatetimeInputExtras`. The calendar legend already receives each entry's `color`.
