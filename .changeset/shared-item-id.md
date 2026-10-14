---
"@yadad/renderer": patch
"@yadad/editor": patch
---

Grid item ids are unique per tab, not per dashboard: switching tabs no longer carries a form's typed input into another tab's widget that shares the item id, and the layout editor's open count filter stays on its own tab.
