---
"@yadad/editor": patch
---

StatesPreview: the state-preview frame is now `pointer-events: none`. It
is a scaled picture of the view, `aria-hidden` and `inert`, but it still
caught pointer events — a dashboard editor whose preview overlapped the
grid could not be dragged at all: clicks hit the frame, not the cards.
Keyboard card move/resize stays pinned by a test the way a consumer's
Tab-and-arrows session hits it.
