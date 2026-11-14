import type { Condition, EntityDocument, Registry, ViewerDocument } from "@yadad/core";
import { useState } from "react";
import type { ReactNode } from "react";
import { builtOf, ConditionBuilder, draftFor } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { describeCondition } from "./ui.js";

export interface EditVisibleRuleProps {
  readonly registry: Registry<ReactNode>;
  readonly entity: EntityDocument;
  /** The set's viewer document, when there is one: the condition may then read a viewer fact. */
  readonly viewer?: ViewerDocument | undefined;
  /** What the view's records are called in the button labels: "row", "entry" or "card". */
  readonly noun: string;
  readonly base: string;
  readonly current: Condition | undefined;
  /** Sets (or, with undefined, removes) the view's `editVisibleWhen`. */
  readonly onSet: (condition: Condition | undefined) => void;
}

/**
 * Card 106: which records get the Edit button of the view's `editForm`. A record condition (and viewer
 * facts, when the set has a viewer document), built with the same builder as a form item's "show only
 * when"; deeper conditions stay intact in words and are replaced, never half-edited.
 */
export function EditVisibleRule({ registry, entity, viewer, noun, base, current, onSet }: EditVisibleRuleProps): ReactNode {
  const { Button } = registry.layout;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConditionDraft | undefined>(undefined);
  const label = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const factLabel = (factId: string) => viewer?.facts.find((f) => f.id === factId)?.label ?? factId;
  const rule = `Edit button shows when`;
  const built = builtOf(draft);
  const same = JSON.stringify(built) === JSON.stringify(current);
  const close = () => {
    setOpen(false);
    setDraft(undefined);
  };
  return (
    <div data-yadad-edit-visible-rule="">
      <p>
        {current ? `${rule}: ${describeCondition(current, label, factLabel)}.` : `Edit button shows on every ${noun} the viewer may update.`}
        <Button
          label={current ? `Edit ${rule}` : `Set ${rule}`}
          type="button"
          variant="secondary"
          disabled={false}
          onPress={() => {
            setOpen(true);
            setDraft(draftFor(entity, current));
          }}
        />
      </p>
      {open && (
        <div style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <ConditionBuilder id={`${base}-editvisible`} label={rule} registry={registry} entity={entity} viewer={viewer} draft={draft} onChange={setDraft} current={current} onReplace={() => setDraft(draftFor(entity, undefined))} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
            <Button
              label={`Apply ${rule}`}
              type="button"
              variant="primary"
              disabled={built === undefined || same}
              onPress={() => {
                onSet(built);
                close();
              }}
            />
            {current !== undefined && (
              <Button
                label={`Remove ${rule}`}
                type="button"
                variant="secondary"
                disabled={false}
                onPress={() => {
                  onSet(undefined);
                  close();
                }}
              />
            )}
            <Button label={`Cancel ${rule}`} type="button" variant="secondary" disabled={false} onPress={close} />
          </div>
        </div>
      )}
    </div>
  );
}
