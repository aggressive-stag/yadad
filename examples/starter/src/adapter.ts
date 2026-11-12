import { createHttpAdapter, createMemoryAdapter } from "@yadad/runtime";
import { seed } from "./seed";

/** In-memory with seed records; nothing persists. */
export async function createSeededAdapter() {
  const a = createMemoryAdapter();
  await seed(a);
  return a;
}

/** The server over HTTP (Vite proxies /api to it), unless `VITE_DATA=memory` picks the memory adapter. */
export const createAdapter = () =>
  import.meta.env["VITE_DATA"] === "memory" ? createSeededAdapter() : createHttpAdapter({ baseUrl: "/api/records" });
