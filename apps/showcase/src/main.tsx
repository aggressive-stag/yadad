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
main > section { overflow-x: auto; }
main > section + section { margin-block-start: var(--yadad-space-4); }
[data-showcase-toolbar] { align-items: center; display: flex; flex-wrap: wrap; gap: var(--yadad-space-2); margin-block-end: var(--yadad-space-3); }
nav button[aria-current="page"] { font-weight: 700; text-decoration: underline; }
[data-view-as] { position: sticky; top: 0; z-index: 1; background: var(--yadad-color-background); display: flex; flex-wrap: wrap; align-items: center; gap: var(--yadad-space-3); margin: 0 0 var(--yadad-space-3); padding: var(--yadad-space-2); border: 1px solid var(--yadad-color-border, #ccc); border-radius: 0.5rem; }
[data-state-filters] { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr)); gap: var(--yadad-space-2) var(--yadad-space-3); margin: 0 0 var(--yadad-space-3); padding: 0; border: 0; min-width: 0; }
[data-state-filters] legend { padding: 0; font-weight: 600; margin-block-end: var(--yadad-space-1, 0.25rem); }
[data-state-filters] label { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
[data-state-filters] select { width: 100%; min-width: 0; }
[data-state-filters] label:has(input[type="checkbox"]) { flex-direction: row; align-items: center; grid-column: 1 / -1; }
[data-state-grid] { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--yadad-space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); }
[data-state-grid] > li { border: 1px solid var(--yadad-color-border, #ccc); border-radius: 0.5rem; padding: var(--yadad-space-2); display: flex; flex-direction: column; gap: var(--yadad-space-2); min-width: 0; }
[data-state-grid] > li[data-problems]:not([data-problems="0"]) { border-color: #b3261e; border-width: 2px; }
[data-state-open] { text-align: start; font: inherit; font-weight: 600; background: none; border: 0; padding: 0; cursor: pointer; color: inherit; text-decoration: underline; }
[data-state-marker] { color: #b3261e; }
[data-state-ok] { color: #1b6e2d; }
[data-state-preview] { height: 16rem; overflow: hidden; position: relative; background: var(--yadad-color-background); border: 1px solid var(--yadad-color-border, #ddd); }
[data-state-problems] { margin: 0; padding-inline-start: 1.25rem; font-size: 0.875rem; color: #b3261e; }
[data-showcase-editor-with-preview] { display: grid; gap: var(--yadad-space-4); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 64rem) { [data-showcase-editor-with-preview] { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; } }
[data-yadad-states-preview] { border: 1px solid var(--yadad-color-border, #ccc); border-radius: 0.5rem; padding: var(--yadad-space-2); }
[data-yadad-states-grid] > li[data-change="new"] { border-color: #1b6e2d; border-width: 2px; }
[data-yadad-states-grid] > li[data-change="changed"] { border-color: #8a5a00; border-width: 2px; }
[data-yadad-state-change] { font-weight: 600; }
[data-yadad-state-marker], [data-yadad-state-problems] { color: #b3261e; }
[data-yadad-state-ok] { color: #1b6e2d; }
[data-yadad-state-preview] { background: var(--yadad-color-background); border: 1px solid var(--yadad-color-border, #ddd); }
[data-state-width] { display: flex; gap: var(--yadad-space-3); border: 0; padding: 0; margin-block: var(--yadad-space-2); }
[data-state-frame] { margin-inline: auto; border: 1px solid var(--yadad-color-border, #ccc); padding: var(--yadad-space-2); overflow-x: auto; }`;
document.head.prepend(tokens);

const root = document.getElementById("root");
if (!root) throw new Error('index.html is missing <div id="root">.');
createRoot(root).render(
  <StrictMode>
    <App registry={registry} initialPage={window.location.hash === "#states" ? "states" : "views"} {...persistence()} />
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
