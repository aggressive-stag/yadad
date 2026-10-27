# @yadad/theme

## 0.3.0

### Minor Changes

- df86e16: Adds `applySystemTheme(target?)`: applies the light or dark token set to an element (default the document element) from `prefers-color-scheme`, follows changes, and returns an unsubscribe. A no-op where `matchMedia` is missing.
- edd8ac3: Add eight category colour tokens, `color-category-0` to `color-category-7` (`--yadad-color-category-0` to `-7`), for light and dark: blue, red, orange, yellow, green, teal, purple, pink. Hosts that supply a full `Theme` object must add the eight new keys.

## 0.2.1

### Patch Changes

- 0b05230: Ship the CHANGELOG. The `files` list carried `dist` and `src` but not `CHANGELOG.md`, unlike every sibling package, so the published tarball dropped its changelog (F14's open engine finding). One line added; nothing else about the package changes.

## 0.2.0

### Minor Changes

- 4ed38dd: Add the `shadow-sm` and `shadow-md` tokens (`--yadad-shadow-sm`, `--yadad-shadow-md`) with light and dark values.

## 0.1.1

### Patch Changes

- 12bb9fa: Each package now ships a short README describing what it is and linking to the repo README and ARCHITECTURE.md, so the published packages say what they are without opening the repo.

## 0.1.0

### Minor Changes

- e50aa8b: Add a pre-contract token set (`TOKEN_NAMES`, `lightTheme`, `darkTheme`), `cssVar()`/`cssVarName()`, and `themeToCss()`, which emits tokens as `--yadad-*` variables in `@layer yadad.tokens`.
