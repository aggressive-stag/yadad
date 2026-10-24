import type { DocumentError, TableView } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { startSession } from "./session.js";
import { applyEdit, editRunner, runEdit } from "./save-result.js";

const table: TableView = { specVersion: 4, revision: 1, dataSource: "tasks", kind: "table", id: "task_table", entity: "task", columns: [{ field: "title" }] };

describe("runEdit (card 45e)", () => {
  const harness = () => {
    let session = startSession(table);
    const calls: { setSession: unknown[]; setProblems: (readonly DocumentError[])[] } = { setSession: [], setProblems: [] };
    return {
      get session() {
        return session;
      },
      setSession: (next: typeof session) => {
        session = next;
        calls.setSession.push(next);
      },
      setProblems: (errors: readonly DocumentError[]) => void calls.setProblems.push(errors),
      calls,
    };
  };

  test("a rejected edit lands in problems, the document does not move, onOk stays quiet", () => {
    const h = harness();
    let ok = false;
    // A replace on a path that does not exist: applyPatch itself refuses it.
    const rejected = runEdit([{ op: "replace", path: "/nope", value: "x" }], h.session, h.setSession, h.setProblems, () => {
      ok = true;
    });
    expect(rejected).toBe(false);
    expect(ok).toBe(false);
    // Like the callback it replaces, applyEdit stores the session even when
    // rejected (it carries the reason); what must not move is the document.
    expect(h.calls.setSession.length).toBe(1);
    expect(h.session.current).toEqual(table);
    expect(h.calls.setProblems.length).toBe(1);
    expect(h.calls.setProblems[0]?.[0]?.message).toContain("could not be applied");
  });

  test("a clean edit moves the session, clears problems and calls onOk", () => {
    const h = harness();
    let ok = false;
    const applied = runEdit([{ op: "add", path: "/columns/0/editable", value: true }], h.session, h.setSession, h.setProblems, () => {
      ok = true;
    });
    expect(applied).toBe(true);
    expect(ok).toBe(true);
    expect(h.calls.setSession.length).toBe(1);
    expect(h.calls.setProblems).toEqual([[]]); // cleared once by applyEdit
    expect(h.session.current.columns[0]?.editable).toBe(true);
  });

  test("an empty patch is not an edit: onOk runs, no session write", () => {
    const h = harness();
    let ok = false;
    expect(runEdit([], h.session, h.setSession, h.setProblems, () => {
      ok = true;
    })).toBe(true);
    expect(ok).toBe(true);
    expect(h.calls.setSession).toEqual([]);
    expect(h.calls.setProblems).toEqual([]);
  });

  test("an ok:false result sets only its own error", () => {
    const h = harness();
    const error: DocumentError = { path: "", code: "invalid-value", message: "no", hint: "why" };
    expect(runEdit({ ok: false, error }, h.session, h.setSession, h.setProblems)).toBe(false);
    expect(h.calls.setProblems).toEqual([[error]]);
    expect(h.calls.setSession).toEqual([]);
  });

  test("editRunner binds once and behaves like runEdit", () => {
    const h = harness();
    const run = editRunner(h.session, h.setSession, h.setProblems);
    expect(run([{ op: "replace", path: "/nope", value: "x" }])).toBe(false);
    expect(h.calls.setProblems[0]?.[0]?.message).toContain("could not be applied");
  });

  test("applyEdit applies and reports the rejection in one step", () => {
    const h = harness();
    const next = applyEdit(h.session, [{ op: "add", path: "/columns/0/editable", value: true }], h.setSession, h.setProblems);
    expect(next.rejected).toEqual([]);
    expect(h.calls.setProblems).toEqual([[]]);
  });
});

