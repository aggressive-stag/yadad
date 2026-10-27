# @yadad/theme

Design tokens for yadad: the token names, light and dark values, and a CSS-variable emitter. Components read tokens only as CSS variables, so any host can restyle them. No dependencies.

```sh
npm install @yadad/theme
```

```ts
import { cssVar, darkTheme, lightTheme, themeToCss } from "@yadad/theme";

style.textContent = themeToCss(lightTheme) + themeToCss(darkTheme, "[data-theme=dark]");
cssVar("color-accent"); // "var(--yadad-color-accent)"
```

`themeToCss(theme, selector = ":root")` emits one `--yadad-<name>` variable per token inside `@layer yadad.tokens`, so any unlayered host CSS overrides it. To customize, spread a theme and change values: `{ ...lightTheme, "color-accent": "#0a7d4f" }`.

## Following the system theme

`applySystemTheme(target = document.documentElement)` sets the light or dark token values on `target` from `prefers-color-scheme`, follows changes, and returns an unsubscribe. The values are inline custom properties, so they win over `themeToCss` output. It does nothing (and returns a no-op) when `window.matchMedia` is missing, such as during server rendering.

```ts
const stop = applySystemTheme();
// later: stop();
```

## Tokens

`TOKEN_NAMES` is the list; `Theme` is an object with a value for every name.

| Group | Names |
| --- | --- |
| Color | `color-text`, `color-text-muted`, `color-background`, `color-surface`, `color-border`, `color-accent`, `color-danger` |
| Category colours | `color-category-0` … `color-category-7`: blue, red, orange, yellow, green, teal, purple, pink (the slot is the index, matching `COLOR_PALETTE` in `@yadad/core`). Each is at least 3:1 against its theme background. |
| Space | `space-1`, `space-2`, `space-3`, `space-4` |
| Shape | `radius-sm`, `radius-md`, `focus-ring-width` |
| Type | `font-family`, `font-size-sm`, `font-size-md` |
| Shadow | `shadow-sm`, `shadow-md` |

Token names are the contract; values are free to change. The dashboard grid's row height is a separate variable, `--yadad-grid-row-height` (default `4rem`).

## How it fits

`theme` imports nothing: it is token names and values plus a CSS-variable emitter that a component set and the host both read (see the [dependency graph](../../ARCHITECTURE.md#4-dependency-rules)).

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
