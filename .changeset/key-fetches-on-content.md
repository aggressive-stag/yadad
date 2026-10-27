---
"@yadad/renderer": patch
---

Data fetches and the drill-level cache now depend on the content of `entity`, `view`, `dashboard`, `documents`, `entities`, `viewer`, `drill`, `drills` and `dataSources`, not their object identity. A host that rebuilds its documents on every render no longer refetches rows. Data adapters are still compared by identity.
