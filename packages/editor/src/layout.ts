import type { DashboardView } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";

/** Where an item lives in the dashboard document, as JSON Pointer segments. */
function itemPath(dashboard: DashboardView, tabId: string, itemId: string): string {
  const t = dashboard.tabs.findIndex((tab) => tab.id === tabId);
  const i = dashboard.tabs[t]?.items.findIndex((item) => item.id === itemId) ?? -1;
  if (t < 0 || i < 0) throw new Error(`No item "${itemId}" on tab "${tabId}".`);
  return `/tabs/${t}/items/${i}`;
}

/** Patch moving an item to column x, row y. The `test` guards against editing a stale document. */
export function moveItem(dashboard: DashboardView, tabId: string, itemId: string, x: number, y: number): PatchOperation[] {
  const path = itemPath(dashboard, tabId, itemId);
  return [
    { op: "test", path: `${path}/id`, value: itemId },
    { op: "replace", path: `${path}/x`, value: x },
    { op: "replace", path: `${path}/y`, value: y },
  ];
}

/** Patch resizing an item to w columns by h rows. */
export function resizeItem(dashboard: DashboardView, tabId: string, itemId: string, w: number, h: number): PatchOperation[] {
  const path = itemPath(dashboard, tabId, itemId);
  return [
    { op: "test", path: `${path}/id`, value: itemId },
    { op: "replace", path: `${path}/w`, value: w },
    { op: "replace", path: `${path}/h`, value: h },
  ];
}
