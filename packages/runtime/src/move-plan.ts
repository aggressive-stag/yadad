import type { RecordValues } from "@yadad/core";

/** Why nothing is sent: the entry/card is already where it is being moved, or the view is not editable. */
export type MoveNoneReason = "not-editable" | "same-day" | "same-column";

/** Why the destination refuses the move (card 45d): one vocabulary for calendar days and board columns. */
export type MoveBlockedReason = "other" | "before-min" | "after-max";

/**
 * What a move should do — an entry to a day (`moveDay`) or a card to a
 * column (`moveCard`). Pure data: the renderer performs the update. One
 * union for both views (card 45d): the do-nothing, refused and write cases
 * read the same way wherever a move is planned.
 */
export type MovePlan =
  /** Nothing to send. */
  | { readonly kind: "none"; readonly reason: MoveNoneReason }
  /** The destination cannot take it; nothing is sent, `message` says why to the user. */
  | { readonly kind: "blocked"; readonly reason: MoveBlockedReason; readonly message: string }
  /** `adapter.update(entity, id, patch, meta)`. Only the moved field is sent; `null` clears it. */
  | {
      readonly kind: "update";
      readonly entity: string;
      readonly id: string;
      readonly patch: RecordValues;
      readonly meta: { readonly entityRevision: number; readonly baseVersion: string };
    };
