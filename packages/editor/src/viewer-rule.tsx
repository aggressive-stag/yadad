import type { Registry, ViewerCondition, ViewerDocument } from "@yadad/core";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { builtOf, ConditionBuilder, viewerDraftFor } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { asViewerCondition } from "./conditions.js";
import { describeCondition } from "./ui.js";

export interface ViewerRuleProps {
  /** What the rule does, as a short phrase that finishes "<rule> only for…": "Show", "Allow editing". Used in the button names. */
  readonly rule: string;
  /** What it applies to, so button names are unique: a column, a tab, a widget. */
  readonly target: string;
  readonly registry: Registry<ReactNode>;
  /** The set's viewer document. Without facts the control says so instead of offering a builder. */
  readonly viewer: ViewerDocument | undefined;
  /** The rule now, if any. */
  readonly condition: ViewerCondition | undefined;
  /** What the rule says when there is none, in words: "shown to everyone". */
  readonly otherwise: string;
  /** Sets (or, with undefined, clears) the rule. Returns whether the document accepted it; the builder closes only then. */
  readonly onSet: (condition: ViewerCondition | undefined) => boolean;
}

/**
 * One viewer rule on one thing (RFC 0006): a sentence saying what it is now
 * and a button that opens the condition builder with only the viewer's facts.
 * Used for a column's visibleWhen and editableWhen, a calendar's and board's
 * editableWhen, a row action's visibleWhen and a dashboard tab's or widget's
 * visibleWhen. The rule is removed when the group is emptied and applied, or
 * with Remove.
 */
export function ViewerRule({ registry, rule, target, viewer, condition, otherwise, onSet }: ViewerRuleProps): ReactNode {
  const base = useId();
  const { Button } = registry.layout;
  const [draft, setDraft] = useState<ConditionDraft | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const factLabel = (id: string) => viewer?.facts.find((f) => f.id === id)?.label ?? id;
  const name = `${rule}: ${target}`;
  const built = asViewerCondition(builtOf(draft));
  const same = JSON.stringify(built) === JSON.stringify(condition);
  const text = condition === undefined ? otherwise : `${rule} when ${describeCondition(condition, (id) => id, factLabel)}`;
  const close = () => {
    setOpen(false);
    setDraft(undefined);
  };
  return (
    <span data-yadad-viewer-rule={name} style={{ display: "block" }}>
      <span>{text}. </span>
      {viewer && viewer.facts.length > 0 ? (
        <Button
          label={condition === undefined ? name : `Edit ${name}`}
          type="button"
          variant="secondary"
          disabled={false}
          onPress={() => {
            if (open) return close();
            setOpen(true);
            setDraft(viewerDraftFor(viewer, condition));
          }}
        />
      ) : (
        condition === undefined && <span>Declare viewer facts to set this.</span>
      )}
      {open && viewer && (
        <span data-yadad-viewer-rule-builder="" style={{ display: "block", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <ConditionBuilder
            id={`${base}-rule`}
            label={`${rule} when`}
            registry={registry}
            viewer={viewer}
            sources="viewer"
            draft={draft}
            onChange={setDraft}
            current={condition}
            onReplace={() => setDraft(viewerDraftFor(viewer, undefined))}
          />
          <span style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
            <Button label={`Apply ${name}`} type="button" variant="primary" disabled={built === undefined || same} onPress={() => onSet(built) && close()} />
            {condition !== undefined && <Button label={`Remove ${name}`} type="button" variant="secondary" disabled={false} onPress={() => onSet(undefined) && close()} />}
            <Button label={`Cancel ${name}`} type="button" variant="secondary" disabled={false} onPress={close} />
          </span>
        </span>
      )}
    </span>
  );
}
