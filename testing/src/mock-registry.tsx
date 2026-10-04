import type { DisplayProps, FieldFrameProps, InputProps, Registry, TextField } from "@yadad/core";
import type { ReactNode } from "react";

/**
 * Stub components with data-testid hooks. Engine tests and the showcase use
 * this instead of real components, so engine CI never needs the components
 * repo. Pre-contract: text field and FieldFrame only.
 */
export const mockRegistry: Registry<ReactNode> = {
  fields: {
    text: { type: "text", Input: MockTextInput, Display: MockTextDisplay },
  },
  layout: { FieldFrame: MockFieldFrame },
};

function MockTextInput({ inputId, field, value, onChange, invalid }: InputProps<TextField, string>): ReactNode {
  return (
    <input
      id={inputId}
      type="text"
      data-testid={`input-${field.id}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      aria-invalid={invalid}
    />
  );
}

function MockTextDisplay({ field, value }: DisplayProps<TextField, string>): ReactNode {
  return <span data-testid={`display-${field.id}`}>{value ?? ""}</span>;
}

function MockFieldFrame({ inputId, label, required, errors, children }: FieldFrameProps<ReactNode>): ReactNode {
  return (
    <div data-testid="field-frame">
      <label htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {errors.map((e) => (
        <p key={`${e.path} ${e.code}`} role="alert" data-testid="field-error" data-code={e.code}>
          {e.message}
        </p>
      ))}
    </div>
  );
}
