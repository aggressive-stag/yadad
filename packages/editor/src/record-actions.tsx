import type { DocumentError, EntityDocument, Registry } from "@yadad/core";
import { RECORD_ACTIONS_MAX } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useState } from "react";
import type { ReactNode } from "react";
import { moveOfferedRecordAction, offerRecordAction, setRecordActions, unofferRecordAction } from "./views.js";
import type { ActionOfferingView } from "./views.js";
import { choiceField, propertyInput } from "./ui.js";

/** The three editors' shared callback shape: run a patch result, announce on success. */
export type RunResult = (result: PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError }, onOk?: () => void) => boolean;

export interface RecordActionsPanelProps {
  readonly view: ActionOfferingView;
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /** Run a patch result through the editor's session. */
  readonly run: RunResult;
  /** Announce an outcome for assistive technology. */
  readonly announce: (message: string) => void;
  /** Id prefix for the widgets inside. */
  readonly base: string;
  /** Where the offers show: "row", "card" or "entry". */
  readonly surface: "row" | "card" | "entry";
}

/**
 * "Offer actions" (RFC 0007): an ordered pick of the entity's actions this
 * view offers on each record, 1 to RECORD_ACTIONS_MAX, each once, shown in
 * this order. An empty offer removes the key; the surface then runs no
 * actions. The candidate goes through the validator, so an action removed
 * from the entity since this panel opened is refused, not saved.
 */
export function RecordActionsPanel({ view, entity, registry, run, announce, base, surface }: RecordActionsPanelProps): ReactNode {
  const { Button, Section, Table } = registry.layout;
  const offered = view.recordActions ?? [];
  const labelOf = (id: string) => (entity.actions ?? []).find((a) => a.id === id)?.label ?? id;
  const notOffered = (entity.actions ?? []).filter((a) => !offered.includes(a.id));
  const [choice, setChoice] = useState<string | undefined>(notOffered[0]?.id);
  const picked = notOffered.find((a) => a.id === choice) ?? notOffered[0];

  const columns = ["Order", "Action", "Id", "Moves"].map((label) => ({ id: `offer-${label.toLowerCase()}`, headerId: `${base}-offer-col-${label}`, label, sortable: false }));
  const rows = offered.map((id, i) => ({
    id,
    cells: [
      String(i + 1),
      labelOf(id),
      id,
      <span key="moves" style={{ display: "inline-flex", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
        <Button label={`Move ${labelOf(id)} up`} type="button" variant="secondary" disabled={i === 0} onPress={() => run(moveOfferedRecordAction(view, entity, id, -1), () => announce(`Moved ${labelOf(id)} to position ${i}.`))} />
        <Button label={`Move ${labelOf(id)} down`} type="button" variant="secondary" disabled={i === offered.length - 1} onPress={() => run(moveOfferedRecordAction(view, entity, id, 1), () => announce(`Moved ${labelOf(id)} to position ${i + 2}.`))} />
        <Button label={`Stop offering ${labelOf(id)}`} type="button" variant="secondary" disabled={false} onPress={() => run(unofferRecordAction(view, entity, id), () => announce(`Stopped offering ${labelOf(id)}.`))} />
      </span>,
    ],
  }));

  return (
    <Section id={`${base}-offers`} title="Offer actions">
      <Table
        caption={`Actions ${surface === "row" ? "offered on each row" : surface === "card" ? "offered on each card" : "offered on each entry"}`}
        columns={columns}
        rows={rows}
        onSort={() => {}}
        empty={entity.actions === undefined || entity.actions.length === 0 ? `Entity "${entity.id}" declares no actions; add them on the entity first.` : "Nothing is offered: the server runs no actions from this view."}
      />
      {offered.length > 0 && (
        <Button label="Offer nothing" type="button" variant="secondary" disabled={false} onPress={() => run(setRecordActions(view, entity, []), () => announce("Stopped offering every action."))} />
      )}
      {notOffered.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          {propertyInput(
            registry,
            `${base}-offer-choice`,
            choiceField(`${base}-offer-choice`, "Action", notOffered.map((a) => `${a.label} (${a.id})`)),
            picked ? `${picked.label} (${picked.id})` : undefined,
            (v) => {
              const found = notOffered.find((a) => `${a.label} (${a.id})` === v);
              setChoice(found?.id);
            },
          )}
          <Button
            label="Offer this action"
            type="button"
            variant="secondary"
            disabled={picked === undefined || offered.length >= RECORD_ACTIONS_MAX}
            onPress={() => picked !== undefined && run(offerRecordAction(view, entity, picked.id), () => announce(`Offering ${picked.label}.`))}
          />
        </div>
      ) : offered.length < RECORD_ACTIONS_MAX ? null : (
        <p>A view offers at most {RECORD_ACTIONS_MAX} actions; stop offering one to add another.</p>
      )}
    </Section>
  );
}
