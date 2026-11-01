---
"@yadad/renderer": minor
---

The calendar renderer offers the rolling N-day periods and forwards `listStart`.

`modes` may now name `1day`, `3day` and `5day` beside `month` and `week` (RFC 0004
amendment). The switcher lists exactly the view's modes, in the view's order, and
`initialMode` accepts any declared one; each mode loads precisely `visibleRange(anchor,
mode, …)` through the adapter, so a 3-day period asks for three days and nothing else.
Prev, next and Today step by the period length. `weekdays` is one label per grid
column — the first column is the first day's weekday, so a Thursday-anchored 3-day
period reads Thu, Fri, Sat — and `view.listStart` reaches the set as `listStart`.
A document that declares neither key renders exactly what it rendered before.
