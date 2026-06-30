/**
 * Design-system component catalog — the single source of truth for the
 * cross-platform UI vocabulary. Browser-safe (no Node/deps) so it can be
 * imported by the core DTS overlay, the CLI Ink renderer, and the web renderer
 * alike.
 *
 * Each entry names a descriptor `type`, documents its props, and marks whether
 * it is a `display` (output) or `form` (interactive) component. Both
 * `renderDescriptor` implementations (Ink + web) interpret these type names;
 * the typecheck overlay turns them into typed JSX globals for the model.
 *
 * Type names are matched case-insensitively by the renderers, so the model may
 * write `<Stack>` or `<stack>`.
 */

export interface CatalogProp {
  name: string;
  /** TypeScript type literal used verbatim in the generated DTS. */
  type: string;
  optional?: boolean;
  doc?: string;
}

export interface CatalogEntry {
  /** Descriptor type / JSX tag name. */
  name: string;
  kind: 'display' | 'form';
  doc: string;
  props: CatalogProp[];
  /** True if the component accepts free-form children. */
  children?: boolean;
}

const onSubmit: CatalogProp = {
  name: 'onSubmit',
  type: '(value: any) => void',
  optional: true,
  doc: 'Supplied by the host; do not pass when authoring JSX for ask().',
};
const name = (doc = 'Field name; becomes a key in the submitted form object.'): CatalogProp => ({ name: 'name', type: 'string', optional: true, doc });
const label = (): CatalogProp => ({ name: 'label', type: 'string', optional: true, doc: 'Visible label.' });
const help = (): CatalogProp => ({ name: 'help', type: 'string', optional: true, doc: 'Help/description text under the control.' });

// ─── Display components ────────────────────────────────────────────────────────

