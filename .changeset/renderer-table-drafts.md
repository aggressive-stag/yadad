---
"@yadad/renderer": minor
---

Table in-place edits draft. Pass `drafts={{ store }}` to `TableRenderer` —
opt-in, same `DraftStore`, same debounced write-back, same notice and
Discard as the form — and unsaved input in an open row edit is kept under
`yadad:draft:<viewId>:<recordId>` and comes back when that row's edit is
reopened: after a refresh, after the row scrolls out of the page and
back, after navigating away. Saving or Cancel clears the draft; a refused
save (validation, conflict) keeps it; Discard starts from the saved
record again. A row's draft belongs to that record, so two rows being
edited never share text. `DashboardRenderer` hands `drafts` to embedded
tables as it already does to embedded forms.
