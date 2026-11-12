import { readFileSync } from "node:fs";
import { describeContract, validateDocuments } from "@yadad/core";
import { describe, expect, it } from "vitest";

const reference = readFileSync(new URL("../../docs/reference.md", import.meta.url), "utf8");

/** Every fenced json block of docs/reference.md, parsed. They are all documents and form one set. */
export function referenceDocuments(text: string): unknown[] {
  return [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m, i) => {
    try {
      return JSON.parse(m[1] ?? "") as unknown;
    } catch (error) {
      throw new Error(`docs/reference.md: json block ${i + 1} does not parse: ${String(error)}`);
    }
  });
}

describe("docs/reference.md", () => {
  it("has examples that validate together as one document set", () => {
    const docs = referenceDocuments(reference);
    expect(docs.length).toBeGreaterThan(8);
    const result = validateDocuments(docs);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("has an example of every document kind", () => {
    const kinds = new Set(referenceDocuments(reference).map((d) => (d as { kind?: string }).kind));
    for (const { kind } of describeContract().documentKinds) expect(kinds.has(kind), `no ${kind} example`).toBe(true);
  });

  it("names every field type, widget and condition operator, and uses each field type", () => {
    const contract = describeContract();
    const missing: string[] = [];
    const used = JSON.stringify(referenceDocuments(reference));
    for (const f of contract.fieldTypes) if (!reference.includes(`\`${f.type}\``) || !used.includes(`"type":"${f.type}"`)) missing.push(`field type ${f.type}`);
    for (const w of contract.widgets) if (!reference.includes(`\`${w.widget}\``) || !used.includes(`"widget":"${w.widget}"`)) missing.push(`widget ${w.widget}`);
    for (const o of contract.conditions.ops) if (!reference.includes(`\`${o.op}\``)) missing.push(`operator ${o.op}`);
    for (const m of contract.measures) if (!reference.includes(`\`${m.op}\``)) missing.push(`measure ${m.op}`);
    expect(missing).toEqual([]);
  });
});
