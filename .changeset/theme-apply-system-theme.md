---
"@yadad/theme": minor
---

Adds `applySystemTheme(target?)`: applies the light or dark token set to an element (default the document element) from `prefers-color-scheme`, follows changes, and returns an unsubscribe. A no-op where `matchMedia` is missing.
