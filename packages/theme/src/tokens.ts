// PRE-CONTRACT token set: just enough for the Phase 0 text field and
// FieldFrame. Token names freeze with contract-v0 (where they live, core or
// theme, is an open question in ARCHITECTURE.md); values stay free to change.

/** Token names. Each becomes the CSS variable --yadad-<name>. */
export const TOKEN_NAMES = [
  "color-text",
  "color-text-muted",
  "color-background",
  "color-surface",
  "color-border",
  "color-accent",
  "color-danger",
  "space-1",
  "space-2",
  "space-3",
  "space-4",
  "radius-sm",
  "radius-md",
  "font-family",
  "font-size-sm",
  "font-size-md",
  "focus-ring-width",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** A complete set of token values. Every name must have a value. */
export type Theme = { readonly [K in TokenName]: string };

const shared = {
  "space-1": "0.25rem",
  "space-2": "0.5rem",
  "space-3": "0.75rem",
  "space-4": "1rem",
  "radius-sm": "0.25rem",
  "radius-md": "0.5rem",
  "font-family": "system-ui, sans-serif",
  "font-size-sm": "0.875rem",
  "font-size-md": "1rem",
  "focus-ring-width": "2px",
} as const;

export const lightTheme: Theme = {
  ...shared,
  "color-text": "#1a1a1a",
  "color-text-muted": "#5c5c5c",
  "color-background": "#ffffff",
  "color-surface": "#f6f6f6",
  "color-border": "#8a8a8a",
  "color-accent": "#2459c7",
  "color-danger": "#b3261e",
};

export const darkTheme: Theme = {
  ...shared,
  "color-text": "#f0f0f0",
  "color-text-muted": "#b0b0b0",
  "color-background": "#141414",
  "color-surface": "#1f1f1f",
  "color-border": "#8f8f8f",
  "color-accent": "#8ab0ff",
  "color-danger": "#ff8a80",
};

/** The CSS variable name for a token: "--yadad-color-text". */
export function cssVarName(name: TokenName): string {
  return `--yadad-${name}`;
}

/** A var() reference for a token, for use in CSS-in-JS or inline styles. */
export function cssVar(name: TokenName): string {
  return `var(${cssVarName(name)})`;
}

/**
 * Emits a theme as CSS custom properties inside `@layer yadad.tokens`, so any
 * unlayered host CSS overrides it (DECISIONS.md D15).
 */
export function themeToCss(theme: Theme, selector = ":root"): string {
  const body = TOKEN_NAMES.map((name) => `    ${cssVarName(name)}: ${theme[name]};`).join("\n");
  return `@layer yadad.tokens {\n  ${selector} {\n${body}\n  }\n}\n`;
}
