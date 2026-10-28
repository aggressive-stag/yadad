---
"@yadad/renderer": patch
---

Focus now stays with the record after an action or move run from a panel that closes with the press (a card's "Actions…" menu, a "Move to…" or "Move to day…" panel). The reload used to leave focus on the page body. A component can mark the control that opens the panel, and the panel itself, with a shared `data-yadad-focus-return` value so focus returns to that trigger; without it focus goes to the record's first focusable control. A move the viewer made follows the record to its new column or day. Board cards and calendar entry titles carry `data-yadad-record`. Additive, no document change.
