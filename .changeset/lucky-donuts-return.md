---
"@yadad/renderer": patch
---

A record action returns focus to its row after the reload: the pressed control is remembered, and when the flight ends with focus on nothing (the browser drops it when `pending` disables the button), focus goes back to the pressed button — never over a dialog or a viewer who moved on, and nowhere when the record was removed.
