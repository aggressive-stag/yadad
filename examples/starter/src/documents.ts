import type { Document, EntityDocument, ViewDocument } from "@yadad/core";
import { documentSet } from "@yadad/renderer";

// The whole app is these files: one JSON document each. Add a file, get a screen.
const files = import.meta.glob("../documents/*.json", { eager: true, import: "default" });

export const documents = Object.values(files) as Document[];
export const documentFiles = files;
export const docSet = documentSet(documents);

const isView = (d: Document): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer";
export const entities = new Map(documents.filter((d): d is EntityDocument => d.kind === "entity").map((d) => [d.id, d]));
export const views = documents.filter(isView);

/** Views reached from another view (a row action's target) stay out of the nav. */
const targets = new Set(views.flatMap((v) => ("rowAction" in v && v.rowAction ? [v.rowAction.open] : [])));
const order = ["dashboard", "table", "board", "calendar", "form"];
export const navViews = views.filter((v) => !targets.has(v.id)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
export const titleOf = (v: ViewDocument): string => {
  const t = "title" in v && v.title ? v.title : v.id.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
