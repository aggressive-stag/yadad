import type { TextField } from "@yadad/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { mockRegistry } from "./mock-registry";

const field: TextField = { id: "name", type: "text", label: "Name", required: true };
const { Input, Display } = mockRegistry.fields.text;
const { FieldFrame } = mockRegistry.layout;

test("text input exposes a test id and the current value", () => {
  const html = renderToStaticMarkup(<Input inputId="f-name" field={field} value="Ada" onChange={() => {}} invalid={false} />);
  expect(html).toContain('id="f-name"');
  expect(html).toContain('data-testid="input-name"');
  expect(html).toContain('value="Ada"');
});

test("display renders the value", () => {
  expect(renderToStaticMarkup(<Display field={field} value="Ada" />)).toBe('<span data-testid="display-name">Ada</span>');
});

test("field frame shows label, required marker and errors", () => {
  const html = renderToStaticMarkup(
    <FieldFrame
      inputId="f-name"
      label="Name"
      required
      errors={[{ path: "/name", code: "required", message: '"Name" is required.', hint: "Enter a value." }]}
    >
      <input id="f-name" />
    </FieldFrame>,
  );
  expect(html).toContain('<label for="f-name">Name<span aria-hidden="true"> *</span></label>');
  expect(html).toContain('data-testid="field-error" data-code="required"');
});
