---
"@yadad/editor": patch
---

The README now carries the complete `renderState` a host writes for
`StatesPreview`: the five-kinds switch, entity lookup, one fresh
`createStateAdapter(state)` under every data-source key the set names
(dashboards included), and the state seeds — `initialMode`,
`initialGroupBy`, `initialTab` — with `key={state.id}` so they apply.
It was discoverable only in the showcase's own states page, and the
editor may not import the renderer to ship it. Two host facts join it:
Save bumps `revision`, so keying the editor on the document remounts
it and resets the undo stack, and `STATES_PREVIEW_DEFAULT_LIMIT` caps
the preview at twelve states. The sample is compiled and run by a
showcase test so it cannot drift from the renderers' props.
