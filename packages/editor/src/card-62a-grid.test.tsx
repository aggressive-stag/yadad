// @vitest-environment jsdom
// Card 62a: the card asks what the dashboard layout editor should do at phone width —
// "usable, or an honest 'use a larger screen' message, not a broken layout". Measured at
// 320px the 12-column canvas rendered ~85px cells: row buttons broke one letter per line
// (V3, up to 29 lines) and the widget panel became an 85px-wide scroller (V1). Decision:
// narrow viewports get the honest message; desktop keeps the grid.
import { cleanup, render, screen } from "@testing-library/react";
import type { DashboardView } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DashboardLayoutEditor } from "./dashboard-layout-editor.js";

const dashboard: DashboardView = { kind: "dashboard", specVersion: 0, id: "home", revision: 1, tabs: [{ id: "main", title: "Main", items: [] }] };

function stubMaxWidth(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && /max-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function setup() {
  render(<DashboardLayoutEditor dashboard={dashboard} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
}

describe("dashboard layout editor at phone width (card 62a)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("wide viewport: the drag grid renders", () => {
    stubMaxWidth(false);
    setup();
    expect(document.querySelector("[data-yadad-editor-grid]")).not.toBeNull();
    expect(screen.queryByTestId?.("narrow-note") ?? document.querySelector("[data-yadad-editor-narrow-note]")).toBeNull();
  });

  test("narrow viewport: an honest larger-screen message replaces the unusable grid", () => {
    stubMaxWidth(true);
    setup();
    expect(document.querySelector("[data-yadad-editor-grid]")).toBeNull();
    const note = document.querySelector("[data-yadad-editor-narrow-note]");
    expect(note?.textContent).toMatch(/larger screen/);
    expect(note?.textContent).toMatch(/keeps its current layout/);
    // the rest of the editor (tab strip) still works
    expect(screen.getByRole("tab", { name: "Main" })).toBeTruthy();
  });
});
