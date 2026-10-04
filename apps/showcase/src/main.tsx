import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registry } from "virtual:yadad-registry";
import { lightTheme, themeToCss } from "@yadad/theme";
import { App } from "./App";

// Theme tokens (--yadad-*) that component stylesheets read.
const tokens = document.createElement("style");
// The host's own page styles read the same tokens; unlayered, so they win.
tokens.textContent = `${themeToCss(lightTheme)}
body { margin: 0 auto; max-width: 75rem; padding: var(--yadad-space-4); font-family: var(--yadad-font-family); color: var(--yadad-color-text); background: var(--yadad-color-background); }
main > section + section { margin-block-start: var(--yadad-space-4); }
[data-showcase-toolbar] { display: flex; gap: var(--yadad-space-2); margin-block-end: var(--yadad-space-3); }`;
document.head.prepend(tokens);

const root = document.getElementById("root");
if (!root) throw new Error('index.html is missing <div id="root">.');
createRoot(root).render(
  <StrictMode>
    <App registry={registry} {...persistence()} />
  </StrictMode>,
);

/** localStorage when the browser allows it (it can throw in some private modes); memory otherwise. */
function persistence() {
  try {
    const storage = window.localStorage;
    storage.getItem("yadad-showcase:probe");
    return {
      storage,
      onReset: () => {
        for (const key of Object.keys(storage)) if (key.startsWith("yadad-showcase:")) storage.removeItem(key);
        window.location.reload();
      },
    };
  } catch {
    return {};
  }
}
