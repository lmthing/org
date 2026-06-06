/**
 * Ink-based renderer for display() and ask() sandbox globals in CLI mode.
 *
 * display(descriptor)  → renders a JSX descriptor tree to stdout (static, via renderToString)
 * ask(descriptor)      → renders an interactive form to collect user input from stdin
 */

import React, { useState } from 'react';
import { Box, Text, render, renderToString, useApp } from 'ink';
import TextInputComp from 'ink-text-input';

// ── Descriptor types ────────────────────────────────────────────────────────

type DescNode = string | number | DescObj;
interface DescObj {
  component: string;
  props: Record<string, unknown>;
  children: DescNode[];
}

// ── Static renderer (display) ───────────────────────────────────────────────

function StaticNode({ node }: { node: DescNode }): React.ReactElement {
  if (typeof node === 'string' || typeof node === 'number') {
    return <Text>{String(node)}</Text>;
  }

  const { component, props, children } = node;
  const kids = children.map((c, i) => <StaticNode key={i} node={c} />);
  const textContent = flattenText(node);

  switch (component) {
    case 'Markdown':
    case 'p':
    case 'span':
      return <Text>{textContent}</Text>;

    case 'h1':
      return <Text bold color="white"># {textContent}</Text>;
    case 'h2':
      return <Text bold>## {textContent}</Text>;
    case 'h3':
      return <Text bold>### {textContent}</Text>;

    case 'Card':
      return (
        <Box borderStyle="round" flexDirection="column" paddingX={1}>
          {props['title'] ? <Text bold>{String(props['title'])}</Text> : null}
          {kids}
        </Box>
      );

    case 'Alert':
      return (
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">{'! '}</Text>
          <Box flexDirection="column">{kids}</Box>
        </Box>
      );

    case 'Badge':
      return (
        <Text color="cyan" bold>
          [{String(props['label'] ?? textContent)}]
        </Text>
      );

    case 'Code':
    case 'pre':
    case 'code':
      return <Text color="gray">{textContent}</Text>;

    case 'Button':
      return (
        <Text color="blue">
          [{String(props['label'] ?? textContent)}]
        </Text>
      );

    case 'Progress': {
      const value = Math.max(0, Math.min(100, Number(props['value'] ?? props['percent'] ?? 0)));
      const filled = Math.round(value / 10);
      return (
        <Text color="green">
          {'█'.repeat(filled)}{'░'.repeat(10 - filled)} {value}%
        </Text>
      );
    }

    case 'Table': {
      const headers = Array.isArray(props['headers']) ? (props['headers'] as unknown[]).map(String) : [];
      const rows = Array.isArray(props['rows']) ? (props['rows'] as unknown[][]) : [];
      return (
        <Box flexDirection="column">
          {headers.length > 0 && <Text bold>{headers.join(' │ ')}</Text>}
          {headers.length > 0 && <Text dimColor>{headers.map(h => '─'.repeat(h.length)).join('─┼─')}</Text>}
          {rows.map((row, i) => (
            <Text key={i}>{(row as unknown[]).map(String).join(' │ ')}</Text>
          ))}
        </Box>
      );
    }

    case 'Image':
      return <Text dimColor>[image: {String(props['src'] ?? props['alt'] ?? '')}]</Text>;

    case 'Link': {
      const href = props['href'] ? ` (${String(props['href'])})` : '';
      return <Text color="blue">{textContent}{href}</Text>;
    }

    case 'TextInput':
    case 'TextArea':
    case 'NumberInput':
    case 'Checkbox':
    case 'Select':
    case 'MultiSelect':
    case 'Slider':
    case 'DatePicker':
      // Input controls in static context show as placeholders
      return (
        <Text dimColor>
          [{component}: {String(props['label'] ?? props['name'] ?? props['placeholder'] ?? '')}]
        </Text>
      );

    case 'Form':
    case 'div':
    case 'section':
    case 'article':
    case 'main':
      return <Box flexDirection="column">{kids}</Box>;

    default:
      return <Box flexDirection="column">{kids}</Box>;
  }
}

function flattenText(node: DescNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  return node.children.map(flattenText).join('');
}

// ── Interactive ask renderer ─────────────────────────────────────────────────

interface InputSpec {
  type: 'text' | 'number' | 'select' | 'multiselect' | 'checkbox';
  name: string;
  label: string;
  placeholder: string;
  options: string[];
  defaultValue: string;
}