export const DISPLAY_CATALOG: CatalogEntry[] = [
  { name: 'Heading', kind: 'display', doc: 'Section heading.', children: true, props: [{ name: 'level', type: '1 | 2 | 3 | 4', optional: true }] },
  { name: 'Paragraph', kind: 'display', doc: 'Body text block.', children: true, props: [] },
  { name: 'Text', kind: 'display', doc: 'Inline text run.', children: true, props: [{ name: 'color', type: 'string', optional: true }, { name: 'bold', type: 'boolean', optional: true }, { name: 'dim', type: 'boolean', optional: true }, { name: 'italic', type: 'boolean', optional: true }] },
  { name: 'Strong', kind: 'display', doc: 'Bold emphasis.', children: true, props: [] },
  { name: 'Em', kind: 'display', doc: 'Italic emphasis.', children: true, props: [] },
  { name: 'Muted', kind: 'display', doc: 'De-emphasized text.', children: true, props: [] },
  { name: 'Code', kind: 'display', doc: 'Inline code.', children: true, props: [] },
  { name: 'Kbd', kind: 'display', doc: 'Keyboard key.', children: true, props: [] },
  { name: 'CodeBlock', kind: 'display', doc: 'Multi-line code block.', children: true, props: [{ name: 'lang', type: 'string', optional: true }] },
  { name: 'Markdown', kind: 'display', doc: 'Rendered markdown text.', children: true, props: [{ name: 'text', type: 'string', optional: true }] },
  { name: 'Stack', kind: 'display', doc: 'Vertical layout container.', children: true, props: [{ name: 'gap', type: 'number', optional: true }] },
  { name: 'Row', kind: 'display', doc: 'Horizontal layout container.', children: true, props: [{ name: 'gap', type: 'number', optional: true }, { name: 'justify', type: "'start' | 'center' | 'end' | 'between'", optional: true }, { name: 'align', type: "'start' | 'center' | 'end'", optional: true }] },
  { name: 'Columns', kind: 'display', doc: 'Equal-width column layout.', children: true, props: [{ name: 'gap', type: 'number', optional: true }] },
  { name: 'Spacer', kind: 'display', doc: 'Flexible gap that pushes siblings apart.', props: [] },
  { name: 'Divider', kind: 'display', doc: 'Horizontal rule.', props: [{ name: 'label', type: 'string', optional: true }] },
  { name: 'Card', kind: 'display', doc: 'Bordered surface.', children: true, props: [{ name: 'title', type: 'string', optional: true }] },
  { name: 'Panel', kind: 'display', doc: 'Titled panel with a body.', children: true, props: [{ name: 'title', type: 'string', optional: true }] },
  { name: 'Callout', kind: 'display', doc: 'Highlighted note.', children: true, props: [{ name: 'variant', type: "'info' | 'success' | 'warning' | 'error'", optional: true }, { name: 'title', type: 'string', optional: true }] },
  { name: 'Alert', kind: 'display', doc: 'Alert box (alias of Callout).', children: true, props: [{ name: 'variant', type: "'info' | 'success' | 'warning' | 'error'", optional: true }] },
  { name: 'Banner', kind: 'display', doc: 'Full-width banner.', children: true, props: [{ name: 'variant', type: "'info' | 'success' | 'warning' | 'error'", optional: true }] },
  { name: 'Badge', kind: 'display', doc: 'Small status badge.', children: true, props: [{ name: 'color', type: 'string', optional: true }] },
  { name: 'Tag', kind: 'display', doc: 'Label tag.', children: true, props: [{ name: 'color', type: 'string', optional: true }] },
  { name: 'Pill', kind: 'display', doc: 'Rounded pill label.', children: true, props: [{ name: 'color', type: 'string', optional: true }] },
  { name: 'List', kind: 'display', doc: 'Unordered list. Pass `items` or ListItem children.', children: true, props: [{ name: 'items', type: 'string[]', optional: true }] },
  { name: 'OrderedList', kind: 'display', doc: 'Ordered list.', children: true, props: [{ name: 'items', type: 'string[]', optional: true }] },
  { name: 'ListItem', kind: 'display', doc: 'List item.', children: true, props: [] },
  { name: 'Table', kind: 'display', doc: 'Data table.', props: [{ name: 'columns', type: 'string[]', doc: 'Header labels.' }, { name: 'rows', type: '(string | number)[][]', doc: 'Row cells.' }] },
  { name: 'KeyValue', kind: 'display', doc: 'Key/value pairs.', props: [{ name: 'pairs', type: 'Record<string, string | number>' }] },
  { name: 'ProgressBar', kind: 'display', doc: 'Progress indicator (0-1 or 0-100).', props: [{ name: 'value', type: 'number' }, { name: 'max', type: 'number', optional: true }, { name: 'label', type: 'string', optional: true }] },
  { name: 'Spinner', kind: 'display', doc: 'Loading spinner.', props: [{ name: 'label', type: 'string', optional: true }] },
  { name: 'StatCard', kind: 'display', doc: 'Metric with label.', props: [{ name: 'label', type: 'string' }, { name: 'value', type: 'string | number' }, { name: 'delta', type: 'string', optional: true }] },
  { name: 'Timeline', kind: 'display', doc: 'Ordered events.', props: [{ name: 'items', type: '{ title: string; time?: string; detail?: string }[]' }] },
  { name: 'Link', kind: 'display', doc: 'Hyperlink.', children: true, props: [{ name: 'href', type: 'string' }] },
  { name: 'Quote', kind: 'display', doc: 'Block quote.', children: true, props: [] },
  { name: 'Details', kind: 'display', doc: 'Collapsible section.', children: true, props: [{ name: 'summary', type: 'string' }] },
];

// ─── Form components ────────────────────────────────────────────────────────────

