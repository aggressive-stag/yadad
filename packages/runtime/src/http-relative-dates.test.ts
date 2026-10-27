import { expect, test, vi } from "vitest";
import { createHttpAdapter } from "./http-adapter.js";

// The runtime compiles without the DOM or node typings; every JS host has a console.
declare const console: { warn(...args: unknown[]): void };

test("the http adapter never sends a relative date to the server", async () => {
  const urls: string[] = [];
  const adapter = createHttpAdapter({
    baseUrl: "/api/records",
    fetch: async (input) => {
      urls.push(input);
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }), text: async () => "" };
    },
  });
  await adapter.find("e", { filter: { op: "gte", field: "day", value: { daysFromToday: -7 } } });
  const filter = decodeURIComponent(/[?&]filter=([^&]*)/.exec(urls[0] ?? "")?.[1] ?? "");
  expect(filter).not.toContain("daysFromToday");
  expect(JSON.parse(filter)).toMatchObject({ op: "gte", field: "day", value: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
});

const pageAdapter = (body: unknown) =>
  createHttpAdapter({
    baseUrl: "/api/records",
    fetch: async () => ({ ok: true, status: 200, json: async () => body, text: async () => "" }),
  });

test("the http adapter passes a well-formed page notice through", async () => {
  const notice = { tone: "warning", text: "Served without vector search" };
  const page = await pageAdapter({ items: [], total: 0, notice }).find("e", {});
  expect(page.notice).toEqual(notice);
});

test("the http adapter drops a malformed page notice with a warning", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const notice of [{ tone: "error", text: "x" }, { tone: "info" }, { tone: "info", text: "" }, "x", { tone: "info", text: "x", extra: 1 }]) {
    const page = await pageAdapter({ items: [], total: 0, notice }).find("e", {});
    expect(page).not.toHaveProperty("notice");
  }
  expect(warn).toHaveBeenCalledTimes(5);
  warn.mockRestore();
});
