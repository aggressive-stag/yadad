---
"@yadad/testing": minor
---

`checkViewStates` checks the viewer axes of RFC 0006. It passes the state's viewer to form rules, and adds three checks found by wrapping the registry: `viewer-visibility` (tabs and table columns shown or missing against what the state's viewer may see), `editable-offered` (an inline edit, `onMove`, `movable: true` or an open handler offered where the viewer condition is false or the record is locked) and `editable-missing` (the reverse). A dashboard state on a tab the viewer may not see no longer fails with "no tab to open". The mock registry and contract kit are unchanged: components are not told about the viewer.
