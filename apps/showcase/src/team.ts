import { ForbiddenError } from "@yadad/core";
import type { BoardView, DashboardView, DataAdapter, FormView, TableView, ViewDocument, ViewerDocument } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { PEOPLE } from "./tasks";
import type { PRIORITIES, STATUSES } from "./tasks";

/**
 * A generic shared task list for the "View as" demo (RFC 0006): one viewer
 * document with a role and a plan, a board, a table and a form that offer
 * different things to each role, and a dashboard that hides one widget by plan.
 * Done tasks are locked to the owner role (a per-record permission the data
 * source states), and the data source refuses one move the documents allow
 * (an editor completing a task), so the server stays the authority.
 */

export const ROLES = ["viewer", "editor", "owner"] as const;

export const teamViewer: ViewerDocument = {
  kind: "viewer",
  specVersion: 5,
  id: "viewer",
  revision: 1,
  facts: [
    { id: "role", label: "Role", type: "select", options: { source: "static", values: [...ROLES] }, default: "viewer" },
    { id: "plan", label: "Plan", type: "select", options: { source: "static", values: ["free", "pro"] }, default: "free" },
  ],
};

const role = (...values: string[]) => ({ op: "viewerIn" as const, fact: "role", values });
const plan = (...values: string[]) => ({ op: "viewerIn" as const, fact: "plan", values });

export const teamBoard: BoardView = {
  kind: "board",
  specVersion: 9,
  id: "team_board",
  title: "Team board",
  entity: "task",
  revision: 1,
  dataSource: "team",
  groupBy: [{ field: "owner" }, { field: "status" }, { field: "priority" }],
  columnsFrom: "options",
  doneField: "done",
  titleField: "title",
  cardFields: ["owner", "priority"],
  sort: [{ field: "title", dir: "asc" }],
  editable: true,
  editableWhen: role("editor", "owner"),
};

export const teamTable: TableView = {
  kind: "table",
  specVersion: 5,
  id: "team_table",
  title: "Team tasks",
  entity: "task",
  revision: 1,
  dataSource: "team",
  columns: [
    { field: "title", editable: true, editableWhen: role("editor", "owner") },
    { field: "status", editable: true, editableWhen: role("editor", "owner") },
    { field: "owner", visibleWhen: role("editor", "owner") },
    { field: "priority", editable: true, editableWhen: role("owner") },
  ],
  sort: [{ field: "title", dir: "asc" }],
};

export const teamForm: FormView = {
  kind: "form",
  specVersion: 5,
  id: "team_form",
  entity: "task",
  revision: 1,
  dataSource: "team",
  sections: [
    {
      id: "main",
      title: "New task",
      items: [{ field: "title" }, { field: "status", visibleWhen: role("owner") }, { field: "owner", visibleWhen: role("editor", "owner") }, { field: "priority" }],
    },
  ],
};

export const teamHome: DashboardView = {
  kind: "dashboard",
  specVersion: 5,
  id: "team_home",
  title: "Team",
  revision: 1,
  tabs: [
    {
      id: "board",
      title: "Board",
      items: [
        { id: "board", x: 0, y: 0, w: 9, h: 10, widget: "view", view: "team_board" },
        { id: "open", x: 9, y: 0, w: 3, h: 2, widget: "count", label: "Open tasks", view: "team_table", filter: { op: "neq", field: "status", value: "Done" }, visibleWhen: plan("pro") },
      ],
    },
    { id: "table", title: "Table", items: [{ id: "table", x: 0, y: 0, w: 12, h: 8, widget: "view", view: "team_table" }] },
    { id: "new", title: "New task", visibleWhen: role("editor", "owner"), items: [{ id: "form", x: 0, y: 0, w: 12, h: 8, widget: "view", view: "team_form" }] },
  ],
};

export const teamViews: readonly ViewDocument[] = [teamBoard, teamTable, teamForm, teamHome];

const seeds: readonly { title: string; status: (typeof STATUSES)[number]; owner: number; priority: (typeof PRIORITIES)[number] }[] = [
  { title: "Draft the quarterly plan", status: "Backlog", owner: 0, priority: "High" },
  { title: "Collect customer quotes", status: "Backlog", owner: 1, priority: "Medium" },
  { title: "Update the pricing page", status: "In progress", owner: 2, priority: "High" },
  { title: "Fix the export bug", status: "In progress", owner: 3, priority: "Medium" },
  { title: "Review the new onboarding", status: "Review", owner: 0, priority: "Low" },
  { title: "Publish the changelog", status: "Review", owner: 1, priority: "Medium" },
  { title: "Close the old tickets", status: "Done", owner: 2, priority: "Low" },
  { title: "Sign off the budget", status: "Done", owner: 3, priority: "High" },
];

/**
 * The data source for the team demo. `getRole` reads the current "View as"
 * role at read and write time, as a server reads the signed-in user. Done
 * tasks are locked unless the role is owner (`can.update: false`, and the
 * memory adapter refuses writes to them with a 403). Independently, moving a
 * task to Done is refused for anyone but an owner, though the board offers it
 * to editors: the 403 path.
 */
export function teamAdapter(getRole: () => string): DataAdapter {
  const db = createMemoryAdapter({
    recordPermissions: (record) => (record.entityId === "task" && record.values["status"] === "Done" && getRole() !== "owner" ? { update: false } : undefined),
  });
  PEOPLE.forEach((name) => void db.create("person", { name }, { entityRevision: 1 }));
  seeds.forEach((t, i) => void db.create("task", { ref: `TSK-${String(i + 1).padStart(3, "0")}`, title: t.title, status: t.status, owner: String(t.owner + 1), priority: t.priority }, { entityRevision: 1 }));
  return {
    ...db,
    update: async (entity, id, patch, meta) => {
      if (entity === "task" && patch["status"] === "Done" && getRole() !== "owner") {
        throw new ForbiddenError("Only an owner can complete a task.");
      }
      return db.update(entity, id, patch, meta);
    },
  };
}
