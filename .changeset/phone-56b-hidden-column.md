---
"@yadad/renderer": patch
"@yadad/core": patch
"@yadad/testing": patch
---

The board's hidden empty no-value column stays reachable. The renderer now passes it as the new optional `BoardProps.hiddenColumns` (editable boards with a non-required grouping field only). A component that honours it lists it in "Move to…" and shows it as a drop target while a card is dragged; one that ignores it behaves as before. `@yadad/testing`'s mock board lists it in "Move to…".
