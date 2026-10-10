import type { Condition, DashboardView, GridItem } from "@yadad/core";
import type { Json, PatchOperation } from "@yadad/runtime";

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

/** A widget to place, without its position: the editor finds a free spot. */
export type NewWidget = { readonly widget: "view"; readonly view: string } | { readonly widget: "count"; readonly label: string; readonly view: string; readonly filter?: Condition };

const DEFAULT_GRID_COLUMNS = 12;

/** The first row-major spot where a w×h box fits without overlapping anything. */
export function freeSpot(items: readonly Pick<GridItem, "x" | "y" | "w" | "h">[], columns: number, w: number, h: number): { x: number; y: number } {
  const width = Math.min(w, columns);
  const clash = (x: number, y: number) => items.some((b) => x < b.x + b.w && b.x < x + width && y < b.y + b.h && b.y < y + h);
  for (let y = 0; ; y++) {
    for (let x = 0; x + width <= columns; x++) if (!clash(x, y)) return { x, y };
  }
}

/** An item id not used on the tab yet, derived from a base like a view id. */
export function uniqueItemId(dashboard: DashboardView, tabId: string, base: string): string {
  const used = new Set(dashboard.tabs.find((t) => t.id === tabId)?.items.map((i) => i.id) ?? []);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Patch adding a widget to a tab, w×h at the first free spot. */
export function addWidget(dashboard: DashboardView, tabId: string, itemId: string, widget: NewWidget, w: number, h: number): PatchOperation[] {
  const t = dashboard.tabs.findIndex((tab) => tab.id === tabId);
  const tab = dashboard.tabs[t];
  if (!tab) throw new Error(`No tab "${tabId}".`);
  const columns = tab.columns ?? DEFAULT_GRID_COLUMNS;
  const width = Math.min(w, columns);
  const { x, y } = freeSpot(tab.items, columns, width, h);
  return [
    { op: "test", path: `/tabs/${t}/id`, value: tabId },
    { op: "add", path: `/tabs/${t}/items/-`, value: { id: itemId, x, y, w: width, h, ...widget } as unknown as Json },
  ];
}

/** Patch removing a widget. The view it showed stays as it is. */
export function removeWidget(dashboard: DashboardView, tabId: string, itemId: string): PatchOperation[] {
  const path = itemPath(dashboard, tabId, itemId);
  return [
    { op: "test", path: `${path}/id`, value: itemId },
    { op: "remove", path },
  ];
}

/** Patch appending an empty tab. */
export function addTab(dashboard: DashboardView, tabId: string, title: string): PatchOperation[] {
  return [{ op: "add", path: "/tabs/-", value: { id: tabId, title, items: [] } }];
}

/** Patch renaming a tab. */
export function renameTab(dashboard: DashboardView, tabId: string, title: string): PatchOperation[] {
  const t = dashboard.tabs.findIndex((tab) => tab.id === tabId);
  if (t < 0) throw new Error(`No tab "${tabId}".`);
  return [
    { op: "test", path: `/tabs/${t}/id`, value: tabId },
    { op: "replace", path: `/tabs/${t}/title`, value: title },
  ];
}

/** Patch removing a tab and its widgets. Validation refuses removing the last tab. */
export function removeTab(dashboard: DashboardView, tabId: string): PatchOperation[] {
  const t = dashboard.tabs.findIndex((tab) => tab.id === tabId);
  if (t < 0) throw new Error(`No tab "${tabId}".`);
  return [
    { op: "test", path: `/tabs/${t}/id`, value: tabId },
    { op: "remove", path: `/tabs/${t}` },
  ];
}
