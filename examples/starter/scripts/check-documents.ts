// Validates every file in documents/ as one set; names the file and JSON pointer of each error.
import { readdirSync, readFileSync } from "node:fs";
import { validateDocuments } from "@yadad/core";

const dir = new URL("../documents/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const docs = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as unknown);
const result = validateDocuments(docs);
if (result.ok) console.log(`OK: ${files.length} documents valid.`);
else {
  for (const e of result.errors) {
    const file = files[docs.findIndex((d) => (d as { id?: string }).id === e.document)] ?? e.document;
    console.error(`documents/${file} ${e.path || "/"} [${e.code}] ${e.message}`);
  }
  process.exit(1);
}
