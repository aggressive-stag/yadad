import { afterEach, describe, expect, test, vi } from "vitest";
import { applySystemTheme } from "./system-theme.js";
import { cssVarName, darkTheme, lightTheme } from "./tokens.js";

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initial,
    addEventListener: (_: string, l: Listener) => void listeners.add(l),
    removeEventListener: (_: string, l: Listener) => void listeners.delete(l),
  };
  const documentElement = fakeElement();
  vi.stubGlobal("window", { matchMedia: vi.fn(() => query), document: { documentElement } });
  return {
    documentElement,
    listeners,
    set(matches: boolean) {
      query.matches = matches;
      for (const l of [...listeners]) l({ matches });
    },
  };
}

function fakeElement() {
  const props = new Map<string, string>();
  return { props, style: { setProperty: (n: string, v: string) => void props.set(n, v) } };
}
type Fake = ReturnType<typeof fakeElement>;
const read = (el: Fake) => el.props.get(cssVarName("color-background")) ?? "";

afterEach(() => vi.unstubAllGlobals());

describe("applySystemTheme", () => {
  test("applies the scheme now, follows changes and stops on unsubscribe", () => {
    const media = stubMatchMedia(false);
    const el = fakeElement();
    const stop = applySystemTheme(el);
    expect(read(el)).toBe(lightTheme["color-background"]);
    media.set(true);
    expect(read(el)).toBe(darkTheme["color-background"]);
    stop();
    expect(media.listeners.size).toBe(0);
    media.set(false);
    expect(read(el)).toBe(darkTheme["color-background"]);
  });

  test("defaults to the document element", () => {
    const media = stubMatchMedia(true);
    const stop = applySystemTheme();
    expect(read(media.documentElement)).toBe(darkTheme["color-background"]);
    stop();
  });

  test("is a no-op without matchMedia", () => {
    vi.stubGlobal("window", {});
    const el = fakeElement();
    expect(() => applySystemTheme(el)()).not.toThrow();
    expect(read(el)).toBe("");
  });
});
