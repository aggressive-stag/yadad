---
"@yadad/testing": patch
---

The calendar `done-missing` check counts only the entries a day cell draws: entries behind a day's "+N more" (`maxEntriesPerDay`) need no completion checkbox. Fixing labelled select validation made the state grid reach states it used to skip, which surfaced this false positive.
