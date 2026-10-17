import type { DocumentError, ResolvedViewer, ViewDocument } from "@yadad/core";
import { resolveViewer, viewerLeavesRead } from "@yadad/runtime";
import { useMemo } from "react";
import type { DocumentSet } from "./document-set.js";

/** The viewer of a view that reads no facts: nothing to resolve. */
const NO_FACTS: ResolvedViewer = { facts: [] };

/** What a renderer uses: the viewer to evaluate with, and a host mistake that stops the view (RFC 0006). */
export interface ViewerSetup {
  readonly viewer: ResolvedViewer;
  readonly error?: DocumentError;
}

/**
 * The viewer a renderer works with. The host's `viewer` prop wins. Without
 * it, a renderer that has the document set resolves the set's viewer document
 * with every fact at its declared default. With neither, a view that reads a
 * viewer fact (its own, the views it embeds, the views its row actions open)
 * gets an error for the summary; a view that reads none needs no viewer.
 */
export function useViewerSetup(prop: ResolvedViewer | undefined, view: ViewDocument, documents?: DocumentSet): ViewerSetup {
  return useMemo(() => {
    if (prop) return { viewer: prop };
    if (documents?.viewer) return { viewer: resolveViewer(documents.viewer).viewer };
    const set = documents ? [...documents.entities.values(), ...documents.views.values()] : [];
    if (viewerLeavesRead(view, set).length === 0) return { viewer: NO_FACTS };
    return {
      viewer: NO_FACTS,
      error: {
        path: "/viewer",
        code: "required",
        message: `View "${view.id}" reads a viewer fact, but no viewer was passed and no viewer document was found.`,
        hint: "Pass viewer={resolveViewer(viewerDocument, facts)}",
      },
    };
  }, [prop, view, documents]);
}
