import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registry } from "virtual:yadad-registry";
import { applySystemTheme, lightTheme, themeToCss } from "@yadad/theme";
import { App, defaultRoots } from "./App";
import { STRESS_ROOTS } from "./stress";

// Theme tokens (--yadad-*) that component stylesheets read.
const tokens = document.createElement("style");
// The host's own page styles read the same tokens; unlayered, so they win.
tokens.textContent = `${themeToCss(lightTheme)}
body { margin: 0 auto; max-width: 75rem; padding: var(--yadad-space-4); font-family: var(--yadad-font-family); color: var(--yadad-color-text); background: var(--yadad-color-background); }
main > section { overflow-x: auto; }
main > section + section { margin-block-start: var(--yadad-space-4); }
[data-showcase-toolbar] { align-items: center; display: flex; flex-wrap: wrap; gap: var(--yadad-space-2); margin-block-end: var(--yadad-space-3); }
/* Card 62a (V7): the toolbar's own buttons are host chrome, not the component set —
   under a coarse pointer they gave a 54x21px tap target. Bring them to the 44px floor. */
@media (pointer: coarse) {
  [data-showcase-toolbar] button { min-block-size: 2.75rem; min-inline-size: 2.75rem; padding-inline: var(--yadad-space-3); }
  /* Same floor for the demo's own selects and their labels (View as, simulate-editor,
     state filters): native selects rendered 19px tall and 13px font — iOS zooms the page. */
  [data-showcase-toolbar] select,
  [data-view-as] select,
  [data-state-filters] select { min-block-size: 2.75rem; font-size: 1rem; }
  [data-view-as] label,
  [data-state-filters] label { min-block-size: 2.75rem; align-items: center; }
  [data-showcase-toolbar] label { min-block-size: 2.75rem; display: inline-flex; align-items: center; gap: var(--yadad-space-1); }
  /* State-kit tile openers are bare text buttons (padding:0) — 36px tall on a phone. */
  [data-state-open] { min-block-size: 2.75rem; }
  /* The state detail page is showcase chrome too: back button 134x21, radio labels 20px. */
  [data-state-detail] > button { min-block-size: 2.75rem; display: inline-flex; align-items: center; }
  [data-state-detail] fieldset label { min-block-size: 2.75rem; display: inline-flex; align-items: center; gap: var(--yadad-space-1); }
  /* field-frame labels are component-owned (@yadad/components): tap targets render
     35px wide on a phone. Host-layer mirror of the 44px floor; proper fix upstream
     (label min-inline-size under pointer:coarse), noted in the card Report. */
  [data-yadad="field-frame"][data-part="root"] > [data-part="label"] { min-inline-size: 2.75rem; }
}

/* Card 62a (V3): tags chips set overflow-wrap:anywhere (component-owned,
   yadad-components sets/base/tags/v1/tags.css:122), which collapses their
   min-content width to ~one character — so the table squeezes chip cells to
   36px and the text breaks mid-letter while the root never scrolls. Mirrored
   here at the host layer (break-word keeps min-content and keeps wrapping as
   the last resort); the proper fix is the one-word change upstream, noted in
   the card Report. Verified: 43/43 chips whole at 1280 and 320, no page overflow. */
[data-yadad="tags"][data-part="display"] > [data-part="chip"] { overflow-wrap: break-word; }
/* Same family (V3): editor row buttons (Move … up/down, Stop offering) sit in a
   flex actions span and were shrinking to 49px wide — the ellipsised label then
   broke one letter per line (11–16 lines). Button chrome must not squash; the
   label truncates at the ellipsis it already has. Verified: 22/22 whole at 390,
   no page overflow. */
td[data-part="cell"] button[data-yadad="button"] { flex: none; white-space: nowrap; }
nav button[aria-current="page"] { font-weight: 700; text-decoration: underline; }
[data-view-as] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yadad-space-3); margin: 0 0 var(--yadad-space-3); padding: var(--yadad-space-2); border: 1px solid var(--yadad-color-border, #ccc); border-radius: 0.5rem; }
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
// The light tokens above are the fallback; this follows the OS colour scheme (and its later changes) from here on.
applySystemTheme();

const root = document.getElementById("root");
if (!root) throw new Error('index.html is missing <div id="root">.');
// The visual audit's URL modes (?plan 2026-11-03 §2): `?stress=1` shows the V11
// long-content documents and `?empty=1` empties every demo data source.
const params = new URLSearchParams(window.location.search);
createRoot(root).render(
  <StrictMode>
    <App
      registry={registry}
      initialPage={window.location.hash === "#states" ? "states" : window.location.hash === "#review" ? "review" : "views"}
      stress={params.get("stress") === "1"}
      empty={params.get("empty") === "1"}
      {...(params.get("stress") === "1" ? { roots: [...defaultRoots, ...STRESS_ROOTS] } : {})}
      {...persistence()}
    />
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
