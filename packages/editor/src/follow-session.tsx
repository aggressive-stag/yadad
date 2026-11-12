import type { Document } from "@yadad/core";
import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";
import { finish, follow, markSaving, startSession } from "./session.js";
import type { EditSession } from "./session.js";

/**
 * The session an editor holds. It follows the document prop: when the host
 * stores a Save and passes the stored document back, the session is clean
 * again and the next Save is one revision higher; Undo still steps back past
 * the Save. `save` hands the host the finished document.
 */
export function useEditSession<T extends Document>(doc: T, onSave: (doc: T) => void): {
  readonly session: EditSession<T>;
  readonly setSession: (session: EditSession<T>) => void;
  /** Saves `session` (default: the current one): the host gets `finish(session)`, and the session keeps the edits `session` holds. */
  readonly save: (session?: EditSession<T>) => void;
} {
  const [held, setHeld] = useState<EditSession<T>>(() => startSession(doc));
  const session = follow(held, doc);
  if (session !== held) setHeld(session);
  return {
    session,
    setSession: setHeld,
    save: (s = session) => {
      setHeld(markSaving(s));
      onSave(finish(s));
    },
  };
}

/**
 * Sits outside an editor. A document with another id, or at a revision the
 * editor did not produce, starts a fresh session (the children are remounted
 * with it, so nothing of the old document is left in their state); the
 * stored document the editor produced, or the same revision again, does not.
 * The children always see a document that changes only when it should.
 */
export function FollowDocument<T extends Document>({ doc, onSave, children }: {
  readonly doc: T;
  readonly onSave: (doc: T) => void;
  readonly children: (doc: T, onSave: (doc: T) => void) => ReactNode;
}): ReactNode {
  const [anchor, setAnchor] = useState<{ readonly key: number; readonly doc: T }>({ key: 0, doc });
  const produced = useRef<{ readonly id: string; readonly revision: number } | undefined>(undefined);
  let current = anchor;
  if (doc !== anchor.doc && !(doc.id === anchor.doc.id && doc.revision === anchor.doc.revision)) {
    const ours = produced.current?.id === doc.id && produced.current.revision === doc.revision && doc.id === anchor.doc.id;
    current = { key: ours ? anchor.key : anchor.key + 1, doc };
    setAnchor(current);
  }
  return <Fragment key={current.key}>{children(current.doc, (saved) => { produced.current = { id: saved.id, revision: saved.revision }; onSave(saved); })}</Fragment>;
}
