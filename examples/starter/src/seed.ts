import type { DataAdapter } from "@yadad/core";

const day = (n: number): string => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** A few records through any adapter: the memory one at start, or the server once (`npm run dev` does it on an empty database). */
export async function seed(a: DataAdapter): Promise<void> {
  const meta = { entityRevision: 1 };
  const people = await Promise.all(["Ada", "Grace", "Linus"].map((name) => a.create("person", { name }, meta)));
  const rows: [string, number, string, number, string?][] = [
    ["Write the release notes", 0, "In progress", 2],
    ["Fix the login redirect", 1, "Blocked", -2, "Waiting on the identity team."],
    ["Review the pricing page", 2, "To do", 5],
    ["Archive the old exports", 0, "Done", -6],
    ["Plan the offsite", 1, "To do", 12],
  ];
  const tasks = [];
  for (const [title, who, status, due, notes] of rows) {
    tasks.push(await a.create("task", { title, assignee: people[who]!.id, status, due: day(due), ...(notes ? { notes } : {}) }, meta));
  }
  for (const [i, title] of ["Draft", "Review", "Publish"].entries()) {
    await a.create("subtask", { task: tasks[0]!.id, title, done: i === 0, position: i }, meta);
  }
}
