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

## Tokens

`TOKEN_NAMES` is the list; `Theme` is an object with a value for every name.

| Group | Names |
| --- | --- |
| Color | `color-text`, `color-text-muted`, `color-background`, `color-surface`, `color-border`, `color-accent`, `color-danger` |
| Space | `space-1`, `space-2`, `space-3`, `space-4` |
| Shape | `radius-sm`, `radius-md`, `focus-ring-width` |
| Type | `font-family`, `font-size-sm`, `font-size-md` |
| Shadow | `shadow-sm`, `shadow-md` |

Token names are the contract; values are free to change. The dashboard grid's row height is a separate variable, `--yadad-grid-row-height` (default `4rem`).

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
