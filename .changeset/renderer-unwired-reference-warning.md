---
"@yadad/renderer": patch
---

`useReferences` logs a one-time `yadad:` console warning when a reference
field's target entity was not passed in the renderer's `entities` prop. A
page that forgot the target showed a column of raw ids with no console
signal, no network call and nothing for a test to catch; the raw-id label
is unchanged, so there is no contract change.
