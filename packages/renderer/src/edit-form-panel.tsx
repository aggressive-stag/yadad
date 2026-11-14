import type { DataAdapter, DataRecord, DocumentError, EntityDocument, FormView, Registry, ResolvedViewer } from "@yadad/core";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { DocumentSet } from "./document-set.js";
import type { FieldFormatting } from "./fields.js";
import { FormRenderer } from "./form-renderer.js";

/**
 * The form a calendar's or board's `editForm` names (card 107), or what is wrong with it. The table
 * resolves its own in the same words; this is for the two views that open the form from an entry or a card.
 */
export function resolveEditForm(
  view: { readonly id: string; readonly editForm?: string | undefined },
  entity: EntityDocument,
  documents: DocumentSet | undefined,
  dataSources: ReadonlyMap<string, DataAdapter>,
): { readonly editForm?: FormView; readonly errors: readonly DocumentError[] } {
  const id = view.editForm;
  if (id === undefined) return { errors: [] };
  const fail = (message: string, hint: string) => ({ errors: [{ path: "/editForm", code: "invalid-value" as const, message, hint }] });
  if (!documents) return fail(`View "${view.id}" edits records in a form, but no documents were passed to look up "${id}".`, "Pass the document set as the documents prop.");
  const form = documents.views.get(id);
  if (!form || form.kind !== "form") return fail(`editForm "${id}" is not a form view in the document set.`, "Point editForm at a form view, or drop it.");
  if (form.entity !== entity.id) return fail(`Edit form "${form.id}" is for entity "${form.entity}", not "${entity.id}".`, "The edit form must be over the view's own entity.");
  if (form.repeat === "batch") return fail(`Edit form "${form.id}" is a batch composer, which only creates records.`, "Point editForm at a form without repeat.");
  if (!dataSources.has(form.dataSource)) return fail(`Edit form "${form.id}" uses data source "${form.dataSource}", which was not provided.`, "Provide that data source in dataSources.");
  return { editForm: form, errors: [] };
}

/** The id of the Edit entry the renderer adds to a calendar entry's or board card's record actions. */
export const EDIT_ACTION_ID = "yadad-edit";

export interface EditFormPanelProps {
  readonly entity: EntityDocument;
  readonly form: FormView;
  readonly record: DataRecord;
  readonly name: string;
  readonly registry: Registry<ReactNode>;
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  readonly entities?: ReadonlyMap<string, EntityDocument> | undefined;
  readonly documents?: DocumentSet | undefined;
  readonly viewer: ResolvedViewer;
  readonly formatting?: FieldFormatting | undefined;
  /** Back was pressed, or a save went through (`saved` is the record the server answered with). */
  readonly onClose: (saved?: DataRecord) => void;
}

/**
 * A record in its edit form in place of the view: a Back button, a heading that takes focus when the
 * panel opens, and the ordinary `FormRenderer` with `record`, so the save is the one card 99 built
 * (changed fields only, `baseVersion`, the conflict message in the form).
 */
export function EditFormPanel({ entity, form, record, name, registry, dataSources, entities, documents, viewer, formatting, onClose }: EditFormPanelProps): ReactNode {
  const { Button } = registry.layout;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div data-yadad-edit-form={form.id} data-yadad-edit-record={record.id}>
      <div data-yadad-edit-header="">
        <Button label="Back" type="button" variant="secondary" disabled={false} onPress={() => onClose()} />
        <h2 ref={heading} tabIndex={-1} data-yadad-edit-heading="">
          {`Edit ${name || entity.id}`}
        </h2>
      </div>
      <FormRenderer
        key={record.id}
        entity={entity}
        view={form}
        registry={registry}
        dataSources={dataSources}
        {...(entities ? { entities } : {})}
        {...(documents ? { documents } : {})}
        viewer={viewer}
        {...(formatting ? { formatting } : {})}
        record={record}
        onSaved={(saved) => onClose(saved)}
      />
    </div>
  );
}
