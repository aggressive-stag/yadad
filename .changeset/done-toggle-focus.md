---
"@yadad/renderer": patch
---

Keyboard focus stays on a record's Done checkbox after it is ticked on a calendar or a board. The checkbox is disabled while the change saves, which made the browser drop focus to the page; focus now returns to the same record's checkbox once the save settles (also after a refused save), reusing the focus return that record actions have. When the record is no longer shown, focus is left alone.
