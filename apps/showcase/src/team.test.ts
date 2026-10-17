import { ForbiddenError } from "@yadad/core";
import { expect, test } from "vitest";
import { teamAdapter } from "./team";

const done = async (role: string) => {
  const adapter = teamAdapter(() => role);
  const page = await adapter.find("task", { filter: { op: "eq", field: "status", value: "Done" } } as never);
  return { adapter, record: page.items[0] };
};

test("Done tasks are locked for everyone but the owner role", async () => {
  expect((await done("editor")).record?.can).toEqual({ update: false });
  expect((await done("owner")).record?.can).toBeUndefined();
});

test("the data source refuses an editor completing a task that the documents let them move", async () => {
  const adapter = teamAdapter(() => "editor");
  const page = await adapter.find("task", {} as never);
  const open = page.items.find((r) => r.values["status"] === "Review");
  await expect(adapter.update("task", open?.id ?? "", { status: "Done" }, { entityRevision: 1, version: open?.version ?? "" } as never)).rejects.toBeInstanceOf(ForbiddenError);
});
