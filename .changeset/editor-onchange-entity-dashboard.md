---
"@yadad/editor": minor
---

EntityFieldsEditor and DashboardLayoutEditor take `onChange`, reporting
the in-progress document after every edit, undo or redo — the same hook
the view editors already had. A host's live preview and unsaved-JSON
panel showed only the last saved revision for these two: Remove and
Undo were invisible until Save. The README now says all editors take
`onChange`, because all of them do.
