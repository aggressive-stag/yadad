---
"@yadad/renderer": patch
---

A direct action press returns focus to the record's button even when the view rebuilt the whole card while it reloaded (a board clears its cards during a reload). The new node is found by its place under the nearest surviving ancestor, only while its record is still shown.
