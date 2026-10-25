---
"@yadad/runtime": minor
"@yadad/testing": minor
---

State grid and contract kit for the RFC 0008 / RFC 0009 additions (card 47h).

State grid (`viewStates`, `@yadad/runtime`):

- `time` fields: the grid carries the `23:59` boundary next to the empty and mid-day values.
- `tags` fields: an empty-tags, a one-tag, a many-tags and a duplicates-tolerated state (the display must not deduplicate what the record holds).
- `fieldEqFact` (RFC 0009 item 1): one viewer axis per fact a view compares a field against, and the compared field's axis is seeded with the fact's own values so the comparison gets a true state as well as a false one. A `repeat: "batch"` composer keeps only the viewer axis — its rows always start empty, so an injected-value comparison state could never render.
- Board `columnsFrom: "options"`: an empty-column state — a grouping option no card references (RFC 0008 item 10).
- `doneField` true/false pairs on calendar and board states (RFC 0008 item 12).

Contract kit (`registryContractChecks`, `checkViewStates` in `@yadad/testing`):

- `layout.Pager` assertions, optional like `layout.Calendar`: a registry without a Pager has no pager checks; one with a Pager must render a navigation region named by its label, disable the controls the position rules out, fire the others, and drop the total page count in cursor mode.
- `can.fields` narrowing (RFC 0008 item 9): a table row offers Edit only when some editable column's field is open on that record (`canEditField`), and a calendar/board entry is movable only when the move field is open on it. Records without `can.fields` are untouched — fail-open, the server decides. New checks: `can-fields-offered`, `can-fields-missing`.

The showcase's document set exercises the new keys at v8: tags/time/boolean task fields, a table with `addForm`, named `filters` (one `fieldEqFact` against a `me` fact) and a tags quick filter, a batch form with a sub-record checklist, `columnsFrom: "options"` plus `doneField` on the team board, and `doneField` + `maxEntriesPerDay` on the bookings calendar.
