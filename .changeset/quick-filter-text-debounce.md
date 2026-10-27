---
"@yadad/renderer": minor
---

A text quick filter on a `TableRenderer` now waits 300 ms after the last keystroke before it reloads the table, instead of sending a request per character. The box still shows what is typed at once, and clearing it commits immediately. A tags quick filter is unchanged: a typed-but-unadded draft still waits for Enter, because the tags input slot has no blur or draft callback yet.
