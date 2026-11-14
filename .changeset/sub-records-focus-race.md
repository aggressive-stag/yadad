---
"@yadad/renderer": patch
---

Fix a race in the sub-record checklist: clicking a row's title (or adding a row) could leave focus on the page body instead of the row's input when a render had just committed. The input now always takes focus.
