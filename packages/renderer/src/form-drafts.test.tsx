// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Condition, DataRecord, EntityDocument, FormView } from "@yadad/core";
import { createDraftStore, createMemoryAdapter } from "@yadad/runtime";
import type { DraftStorage } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "contact",
  revision: 1,
  fields: [
    { id: "name", type: "text", label: "Name", required: true },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["Person", "Company"] } },
    { id: "company", type: "text", label: "Company name" },
  ],
};

const isCompany: Condition = { op: "eq", field: "kind", value: "Company" };
const view: FormView = {
  kind: "form",
  specVersion: 0,
  id: "contact_form",
  entity: "contact",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "s", items: [{ field: "name" }, { field: "kind" }, { field: "company", visibleWhen: isCompany, clearWhenHidden: true }] }],
};

function memoryStorage(): DraftStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function mount(storage: DraftStorage, onSaved?: (r: DataRecord) => void, form: EntityDocument = entity) {
  const store = createDraftStore(storage);
  return render(
    <FormRenderer
      entity={form}
      view={view}
      registry={mockRegistry}
      dataSources={new Map([["default", createMemoryAdapter()]])}
      drafts={{ store, debounceMs: 0 }}
      {...(onSaved ? { onSaved } : {})}
    />,
  );
}

const draftKey = "yadad:draft:contact_form:new";

describe("form drafts", () => {
  test("typed input survives a reload and comes back with a notice", async () => {
    const storage = memoryStorage();
    mount(storage);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    await waitFor(() => expect(storage.data.has(draftKey)).toBe(true));

    cleanup();
    mount(storage);
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe("Ada");
    expect(screen.getByRole("status").textContent).toContain("Restored unsaved changes from");
  });

  test("Discard clears the form and the stored draft", async () => {
    const storage = memoryStorage();
    storage.data.set(draftKey, JSON.stringify({ values: { name: "Ada" }, entityRevision: 1, savedAt: Date.now() }));
    mount(storage);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
    expect(storage.data.has(draftKey)).toBe(false);
  });

  test("a successful save clears the draft", async () => {
    const storage = memoryStorage();
    const saved: DataRecord[] = [];
    storage.data.set(draftKey, JSON.stringify({ values: { name: "Ada" }, entityRevision: 1, savedAt: Date.now() }));
    mount(storage, (r) => saved.push(r));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(storage.data.has(draftKey)).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a hidden clearWhenHidden value is not kept in the draft", async () => {
    const storage = memoryStorage();
    mount(storage);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "Company" } });
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    await waitFor(() => expect(JSON.parse(storage.data.get(draftKey) ?? "{}").values?.company).toBe("Acme"));
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "Person" } });
    await waitFor(() => expect(JSON.parse(storage.data.get(draftKey) ?? "{}").values).toEqual({ name: "Ada", kind: "Person" }));

    cleanup();
    mount(storage);
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "Company" } });
    expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("");
  });

  test("a draft from an older entity revision is restored with a warning", () => {
    const storage = memoryStorage();
    storage.data.set(draftKey, JSON.stringify({ values: { name: "Ada", phone: "123" }, entityRevision: 0, savedAt: Date.now() }));
    mount(storage);
    const notice = screen.getByRole("status").textContent ?? "";
    expect(notice).toContain("This form has changed since then");
    expect(notice).toContain("left out");
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe("Ada");
  });
});
