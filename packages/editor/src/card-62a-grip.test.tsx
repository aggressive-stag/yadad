// @vitest-environment jsdom
// Card 62a defect C (V7): the reorder grip is a button with padding:0 — under a coarse
// pointer it measured 10x13px, far under the 44px tap floor. Coarse pointers get the floor.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReorderGrip } from "./reorder.js";

function stubPointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && /pointer:\s*coarse/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("ReorderGrip touch target (card 62a)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("coarse pointer: the grip meets the 44px tap floor", () => {
    stubPointer(true);
    render(<ReorderGrip label="Drag the field Title" dragging={false} onPointerDown={() => {}} onPointerMove={() => {}} onPointerUp={() => {}} onPointerCancel={() => {}} onKeyDown={() => {}} />);
    const grip = screen.getByRole("button", { name: "Drag the field Title" });
    const s = grip.style;
    expect(parseFloat(s.minBlockSize || s.minHeight || "0")).toBeGreaterThanOrEqual(44);
    expect(parseFloat(s.minInlineSize || s.minWidth || "0")).toBeGreaterThanOrEqual(44);
  });

  test("fine pointer: the grip stays compact", () => {
    stubPointer(false);
    render(<ReorderGrip label="Drag the field Title" dragging={false} onPointerDown={() => {}} onPointerMove={() => {}} onPointerUp={() => {}} onPointerCancel={() => {}} onKeyDown={() => {}} />);
    const grip = screen.getByRole("button", { name: "Drag the field Title" });
    expect(parseFloat(grip.style.minBlockSize || grip.style.minHeight || "0")).toBeLessThan(44);
  });
});