function findFirstInput(node: DescNode): InputSpec | null {
  if (typeof node === 'string' || typeof node === 'number') return null;
  const { component, props, children } = node;

  const name = String(props['name'] ?? 'value');
  const label = String(props['label'] ?? props['placeholder'] ?? '');
  const placeholder = String(props['placeholder'] ?? '');
  const defaultValue = String(props['defaultValue'] ?? '');

  if (component === 'TextInput' || component === 'TextArea') {
    return { type: 'text', name, label, placeholder, options: [], defaultValue };
  }
  if (component === 'NumberInput') {
    return { type: 'number', name, label, placeholder, options: [], defaultValue };
  }
  if (component === 'Select') {
    const opts = Array.isArray(props['options']) ? (props['options'] as unknown[]).map(String) : [];
    return { type: 'select', name, label, placeholder, options: opts, defaultValue };
  }
  if (component === 'MultiSelect') {
    const opts = Array.isArray(props['options']) ? (props['options'] as unknown[]).map(String) : [];
    return { type: 'multiselect', name, label, placeholder, options: opts, defaultValue };
  }
  if (component === 'Checkbox') {
    return { type: 'checkbox', name, label, placeholder, options: ['true', 'false'], defaultValue: 'false' };
  }

  for (const child of children) {
    const found = findFirstInput(child);
    if (found) return found;
  }
  return null;
}

// ── SelectPrompt component ───────────────────────────────────────────────────

function SelectPrompt({ label, options, onSelect }: {
  label: string;
  options: string[];
  onSelect: (value: string) => void;
}) {
  const [input, setInput] = useState('');
  const { exit } = useApp();

  const handleSubmit = (val: string) => {
    const idx = parseInt(val.trim(), 10);
    const chosen = options[idx - 1] ?? options[0] ?? val;
    exit();
    onSelect(chosen);
  };

  return (
    <Box flexDirection="column">
      {label ? <Text bold>{label}</Text> : null}
      {options.map((opt, i) => (
        <Text key={opt} dimColor={false}>  {i + 1}) {opt}</Text>
      ))}
      <Box>
        <Text color="blue">{'> '}</Text>
        <TextInputComp
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Enter number or value"
        />
      </Box>
    </Box>
  );
}

// ── AskForm component ────────────────────────────────────────────────────────

function AskForm({ descriptor, onSubmit }: {
  descriptor: DescNode;
  onSubmit: (value: unknown) => void;
}) {
  const inputSpec = findFirstInput(descriptor);
  const [value, setValue] = useState(inputSpec?.defaultValue ?? '');
  const { exit } = useApp();

  // Render any non-input parts of the descriptor for context
  const contextText = flattenTextExcludeInputs(descriptor);

  const handleTextSubmit = (val: string) => {
    exit();
    if (inputSpec?.name && inputSpec.name !== 'value') {
      onSubmit({ [inputSpec.name]: val || value });
    } else {
      onSubmit(val || value);
    }
  };

  if (inputSpec?.type === 'select' || inputSpec?.type === 'multiselect') {
    return (
      <Box flexDirection="column">
        {contextText ? <Text>{contextText}</Text> : null}
        <SelectPrompt
          label={inputSpec.label}
          options={inputSpec.options}
          onSelect={(chosen) => {
            onSubmit(inputSpec.name !== 'value' ? { [inputSpec.name]: chosen } : chosen);
          }}
        />
      </Box>
    );
  }

  if (inputSpec?.type === 'checkbox') {
    return (
      <Box flexDirection="column">
        {contextText ? <Text>{contextText}</Text> : null}
        <SelectPrompt
          label={inputSpec.label || 'Choose'}
          options={['yes', 'no']}
          onSelect={(chosen) => {
            const boolVal = chosen === 'yes';
            onSubmit(inputSpec.name !== 'value' ? { [inputSpec.name]: boolVal } : boolVal);
          }}
        />
      </Box>
    );
  }

  // Default: text input
  return (
    <Box flexDirection="column">
      {contextText ? <Text>{contextText}</Text> : null}
      <Box>
        <Text color="blue">{'? '}</Text>
        {inputSpec?.label ? <Text>{inputSpec.label}: </Text> : null}
        <TextInputComp
          value={value}
          onChange={setValue}
          onSubmit={handleTextSubmit}
          placeholder={inputSpec?.placeholder ?? ''}
        />
      </Box>
    </Box>
  );
}

function flattenTextExcludeInputs(node: DescNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  const INPUT_COMPONENTS = new Set([
    'TextInput', 'TextArea', 'NumberInput', 'Slider', 'Checkbox',
    'Select', 'MultiSelect', 'DatePicker',
  ]);
  if (INPUT_COMPONENTS.has(node.component)) return '';
  return node.children.map(flattenTextExcludeInputs).join('');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a display() descriptor to stdout using Ink's static renderer.
 */
export function renderDisplay(descriptor: unknown): void {
  const node = descriptor as DescNode;
  const output = renderToString(
    <Box flexDirection="column">
      <StaticNode node={node} />
    </Box>
  );
  if (output.trim()) {
    process.stdout.write(output + '\n');
  }
}

/**
 * Renders an ask() descriptor interactively via Ink, collecting user input.
 * Resolves with the submitted value.
 */
export function promptAsk(descriptor: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const node = descriptor as DescNode;
    const { unmount } = render(
      <AskForm
        descriptor={node}
        onSubmit={(value) => {
          unmount();
          resolve(value);
        }}
      />,
      { exitOnCtrlC: false },
    );
  });
}
