// `npm run dev`: the records server and Vite together; seeds an empty database once.
import { spawn } from "node:child_process";
import { createHttpAdapter } from "@yadad/runtime";
import { seed } from "../src/seed.ts";

const children = [
  spawn(process.execPath, ["server/index.ts"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], { stdio: "inherit" }),
];
const stop = (): void => { for (const c of children) c.kill(); };
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stop(); process.exit(0); });
for (const c of children) c.on("exit", () => { stop(); process.exit(0); });

const adapter = createHttpAdapter({ baseUrl: "http://127.0.0.1:8787/api/records" });
for (let i = 0; i < 50; i++) {
  try {
    if ((await adapter.find("person", { page: { offset: 0, limit: 1 } })).total === 0) await seed(adapter);
    break;
  } catch { await new Promise((r) => setTimeout(r, 100)); } // the server is still starting
}
