import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registry } from "virtual:yadad-registry";
import { lightTheme, themeToCss } from "@yadad/theme";
import { App } from "./App";

// Theme tokens (--yadad-*) that component stylesheets read.
const tokens = document.createElement("style");
tokens.textContent = themeToCss(lightTheme);
document.head.prepend(tokens);

const root = document.getElementById("root");
if (!root) throw new Error('index.html is missing <div id="root">.');
createRoot(root).render(
  <StrictMode>
    <App registry={registry} />
  </StrictMode>,
);
