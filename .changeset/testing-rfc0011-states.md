---
"@yadad/testing": minor
---

The state grid and the contract kit reach the RFC 0011 surfaces. A table with a reference quick filter now gets the `quick` axis (default applied or cleared), and the state's record set carries target records for the picker (one per reference value the generated rows hold, plus the filter's default), so the `quick-default` check covers it. A reference picker is not checked while the source is loading or failed. The action scenarios gain a check that a confirm with `subjectField` shows the record's subject line (`data-yadad-confirm-subject`); a component set or host that drops it is reported.
