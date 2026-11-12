// The HTTP traffic that docs/guide.md part 2 shows. It runs the starter's own records server
// on a random port, drives it through the engine's real HTTP adapter and records every request
// and response. guide.test.tsx checks the guide's text against this; run `node tests/exchanges.ts`
// to print the traffic in the guide's format after a deliberate change.
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpAdapter } from "@yadad/runtime";
import { createRecordsApp, loadEntities, openDatabase } from "../server/index.ts";

export interface Exchange {
  readonly name: string;
  readonly method: string;
  /** Path and query, exactly as the adapter sent it. */
  readonly target: string;
  readonly requestBody: unknown;
  readonly status: number;
  readonly responseBody: unknown;
}

const META = { entityRevision: 1 };

export async function captureExchanges(): Promise<Exchange[]> {
  const dir = mkdtempSync(`${tmpdir()}/starter-guide-`);
  const server = createRecordsApp(openDatabase(`${dir}/guide.db`), loadEntities(resolve(import.meta.dirname, "../documents")));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const out: Exchange[] = [];
  let name = "";
  const adapter = createHttpAdapter({
    baseUrl: `${origin}/api/records`,
    fetch: async (url, init) => {
      const res = await fetch(url, init as RequestInit);
      const text = res.status === 204 ? "" : await res.text();
      out.push({
        name,
        method: (init as { method: string }).method,
        target: url.slice(origin.length),
        requestBody: (init as { body?: string }).body === undefined ? undefined : JSON.parse((init as { body: string }).body),
        status: res.status,
        responseBody: text === "" ? undefined : JSON.parse(text),
      });
      return new Response(text === "" ? null : text, { status: res.status, headers: { "content-type": "application/json" } });
    },
  });
  const step = async (n: string, run: () => Promise<unknown>): Promise<void> => {
    name = n;
    try {
      await run();
    } catch {
      // A 4xx is an expected answer here; the exchange is already recorded.
    }
  };
  try {
    await step("create-person", () => adapter.create("person", { name: "Ada" }, META));
    await step("create-task", () => adapter.create("task", { title: "Write the release notes", status: "In progress", assignee: "1", due: "2026-11-20" }, META));
    await step("create-invalid", () => adapter.create("task", { title: "Fix the login redirect", status: "Someday", assignee: "99" }, META));
    await step("create-task-2", () => adapter.create("task", { title: "Plan the offsite", status: "To do", due: "2026-12-01" }, META));
    await step("list", () => adapter.find("task", { sort: [{ field: "due", dir: "asc" }], page: { offset: 0, limit: 10 } }));
    await step("list-filtered", () => adapter.find("task", { filter: { op: "eq", field: "status", value: "To do" }, sort: [{ field: "due", dir: "asc" }], page: { offset: 0, limit: 10 } }));
    await step("find-one", () => adapter.findOne("task", "2"));
    await step("update", () => adapter.update("task", "2", { status: "Done" }, { ...META, baseVersion: "1" }));
    await step("update-stale", () => adapter.update("task", "2", { status: "Blocked" }, { ...META, baseVersion: "1" }));
    await step("delete", () => adapter.delete("task", "3", { ...META, baseVersion: "1" }));
    await step("find-missing", () => adapter.findOne("task", "99"));
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

/** The guide's text for one exchange. */
export function format(e: Exchange): string {
  const req = [`${e.method} ${e.target}`, ...(e.requestBody === undefined ? [] : ["Content-Type: application/json", "", JSON.stringify(e.requestBody, null, 2)])];
  const res = [`HTTP/1.1 ${e.status}`, ...(e.responseBody === undefined ? [] : ["Content-Type: application/json", "", JSON.stringify(e.responseBody, null, 2)])];
  return `${req.join("\n")}\n\n${res.join("\n")}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const e of await captureExchanges()) console.log(`<!-- exchange: ${e.name} -->\n\`\`\`http\n${format(e)}\n\`\`\`\n`);
}
