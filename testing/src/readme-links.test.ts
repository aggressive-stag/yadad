import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readmes(): string[] {
  const files = [join(root, "README.md"), join(root, "rfcs/README.md")];
  const pkgs = join(root, "packages");
  for (const name of readdirSync(pkgs)) {
    const f = join(pkgs, name, "README.md");
    if (existsSync(f)) files.push(f);
  }
  return files;
}

/** Relative Markdown links `[text](target)` whose target file does not exist. */
export function brokenLinks(file: string, text: string): string[] {
  const broken: string[] = [];
  // Skip fenced code blocks: samples there are not links.
  const prose = text.replace(/```[\s\S]*?```/g, "");
  for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1] ?? "";
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]?.split("?")[0] ?? "");
    if (path === "") continue;
    if (!existsSync(resolve(dirname(file), path))) {
      broken.push(`${file.slice(root.length + 1)}: link (${target}) points at a missing file`);
    }
  }
  return broken;
}

describe("README links", () => {
  it("every relative Markdown link in the READMEs points at an existing file", () => {
    const broken = readmes().flatMap((f) => brokenLinks(f, readFileSync(f, "utf8")));
    expect(broken).toEqual([]);
  });

  it("detects a missing target", () => {
    const f = join(root, "README.md");
    expect(brokenLinks(f, "[x](rfcs/0010-consumer-feedback.md)")).toHaveLength(1);
  });
});
