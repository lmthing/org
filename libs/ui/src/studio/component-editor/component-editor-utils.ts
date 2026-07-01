/**
 * Shared types, templates, and path helpers for the ComponentEditor.
 */
import { P } from '@lmthing/state'

export type ComponentKind = 'view' | 'form'

export const VIEW_TEMPLATE = (name: string) => `import { Stack } from '@lmthing/ui';

/**
 * ${name} — describe what this view component displays.
 */
export default function ${name}({ }: {  }) {
  return (
    <Stack>
      {/* render output here */}
    </Stack>
  );
}
`

export const FORM_TEMPLATE = (name: string) => `import { Form, TextField, SubmitButton } from '@lmthing/ui';

/**
 * ${name} — describe what input this form collects.
 */
export default function ${name}({ onSubmit }: { onSubmit: (values: Record<string, unknown>) => void }) {
  return (
    <Form onSubmit={onSubmit}>
      <TextField name="value" label="Value" />
      <SubmitButton>Submit</SubmitButton>
    </Form>
  );
}
`

export function componentNameFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.tsx$/, '') ?? path
}

export function pathForComponent(kind: ComponentKind, name: string): string {
  return kind === 'view' ? P.viewComponent(name) : P.formComponent(name)
}
