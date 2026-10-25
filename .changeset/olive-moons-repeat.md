---
"@yadad/core": patch
---

RFC 0009 contract (items 1, 3, 4, 5), all additive.

- `fieldEqFact` condition leaf: `{ op: "fieldEqFact", field, fact }` — the record's
  value of `field` equals the viewer's value of a fact declared in the context's
  `viewer` document. A record leaf: legal wherever `eq` is, banned in filter places
  (a filter is a server query and the server cannot resolve the viewer's value).
- Named saved filters on a table: `filters?: [{ id, name, condition }]`, each
  condition checked by the same `checkCondition` the table's own `filter` uses.
- `repeat?: "batch"` on a form view: the host renders the field set N times and
  the write path creates N records atomically.
- Sub-record checklist sections: a form section holds `items` OR `subRecords`
  (`{ entity, via, titleField, doneField, orderField?, addLabel? }`) — a declared
  checklist over a child entity whose `via` reference points back at the form's
  entity. `sectionItems(section)` is the accessor for the now-optional `items`.

`specVersion` stays 7; card 47c lands the 7-to-8 bump with RFC 0008's items.
