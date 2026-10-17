import { AdapterError } from "@yadad/core";
import { expect, test } from "vitest";
import { taskSeeds, tasksAdapter } from "./tasks";

const find = (db: ReturnType<typeof tasksAdapter>, entity: string) => db.find(entity, { page: { limit: 100, offset: 0 } });

test("the tasks are seeded and owners point at the seeded people", async () => {
  const db = tasksAdapter();
  const people = await find(db, "person");
  const tasks = await find(db, "task");
  expect(tasks.total).toBe(taskSeeds().length);
  const ids = new Set(people.items.map((p) => p.id));
  for (const t of tasks.items) {
    const owner = t.values["owner"];
    expect(owner === null || ids.has(String(owner))).toBe(true);
  }
});

test("a task without an owner cannot move to Done, one with an owner can", async () => {
  const db = tasksAdapter();
  const { items } = await find(db, "task");
  const unowned = items.find((t) => t.values["owner"] === null);
  const owned = items.find((t) => t.values["owner"] !== null && t.values["status"] === "Backlog");
  if (!unowned || !owned) throw new Error("seed changed");
  await expect(db.update("task", unowned.id, { status: "Done" }, { entityRevision: 1, baseVersion: unowned.version })).rejects.toBeInstanceOf(AdapterError);
  const moved = await db.update("task", owned.id, { status: "Done" }, { entityRevision: 1, baseVersion: owned.version });
  expect(moved.values["status"]).toBe("Done");
});