export const FORM_CATALOG: CatalogEntry[] = [
  { name: 'Form', kind: 'form', doc: 'Form wrapper: collects child field values and submits one object.', children: true, props: [{ name: 'submitLabel', type: 'string', optional: true }, onSubmit] },
  { name: 'Fieldset', kind: 'form', doc: 'Grouped fields with a legend.', children: true, props: [label()] },
  { name: 'Field', kind: 'form', doc: 'Label + control + help/error wrapper.', children: true, props: [label(), help(), { name: 'error', type: 'string', optional: true }] },
  { name: 'TextField', kind: 'form', doc: 'Single-line text input.', props: [name(), label(), help(), { name: 'placeholder', type: 'string', optional: true }, { name: 'defaultValue', type: 'string', optional: true }, onSubmit] },
  { name: 'TextArea', kind: 'form', doc: 'Multi-line text input.', props: [name(), label(), help(), { name: 'rows', type: 'number', optional: true }, { name: 'defaultValue', type: 'string', optional: true }, onSubmit] },
  { name: 'NumberField', kind: 'form', doc: 'Numeric input.', props: [name(), label(), help(), { name: 'min', type: 'number', optional: true }, { name: 'max', type: 'number', optional: true }, { name: 'step', type: 'number', optional: true }, { name: 'defaultValue', type: 'number', optional: true }, onSubmit] },
  { name: 'PasswordField', kind: 'form', doc: 'Masked text input.', props: [name(), label(), help(), onSubmit] },
  { name: 'EmailField', kind: 'form', doc: 'Email input.', props: [name(), label(), help(), { name: 'placeholder', type: 'string', optional: true }, onSubmit] },
  { name: 'UrlField', kind: 'form', doc: 'URL input.', props: [name(), label(), help(), onSubmit] },
  { name: 'SearchField', kind: 'form', doc: 'Search input.', props: [name(), label(), { name: 'placeholder', type: 'string', optional: true }, onSubmit] },
  { name: 'Select', kind: 'form', doc: 'Single-choice dropdown / list.', props: [name(), label(), help(), { name: 'options', type: '(string | { label: string; value: any })[]' }, { name: 'defaultValue', type: 'any', optional: true }, onSubmit] },
  { name: 'MultiSelect', kind: 'form', doc: 'Multi-choice list.', props: [name(), label(), help(), { name: 'options', type: '(string | { label: string; value: any })[]' }, { name: 'defaultValue', type: 'any[]', optional: true }, onSubmit] },
  { name: 'Combobox', kind: 'form', doc: 'Autocomplete single-choice.', props: [name(), label(), { name: 'options', type: '(string | { label: string; value: any })[]' }, onSubmit] },
  { name: 'RadioGroup', kind: 'form', doc: 'Single-choice radios.', props: [name(), label(), help(), { name: 'options', type: '(string | { label: string; value: any })[]' }, { name: 'defaultValue', type: 'any', optional: true }, onSubmit] },
  { name: 'CheckboxGroup', kind: 'form', doc: 'Multi-choice checkboxes.', props: [name(), label(), { name: 'options', type: '(string | { label: string; value: any })[]' }, onSubmit] },
  { name: 'Checkbox', kind: 'form', doc: 'Single boolean checkbox.', props: [name(), label(), { name: 'defaultValue', type: 'boolean', optional: true }, onSubmit] },
  { name: 'Switch', kind: 'form', doc: 'Boolean toggle.', props: [name(), label(), { name: 'defaultValue', type: 'boolean', optional: true }, onSubmit] },
  { name: 'Slider', kind: 'form', doc: 'Range slider.', props: [name(), label(), { name: 'min', type: 'number', optional: true }, { name: 'max', type: 'number', optional: true }, { name: 'step', type: 'number', optional: true }, { name: 'defaultValue', type: 'number', optional: true }, onSubmit] },
  { name: 'Stepper', kind: 'form', doc: 'Increment/decrement number.', props: [name(), label(), { name: 'min', type: 'number', optional: true }, { name: 'max', type: 'number', optional: true }, { name: 'defaultValue', type: 'number', optional: true }, onSubmit] },
  { name: 'DatePicker', kind: 'form', doc: 'Date input.', props: [name(), label(), { name: 'defaultValue', type: 'string', optional: true }, onSubmit] },
  { name: 'TimePicker', kind: 'form', doc: 'Time input.', props: [name(), label(), onSubmit] },
  { name: 'DateTimePicker', kind: 'form', doc: 'Date + time input.', props: [name(), label(), onSubmit] },
  { name: 'ColorPicker', kind: 'form', doc: 'Color input (hex on terminal).', props: [name(), label(), { name: 'defaultValue', type: 'string', optional: true }, onSubmit] },
  { name: 'FileField', kind: 'form', doc: 'File path / upload field.', props: [name(), label(), help(), onSubmit] },
  { name: 'TagInput', kind: 'form', doc: 'Free-form tag/chips input.', props: [name(), label(), help(), onSubmit] },
  { name: 'Rating', kind: 'form', doc: 'Star rating.', props: [name(), label(), { name: 'max', type: 'number', optional: true }, { name: 'defaultValue', type: 'number', optional: true }, onSubmit] },
  { name: 'OtpInput', kind: 'form', doc: 'One-time-code / PIN input.', props: [name(), label(), { name: 'length', type: 'number', optional: true }, onSubmit] },
  { name: 'PhoneField', kind: 'form', doc: 'Phone-number input.', props: [name(), label(), onSubmit] },
  { name: 'CurrencyField', kind: 'form', doc: 'Currency amount input.', props: [name(), label(), { name: 'currency', type: 'string', optional: true }, onSubmit] },
  { name: 'Button', kind: 'form', doc: 'Action button; resolves ask() with its `value`.', children: true, props: [{ name: 'value', type: 'any', optional: true }, { name: 'variant', type: "'primary' | 'secondary' | 'danger'", optional: true }, onSubmit] },
  { name: 'SubmitButton', kind: 'form', doc: 'Submits the enclosing Form.', children: true, props: [onSubmit] },
  { name: 'ButtonGroup', kind: 'form', doc: 'Row of choice buttons; resolves with the chosen value.', props: [{ name: 'options', type: '(string | { label: string; value: any })[]' }, onSubmit] },
  { name: 'ConfirmButtons', kind: 'form', doc: 'Yes/No confirmation; resolves boolean.', props: [{ name: 'confirmLabel', type: 'string', optional: true }, { name: 'cancelLabel', type: 'string', optional: true }, onSubmit] },
];

