import { expect, test } from "vitest";
import { createHttpAdapter } from "./http-adapter.js";

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
