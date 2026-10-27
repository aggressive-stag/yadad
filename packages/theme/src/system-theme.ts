import { TOKEN_NAMES, cssVarName, darkTheme, lightTheme } from "./tokens.js";
import type { Theme } from "./tokens.js";

// The theme package has no DOM lib, so it names only the slice of the DOM it touches.
interface ThemeTarget {
  readonly style: { setProperty(name: string, value: string): void };
}
interface SchemeQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { readonly matches: boolean }) => void): void;
}
interface SchemeHost {
  matchMedia?: (query: string) => SchemeQuery;
  document?: { documentElement: ThemeTarget };
}

function applyTheme(target: ThemeTarget, theme: Theme): void {
  for (const name of TOKEN_NAMES) target.style.setProperty(cssVarName(name), theme[name]);
}

/**
 * Applies `lightTheme` or `darkTheme` to `target` (default the document element) as inline
 * custom properties, from `prefers-color-scheme`, and follows later changes. Returns an
 * unsubscribe that stops following; the last applied tokens stay. Without `window` or
 * `matchMedia` it does nothing and returns a no-op.
 */
export function applySystemTheme(target?: ThemeTarget): () => void {
  const host = (globalThis as { window?: SchemeHost }).window;
  if (!host || typeof host.matchMedia !== "function") return () => {};
  const element = target ?? host.document?.documentElement;
  if (!element) return () => {};
  const query = host.matchMedia("(prefers-color-scheme: dark)");
  const apply = (dark: boolean) => applyTheme(element, dark ? darkTheme : lightTheme);
  const onChange = (event: { readonly matches: boolean }) => apply(event.matches);
  apply(query.matches);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
