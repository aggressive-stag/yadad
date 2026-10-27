---
"@yadad/runtime": patch
---

The memory and HTTP adapters now refuse a query whose filter holds a `fieldEqFact` leaf, as they already did for `viewerIn`: both read the viewer, and a filter is a server query. Before, the leaf silently matched nothing.
