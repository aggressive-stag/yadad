---
"@yadad/renderer": patch
---

A calendar move into a day that is at `maxEntriesPerDay` now lands focus on that day's "+N more" button (or its day cell) instead of dropping it to `<body>`: the entry sits behind the overflow, so the restore had no control of the record left to hold.
