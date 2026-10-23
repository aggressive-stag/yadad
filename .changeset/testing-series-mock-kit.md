---
"@yadad/testing": minor
---

Series widgets get a mock and a contract. `mockRegistry.widgets.series` draws a group as a plain table — one row per group with its label and formatted text, notes for skipped records and a partial read — so engine tests and the state sweep can check `widgets.series` without the components repo. The contract kit gained `seriesChecks`: a registry that ships `widgets.series` must name it by its label, carry every group's label and text in the accessible tree (a chart of bars alone is decoration, not data), show its `measureLabel`, and survive `groups: []` and a gap bucket with no value without throwing or unmounting itself. A registry without the key is skipped, as every optional key is.
