---
"@yadad/runtime": minor
"@yadad/renderer": patch
"@yadad/core": patch
---

RFC 0008/0009 evaluation (card 47d). Runtime: `fieldEqFact` evaluates against the record
(mirrors `viewerIn`'s unknown-fact rule); `tags` conditions — `contains`/`notContains` are
element membership, `in`/`notIn` match any element; `time` comparisons ride the string
ordering with a pin that lexicographic `HH:MM` is chronological; `can.fields` narrows
`canUpdate` per field through `canEditField`/`canMoveColumn`, malformed entries drop the
whole `can` like malformed `actions`. Board: `columnsFrom` is real — the default
`"records"` derives columns from the loaded page via `boardRecordColumns` (no target
fetch), `"options"` keeps the capped target load (RFC 0008 item 10, opt-in per the owner
decision). Renderer: board/calendar drags and table inline edits honour `can.fields`; a
tags quick filter chips with any-element semantics; `fields.tsx` gains the `time`/`tags`
dispatch cases so the registry entries from card 47k actually render.
