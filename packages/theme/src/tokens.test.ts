import { describe, expect, test } from "vitest";
import { type TokenName, TOKEN_NAMES, cssVar, darkTheme, lightTheme, themeToCss } from "./tokens.js";

describe("themes", () => {
  test.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ])("%s defines every token and nothing else", (_name, theme) => {
    expect(Object.keys(theme).sort()).toEqual([...TOKEN_NAMES].sort());
    for (const value of Object.values(theme)) expect(value.trim()).not.toBe("");
  });
});

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast (WCAG AA)", () => {
  test.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ])("%s: text 4.5:1, borders and accents 3:1 against the background", (_name, t) => {
    expect(contrast(t["color-text"], t["color-background"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["color-text-muted"], t["color-background"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["color-danger"], t["color-background"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["color-border"], t["color-background"])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["color-accent"], t["color-background"])).toBeGreaterThanOrEqual(3);
  });
});

test("themeToCss emits every token in the yadad.tokens layer", () => {
  const css = themeToCss(lightTheme, ".app");
  expect(css.startsWith("@layer yadad.tokens {\n  .app {\n")).toBe(true);
  for (const name of TOKEN_NAMES) expect(css).toContain(`--yadad-${name}: ${lightTheme[name]};`);
  expect(cssVar("color-accent")).toBe("var(--yadad-color-accent)");
});

describe("category colours", () => {
  // The hue names and slots come from core's COLOR_PALETTE. Theme imports
  // nothing, so the hexes are duplicated on purpose and tested here.
  const hues = ["blue", "red", "orange", "yellow", "green", "teal", "purple", "pink"];
  const palette = ["#464ea9", "#d13438", "#f7630c", "#ffb900", "#107c10", "#038387", "#8764b8", "#c239b3"];
  // Light values that differ from the palette hex: yellow is darkened to reach 3:1 on white.
  const adjusted: Record<string, string> = { yellow: "#bc8900" };
  const slot = (i: number) => `color-category-${i}` as TokenName;

  test.each(hues.map((hue, i) => [hue, i] as const))("light %s matches the palette", (hue, i) => {
    expect(lightTheme[slot(i)]).toBe(adjusted[hue] ?? palette[i]);
  });

  test.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ])("%s: all eight reach 3:1 against the background", (_name, t) => {
    for (let i = 0; i < 8; i++) {
      expect(contrast(t[slot(i)], t["color-background"])).toBeGreaterThanOrEqual(3);
    }
  });
});
