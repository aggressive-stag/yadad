import type { Document, DocumentError, Registry, ViewerDocument, ViewerFact } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useReportChange } from "./report-change.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { asText, choiceField, idFromTitle, propertyInput, toolbarStyle, warningList } from "./ui.js";
import { addViewerFact, addViewerFactValue, moveViewerFact, newViewerFact, removeViewerFact, removeViewerFactValue, setViewerFactDefault, setViewerFactLabel, viewerEditConflicts } from "./viewer.js";

export interface ViewerPanelProps {
  readonly viewer: ViewerDocument;
  readonly registry: Registry<ReactNode>;
  /**
   * The other documents of the set. With them, removing a fact or a value that
   * a view's condition still reads is refused, and the places that read it are
   * listed. Without them nothing else is checked.
   */
  readonly documents?: readonly Document[];
  /** Receives the edited viewer document with its revision bumped. */
  readonly onSave: (viewer: ViewerDocument) => void;
  /** Called with the document as it is edited, after every edit, undo or redo. */
  readonly onChange?: (viewer: ViewerDocument) => void;
  readonly onCancel: () => void;
}

type Result = { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

const KIND_CHOICES = ["Select", "Yes or no"] as const;
const TYPE_WORDS = { select: "A choice from a list (a role, a plan)", boolean: "Yes or no (a feature flag)" } as const;

/** What an edit would break, as errors the registry's ErrorSummary can list. */
function conflictErrors(conflicts: readonly DocumentError[]): DocumentError[] {
  return conflicts.map((c) => ({
    path: `${c.document ?? ""}${c.path}`,
    code: "invalid-value",
    message: `${c.document ?? "A document"}${c.path}: ${c.message}`,
    hint: "Something still reads this. Change or remove that condition first, then make this edit.",
  }));
}

/**
 * Declares the facts a host can tell the renderers about the viewer (RFC
 * 0006): add, remove and reorder facts, rename them, edit a choice fact's
 * values, and pick each fact's default (what a viewer the host says nothing
 * about gets). A fact's id and type are fixed once it is made. Every edit is
 * one undoable patch. Given the other documents, an edit that a condition
 * still depends on is refused and the places that read it are listed.
 */
export function ViewerPanel({ viewer, registry, documents, onSave, onChange, onCancel }: ViewerPanelProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<ViewerDocument>>(() => startSession(viewer));
  useReportChange(session.current, onChange);
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [status, setStatus] = useState("");
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({});
  const [newValues, setNewValues] = useState<Readonly<Record<string, string>>>({});
  const [newFact, setNewFact] = useState({ label: "", type: "select" as ViewerFact["type"] });
  const { Button, Section, ErrorSummary } = registry.layout;
  const current = session.current;

  const run = (result: Result, done?: string, onOk?: () => void) => {
    if (!result.ok) return setProblems([result.error]);
    if (result.patch.length === 0) return onOk?.();
    const next = edit(session, result.patch);
    if (next.rejected.length > 0) return setProblems(next.rejected);
    const conflicts = documents ? viewerEditConflicts(current, next.current, documents) : [];
    if (conflicts.length > 0) return setProblems(conflictErrors(conflicts));
    setSession(next);
    setProblems([]);
    setStatus(done ?? "");
    onOk?.();
  };

  const factView = (fact: ViewerFact, index: number): ReactNode => {
    const label = labels[fact.id] ?? fact.label;
    const newValue = newValues[fact.id] ?? "";
    return (
      <Section key={fact.id} id={`${base}-fact-${fact.id}`} title={`Fact: ${fact.label}`}>
        <p>
          Id <code>{fact.id}</code>, {TYPE_WORDS[fact.type]}.
        </p>
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {propertyInput(registry, `${base}-label-${fact.id}`, { id: "label", type: "text", label: `Label of ${fact.id}` }, label, (v) => setLabels((l) => ({ ...l, [fact.id]: asText(v) })))}
          <Button label={`Rename ${fact.id}`} type="button" variant="secondary" disabled={label.trim() === fact.label} onPress={() => run(setViewerFactLabel(current, fact.id, label), `${fact.id} is now called ${label.trim()}.`)} />
          <Button label={`Move ${fact.id} up`} type="button" variant="secondary" disabled={index === 0} onPress={() => run(moveViewerFact(current, fact.id, -1), `${fact.label} moved up.`)} />
          <Button label={`Move ${fact.id} down`} type="button" variant="secondary" disabled={index === current.facts.length - 1} onPress={() => run(moveViewerFact(current, fact.id, 1), `${fact.label} moved down.`)} />
          <Button label={`Remove fact ${fact.id}`} type="button" variant="secondary" disabled={current.facts.length === 1} onPress={() => run(removeViewerFact(current, fact.id), `${fact.label} removed.`)} />
        </div>
        {fact.type === "select" ? (
          <>
            <ul aria-label={`Values of ${fact.id}`} data-yadad-fact-values={fact.id}>
              {fact.options.values.map((value) => (
                <li key={value}>
                  {value}
                  {value === fact.default ? " (default)" : ""}{" "}
                  <Button label={`Remove ${value} from ${fact.id}`} type="button" variant="secondary" disabled={false} onPress={() => run(removeViewerFactValue(current, fact.id, value), `${value} removed from ${fact.label}.`)} />
                </li>
              ))}
            </ul>
            <div data-yadad-editor-toolbar="" style={toolbarStyle}>
              {propertyInput(registry, `${base}-value-${fact.id}`, { id: "value", type: "text", label: `New value of ${fact.id}` }, newValue, (v) => setNewValues((n) => ({ ...n, [fact.id]: asText(v) })))}
              <Button
                label={`Add value to ${fact.id}`}
                type="button"
                variant="secondary"
                disabled={newValue.trim() === ""}
                onPress={() => run(addViewerFactValue(current, fact.id, newValue), `${newValue.trim()} added to ${fact.label}.`, () => setNewValues((n) => ({ ...n, [fact.id]: "" })))}
              />
              {propertyInput(registry, `${base}-default-${fact.id}`, choiceField("default", `Default of ${fact.id} (for a viewer nobody described)`, fact.options.values), fact.default, (v) =>
                run(setViewerFactDefault(current, fact.id, asText(v)), `${fact.label} defaults to ${asText(v)}.`),
              )}
            </div>
          </>
        ) : (
          <div data-yadad-editor-toolbar="" style={toolbarStyle}>
            {propertyInput(registry, `${base}-default-${fact.id}`, { id: "default", type: "boolean", label: `Default of ${fact.id} is on` }, fact.default, (v) => run(setViewerFactDefault(current, fact.id, v === true), `${fact.label} defaults to ${v === true ? "on" : "off"}.`))}
          </div>
        )}
      </Section>
    );
  };

  return (
    <div data-yadad-viewer-panel={viewer.id}>
      <p id={`${base}-help`}>
        Facts are what the host tells the screens about the person looking: a role, a plan, a flag. Conditions on views read them. The default is what a viewer the host says nothing about gets, so pick the least-privileged value.
      </p>
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save viewer facts" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {problems.length > 0 && <ErrorSummary errors={problems} />}
      {warningList(current)}
      <Section id={`${base}-add`} title="Add a fact">
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {propertyInput(registry, `${base}-new-label`, { id: "new_fact", type: "text", label: "New fact name" }, newFact.label, (v) => setNewFact((n) => ({ ...n, label: asText(v) })))}
          {propertyInput(registry, `${base}-new-type`, choiceField("new_type", "Kind of fact", KIND_CHOICES), newFact.type === "select" ? "Select" : "Yes or no", (v) =>
            setNewFact((n) => ({ ...n, type: v === "Yes or no" ? "boolean" : "select" })),
          )}
          <Button
            label="Add fact"
            type="button"
            variant="primary"
            disabled={newFact.label.trim() === ""}
            onPress={() => {
              const id = idFromTitle(newFact.label, current.facts.map((f) => f.id), "fact");
              run(addViewerFact(current, newViewerFact(id, newFact.label.trim(), newFact.type)), `Added ${newFact.label.trim()}.`, () => setNewFact((n) => ({ ...n, label: "" })));
            }}
          />
        </div>
      </Section>
      {current.facts.map(factView)}
      <p aria-live="polite" data-yadad-editor-status="">
        {status}
      </p>
    </div>
  );
}
