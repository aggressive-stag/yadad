import { AdapterError } from "@yadad/core";
import type { DataAdapter, EntityDocument } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";

/**
 * A generic task demo for the showcase's board page: a status, an owner
 * (a reference to a person) and a priority, all three groupable. Enough
 * tasks that the first column scrolls. Moving a task to "Done" is refused
 * (400) by the adapter wrapper below while the task has no owner.
 */

export const STATUSES = ["Backlog", "In progress", "Review", "Done"] as const;
export const PRIORITIES = ["Low", "Medium", "High"] as const;
export const PEOPLE = ["Ada", "Grace", "Linus", "Margaret"] as const;
/** Free-text tags (RFC 0008 item 15): a tags field, quick-filterable and name-filterable. */
export const TAGS = ["urgent", "home", "weekly"] as const;

export const personEntity: EntityDocument = {
  kind: "entity",
  specVersion: 3,
  id: "person",
  revision: 1,
  fields: [{ id: "name", type: "text", label: "Name", required: true }],
};

export const taskEntity: EntityDocument = {
  kind: "entity",
  specVersion: 8,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", required: true, options: { source: "static", values: [...STATUSES] } },
    { id: "owner", type: "reference", label: "Owner", entity: "person", display: "name" },
    { id: "priority", type: "select", label: "Priority", required: true, options: { source: "static", values: [...PRIORITIES] } },
    { id: "tags", type: "tags", label: "Tags" },
    { id: "due_time", type: "time", label: "Due time" },
    { id: "done", type: "boolean", label: "Done" },
  ],
};

/** The child entity of the batch form's sub-record checklist (RFC 0009 item 3). */
export const checklistItemEntity: EntityDocument = {
  kind: "entity",
  specVersion: 8,
  id: "checklist_item",
  revision: 1,
  fields: [
    { id: "task", type: "reference", label: "Task", entity: "task", display: "title", required: true },
    { id: "title", type: "text", label: "Item", required: true },
    { id: "done", type: "boolean", label: "Done" },
    { id: "order", type: "number", label: "Order" },
  ],
};

interface TaskSeed {
  readonly title: string;
  readonly status: (typeof STATUSES)[number];
  /** Index into PEOPLE, or undefined for an unowned task. */
  readonly owner?: number;
  readonly priority: (typeof PRIORITIES)[number];
  readonly tags?: readonly string[];
  readonly done?: boolean;
  readonly due_time?: string;
}

const named: readonly TaskSeed[] = [
  { title: "Write the release notes", status: "In progress", owner: 0, priority: "High", tags: ["urgent"], due_time: "17:00" },
  { title: "Fix the login redirect", status: "In progress", owner: 1, priority: "High", tags: ["urgent", "weekly"] },
  { title: "Review the pricing page", status: "Review", owner: 2, priority: "Medium", tags: ["home"] },
  { title: "Audit the dependencies", status: "Review", owner: 3, priority: "Low", due_time: "23:59" },
  { title: "Set up the staging site", status: "Done", owner: 0, priority: "Medium", done: true },
  { title: "Archive the old exports", status: "Done", owner: 1, priority: "Low", done: true },
  { title: "Triage new feedback", status: "Backlog", priority: "Medium", tags: ["weekly"] },
];

/** About thirty tasks: most sit in Backlog so that column scrolls; a few are unowned. */
export function taskSeeds(): readonly TaskSeed[] {
  const filler: TaskSeed[] = Array.from({ length: 24 }, (_, i) => ({
    title: `Backlog item ${String(i + 1).padStart(2, "0")}`,
    status: "Backlog",
    ...(i % 6 === 5 ? {} : { owner: i % PEOPLE.length }),
    priority: PRIORITIES[i % PRIORITIES.length] ?? "Low",
    ...(i % 3 === 0 ? { tags: [TAGS[i % TAGS.length] ?? "weekly"] } : {}),
  }));
  return [...named, ...filler];
}

/**
 * The adapter the showcase points the board at, seeded with people and
 * tasks. The people are created first, so their ids (the memory adapter
 * numbers records from 1) are the owner values of the tasks. One data rule:
 * a task with no owner cannot be moved to Done. The adapter says so with a
 * 400 and a readable message, exactly as a server would; the board then
 * reverts the move and shows the message.
 */
export function tasksAdapter(): DataAdapter {
  const db = createMemoryAdapter();
  // The memory adapter numbers records from 1 and writes before its first await, so the
  // people created here get the ids "1" to "4" at once; the tasks reference them.
  PEOPLE.forEach((name) => void db.create("person", { name }, { entityRevision: 1 }));
  for (const t of taskSeeds()) {
    const owner = t.owner === undefined ? null : String(t.owner + 1);
    void db.create("task", { title: t.title, status: t.status, owner, priority: t.priority, tags: [...(t.tags ?? [])], due_time: t.due_time ?? null, done: t.done ?? false }, { entityRevision: 1 });
  }
  // Checklist children (RFC 0009 item 3): two items on the first task, one done.
  void db.create("checklist_item", { task: "1", title: "Draft the outline", done: true, order: 1 }, { entityRevision: 1 });
  void db.create("checklist_item", { task: "1", title: "Get a second read", done: false, order: 2 }, { entityRevision: 1 });
  return {
    ...db,
    update: async (entity, id, patch, meta) => {
      if (entity === "task" && patch["status"] === "Done") {
        const current = await db.findOne("task", id);
        const owner = "owner" in patch ? patch["owner"] : current?.values["owner"];
        if (owner === null || owner === undefined || owner === "") {
          throw new AdapterError("validation", `"${String(current?.values["title"] ?? "This task")}" has no owner. Give it an owner before moving it to Done.`);
        }
      }
      return db.update(entity, id, patch, meta);
    },
  };
}
