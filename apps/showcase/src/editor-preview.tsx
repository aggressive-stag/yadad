import type { Document, EntityDocument, Registry, ViewDocument } from "@yadad/core";
import { StatesPreview } from "@yadad/editor";
import type { StatesPreviewProps } from "@yadad/editor";
import type { DocumentSet } from "@yadad/renderer";
import type { ViewState } from "@yadad/runtime";
import { sourceStates } from "@yadad/testing";
import { checkViewStates } from "@yadad/testing/state-checks";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { contextFor, enqueueChecks, QUICK_MANY, renderState } from "./states";

/** The documents as a renderer's set. */
function setOf(docs: readonly Document[]): DocumentSet {
  return {
    entities: new Map(docs.filter((d): d is EntityDocument => d.kind === "entity").map((d) => [d.id, d])),
    views: new Map(docs.filter((d): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer").map((d) => [d.id, d])),
  };
}

/**
 * A view editor with the states preview next to it. `editor` receives the
 * `onChange` to hand the editor; the preview follows the edited document and
 * compares it with the document as it was when editing began.
 */
export function WithStatesPreview({ view, documents, registry, editor }: { readonly view: ViewDocument; readonly documents: DocumentSet; readonly registry: Registry<ReactNode>; readonly editor: (onChange: (view: ViewDocument) => void) => ReactNode }): ReactNode {
  const [edited, setEdited] = useState<ViewDocument>(view);
  const [now] = useState(() => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    return d;
  });
  const docs = useMemo<Document[]>(() => [...documents.entities.values(), ...documents.views.values()], [documents]);

  const renderOne: StatesPreviewProps["renderState"] = (state: ViewState, all) => {
    const target = all.find((d): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer" && d.id === state.render.view);
    if (!target) return null;
    const source = sourceStates({ view: target.id, axes: [], states: [state], skipped: [], strategy: "full", complete: true }, all).states[0];
    return source ? renderState(contextFor(source, target, all, registry, now), setOf(all)) : null;
  };

  const checkStates: NonNullable<StatesPreviewProps["checkStates"]> = ({ view: target, documents: all }) =>
    enqueueChecks(() => checkViewStates({ view: target, documents: all, registry, now, manyRecords: QUICK_MANY, render: (_state, context) => renderState(context, setOf(all)) })).then((results) =>
      results.map((r) => ({ id: r.id, problems: r.problems })),
    );

  return (
    <div data-showcase-editor-with-preview="">
      <div>{editor(setEdited)}</div>
      <div>
        <StatesPreview view={edited} saved={view} documents={docs} now={now} renderState={renderOne} checkStates={checkStates} manyRecords={QUICK_MANY} />
      </div>
    </div>
  );
}
