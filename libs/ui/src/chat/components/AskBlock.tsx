import React, { useState } from 'react';
import { ConsentCard, isConsentDescriptor, consentPropsFromDescriptor } from './ConsentCard.js';

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
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', marginBottom: 4 }}>
        {label}
        {required && <span style={{ color: 'red' }}> *</span>}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '4px 8px' }}
      />
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function SelectField({ label, options, onChange }: SelectFieldProps): React.ReactElement {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      <select onChange={(e) => onChange(e.target.value)} style={{ width: '100%', padding: '4px 8px' }}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface CheckboxFieldProps {
  label: string;
  onChange: (value: boolean) => void;
}

function CheckboxField({ label, onChange }: CheckboxFieldProps): React.ReactElement {
  return (
    <div style={{ marginBottom: 8 }}>
      <label>
        <input type="checkbox" onChange={(e) => onChange(e.target.checked)} />
        {' '}{label}
      </label>
    </div>
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
      <div className="repl-ask">
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            onChange={(e) => setFormData({ value: e.target.value })}
            placeholder="Enter value..."
            style={{ width: '100%', padding: '4px 8px' }}
          />
          <button type="submit" style={{ marginTop: 8 }}>Submit</button>
          <button type="button" onClick={() => onCancel(id)} style={{ marginTop: 8, marginLeft: 8 }}>
            Cancel
          </button>
        </form>
      </div>
    );
  }

  const desc = descriptor as JSXDescriptor;
  const title = desc.props['title'] as string | undefined;

  const formFields = desc.children
    .filter(isDescriptor)
    .map((child, i) => renderFormField(child, i, formData, setFormData));

  return (
    <div className="repl-ask" style={{ border: '1px solid var(--agent)', borderRadius: 4, padding: 16 }}>
      {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
      <form onSubmit={handleSubmit}>
        {formFields}
        <div style={{ marginTop: 12 }}>
          <button type="submit" style={{ marginRight: 8 }}>Submit</button>
          <button type="button" onClick={() => onCancel(id)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
