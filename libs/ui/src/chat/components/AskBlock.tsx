import * as Prim from '../../elements/primitives/index';
import React, { useState } from 'react';
import { ConsentCard, isConsentDescriptor, consentPropsFromDescriptor } from './ConsentCard';

interface JSXDescriptor {
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
}

function isDescriptor(v: unknown): v is JSXDescriptor {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    'props' in v &&
    'children' in v
  );
}

interface AskBlockProps {
  id: string;
  descriptor: unknown;
  onSubmit: (id: string, value: unknown) => void;
  onCancel: (id: string) => void;
}

interface TextFieldProps {
  label: string;
  placeholder?: string;
  required?: boolean;
  onChange: (value: string) => void;
}

function TextField({ label, placeholder, required, onChange }: TextFieldProps): React.ReactElement {
  return (
    <Prim.Box marginBottom={8}>
      <Prim.Text as="label" display="block" marginBottom={4}>
        {label}
        {required && <Prim.Text color="$destructive"> *</Prim.Text>}
      </Prim.Text>
      <Prim.TextField
        type="text"
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        width="100%" paddingVertical="4px" paddingHorizontal="8px"
      />
    </Prim.Box>
  );
}

interface SelectFieldProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function SelectField({ label, options, onChange }: SelectFieldProps): React.ReactElement {
  return (
    <Prim.Box marginBottom={8}>
      <Prim.Text as="label" display="block" marginBottom={4}>{label}</Prim.Text>
      <Prim.Select onChange={(e) => onChange(e.target.value)} width="100%" paddingVertical="4px" paddingHorizontal="8px">
        {options.map((opt) => (
          <Prim.Option key={opt.value} value={opt.value}>
            {opt.label}
          </Prim.Option>
        ))}
      </Prim.Select>
    </Prim.Box>
  );
}

interface CheckboxFieldProps {
  label: string;
  onChange: (value: boolean) => void;
}

function CheckboxField({ label, onChange }: CheckboxFieldProps): React.ReactElement {
  return (
    <Prim.Box marginBottom={8}>
      <Prim.Text as="label">
        <Prim.TextField type="checkbox" onChange={(e) => onChange(e.target.checked)} />
        {' '}{label}
      </Prim.Text>
    </Prim.Box>
  );
}

function renderFormField(
  desc: JSXDescriptor,
  key: number,
  formData: Record<string, unknown>,
  setFormData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
): React.ReactNode {
  const type = desc.type.toLowerCase();
  const name = desc.props['name'] as string | undefined ?? String(key);
  const label = desc.props['label'] as string | undefined ?? name;
  const placeholder = desc.props['placeholder'] as string | undefined;
  const required = desc.props['required'] as boolean | undefined;

  switch (type) {
    case 'textinput':
    case 'input':
      return (
        <TextField
          key={key}
          label={label}
          placeholder={placeholder}
          required={required}
          onChange={(value) => setFormData((prev) => ({ ...prev, [name]: value }))}
        />
      );
    case 'select': {
      const rawOptions = desc.props['options'];
      const options: Array<{ value: string; label: string }> = Array.isArray(rawOptions)
        ? (rawOptions as Array<{ value: string; label: string }>)
        : [];
      return (
        <SelectField
          key={key}
          label={label}
          options={options}
          onChange={(value) => setFormData((prev) => ({ ...prev, [name]: value }))}
        />
      );
    }
    case 'checkbox':
      return (
        <CheckboxField
          key={key}
          label={label}
          onChange={(value) => setFormData((prev) => ({ ...prev, [name]: value }))}
        />
      );
    default:
      return null;
  }
}

export function AskBlock({ id, descriptor, onSubmit, onCancel }: AskBlockProps): React.ReactElement {
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Host-enforced consent: render an Approve/Deny card. Both choices resolve the
  // ask (approve → `true`, deny → `false`), so the agent never hangs.
  if (isConsentDescriptor(descriptor)) {
    return (
      <ConsentCard
        {...consentPropsFromDescriptor(descriptor)}
        onApprove={() => onSubmit(id, true)}
        onDeny={() => onSubmit(id, false)}
      />
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // If single text input, submit the value directly
    const values = Object.values(formData);
    const value = values.length === 1 ? values[0] : formData;
    onSubmit(id, value);
  };

  if (!isDescriptor(descriptor)) {
    return (
      <Prim.Box>
        <Prim.Form onSubmit={handleSubmit}>
          <Prim.TextField
            type="text"
            onChange={(e) => setFormData({ value: e.target.value })}
            placeholder="Enter value..."
            width="100%" paddingVertical="4px" paddingHorizontal="8px"
          />
          <Prim.Pressable type="submit" marginTop={8}><Prim.Text>Submit</Prim.Text></Prim.Pressable>
          <Prim.Pressable type="button" onClick={() => onCancel(id)} marginTop={8} marginLeft={8}>
            <Prim.Text>Cancel</Prim.Text>
          </Prim.Pressable>
        </Prim.Form>
      </Prim.Box>
    );
  }

  const desc = descriptor as JSXDescriptor;
  const title = desc.props['title'] as string | undefined;

  const formFields = desc.children
    .filter(isDescriptor)
    .map((child, i) => renderFormField(child, i, formData, setFormData));

  return (
    <Prim.Box borderWidth="1px" borderStyle="solid" borderColor="var(--agent)" borderRadius={4} padding={16}>
      {title && <Prim.Text as="h3" marginTop={0}>{title}</Prim.Text>}
      <Prim.Form onSubmit={handleSubmit}>
        {formFields}
        <Prim.Box marginTop={12}>
          <Prim.Pressable type="submit" marginRight={8}><Prim.Text>Submit</Prim.Text></Prim.Pressable>
          <Prim.Pressable type="button" onClick={() => onCancel(id)}><Prim.Text>Cancel</Prim.Text></Prim.Pressable>
        </Prim.Box>
      </Prim.Form>
    </Prim.Box>
  );
}