export const CATALOG: CatalogEntry[] = [...DISPLAY_CATALOG, ...FORM_CATALOG];

/** Lower-cased name → entry, for case-insensitive renderer lookups. */
export const CATALOG_BY_NAME: Record<string, CatalogEntry> = Object.fromEntries(
  CATALOG.map((e) => [e.name.toLowerCase(), e]),
);

export function isFormComponent(typeName: string): boolean {
  return CATALOG_BY_NAME[typeName.toLowerCase()]?.kind === 'form';
}

/** All catalog component names — injected as JSX stubs so `<Stack/>` resolves. */
export const CATALOG_NAMES: string[] = CATALOG.map((e) => e.name);

/**
 * Compact human-readable summary of the catalog for inclusion in the LLM system
 * prompt. Derived from CATALOG data so it stays in sync automatically.
 */
/** Compact one-line prop signature, e.g. `Callout {variant?: 'info'|'success'|'warning'|'error', title?: string}`.
 *  Showing EXACT prop names + types in the prompt (not just the component name) stops the
 *  model guessing wrong props from training priors — the recurring `Callout type=` (should be
 *  `variant`), `KeyValue data=` (should be `pairs`), `Table title=` (no such prop) churn that
 *  otherwise burns several typecheck-retry turns per render. */
function componentSignature(e: CatalogEntry): string {
  const props = e.props
    .filter((p) => p.name !== 'onSubmit')
    .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`);
  const propStr = props.length > 0 ? ` {${props.join(', ')}}` : '';
  const childStr = e.children ? ' +children' : '';
  return `${e.name}${propStr}${childStr}`;
}

export function catalogSummary(): string {
  const displayLines = DISPLAY_CATALOG.map((e) => `- ${componentSignature(e)}`);
  const formLines = FORM_CATALOG.map((e) => `- ${componentSignature(e)}`);
  return [
    `# UI Components (built-in — render on terminal AND web)`,
    ``,
    `Always in scope, no import needed. Use with display() for output and ask() for input.`,
    `Use the EXACT prop names and types shown — these are type-checked, and guessing (e.g.`,
    `\`<Callout type=…>\` instead of \`variant\`, or \`<KeyValue data=…>\` instead of \`pairs\`) fails.`,
    `\`+children\` means the component takes nested JSX/text children.`,
    ``,
    `**Layout / display:**`,
    ...displayLines,
    ``,
    `**Forms (use with ask()):**`,
    ...formLines,
    ``,
    `A \`<Form>\` resolves to an object keyed by field \`name\`; a bare control resolves to the single value.`,
    ``,
    `Examples:`,
    `  display(<Stack gap={2}><Heading level={1}>Report</Heading><Callout variant="success" title="Done">All good</Callout><Table columns={["Name","Score"]} rows={[["Alice",95]]}/><KeyValue pairs={{ Total: 42 }}/></Stack>)`,
    `  const ans = await ask(<Form><TextField name="title" label="Title"/><Select name="env" options={["dev","prod"]}/></Form>) as { title: string; env: string }`,
    `  const confirmed = await ask(<ConfirmButtons/>) as boolean`,
  ].join('\n');
}

/** Ambient DTS declaring every catalog component as a typed JSX global. */
export function catalogDts(): string {
  const lines: string[] = ['// ── Design-system components (always available) ──'];
  for (const e of CATALOG) {
    const props = e.props
      .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`)
      .join('; ');
    const childrenProp = e.children ? `${e.props.length ? '; ' : ''}children?: any` : '';
    lines.push(`/** ${e.doc} */`);
    lines.push(`declare function ${e.name}(props?: { ${props}${childrenProp} }): JSXDescriptor;`);
  }
  return lines.join('\n');
}
