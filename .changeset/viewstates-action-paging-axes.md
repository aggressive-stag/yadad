---
"@yadad/runtime": minor
---

`viewStates` gains the RFC 0007 axes. A table, board or calendar with `recordActions` gets one `action:<id>` axis per offered action (`available | withheld`); `withheld` sets `can: { actions: { <id>: false } }` on the first generated record, as the permission axis does with `update`, and combines with it. Tables get a `paging` axis (`total | cursor-more | cursor-end`): the render carries `total`, or an opaque `next` with more to come, or `next: null` for the last cursor page. Generated records carry a `datetime` value: a fixed instant 09:30 on `now`'s day in the new `options.timeZone` ("UTC" by default), so snapshots do not drift with the machine's zone. Old documents without actions gain no action axis.
