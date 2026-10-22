---
"@yadad/renderer": minor
---

`DocumentSet` — the type of `DashboardRenderer`'s `documents` prop and the
row-action sets — is exported from the package root, and `documentSet(...)`
builds one from a flat pile of core `Document`s: entities and views sorted
into their maps, the last viewer document picked up. A consumer that loads
documents as a list no longer redeclares the shape by hand to pass a prop
it cannot import.
