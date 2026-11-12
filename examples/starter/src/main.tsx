import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { validateDocuments } from "@yadad/core";
import { darkTheme, lightTheme, themeToCss } from "@yadad/theme";
import "@yadad/components/styles.css";
import "./app.css";
import { documents } from "./documents";
import { createAdapter } from "./adapter";
import { App } from "./App";

const style = document.createElement("style");
style.textContent = themeToCss(lightTheme) + themeToCss(darkTheme, "[data-theme=dark]");
document.head.append(style);

const root = createRoot(document.getElementById("root")!);
const result = validateDocuments(documents);
if (!result.ok) {
  // An invalid document shows its errors instead of the app.
  root.render(
    <main className="starter-errors" role="alert">
      <h1>Invalid documents</h1>
      <ul>
        {result.errors.map((e, i) => (
          <li key={i}><code>{e.document}{e.path}</code> [{e.code}] {e.message}</li>
        ))}
      </ul>
    </main>,
  );
} else {
  const adapter = await createAdapter();
  root.render(<StrictMode><App adapter={adapter} /></StrictMode>);
}
