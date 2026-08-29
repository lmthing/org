import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { isFormDescriptor } from '@lmthing/core/ui';
import { ConsentCard, isConsentDescriptor, consentPropsFromDescriptor } from './ConsentCard';
import { CatalogForm } from './forms/CatalogForm';

/**
 * Renders an `ask()` descriptor for the store-free surfaces (`ReplChatView`'s embedded dock,
 * `--web` DevTools, studio agent-chat). Mirrors `Message.tsx`'s branching on the main `/chat`
 * surface — consent → `ConsentCard`, a catalog form descriptor (bare control or `<Form>`,
 * however deeply `<Stack>`/`<Field>`/`<Fieldset>` wraps it) → the shared `CatalogForm`, anything
 * else (a bare string prompt, or a display-only descriptor with no recognized field) → a plain
 * text input — so the two surfaces render the SAME ask() the SAME way instead of drifting, which
 * is what silently dropped every field but a flat `textinput`/`select`/`checkbox` here before.
 */

interface AskBlockProps {
  id: string;
  descriptor: unknown;
  onSubmit: (id: string, value: unknown) => void;
  onCancel: (id: string) => void;
}

export function AskBlock({ id, descriptor, onSubmit, onCancel }: AskBlockProps): React.ReactElement {
  const [text, setText] = React.useState('');

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

  if (isFormDescriptor(descriptor)) {
    return (
      <Prim.Box borderWidth="1px" borderStyle="solid" borderColor="var(--agent)" borderRadius={4} padding={16}>
        <CatalogForm descriptor={descriptor} onSubmit={(value) => onSubmit(id, value)} onCancel={() => onCancel(id)} />
      </Prim.Box>
    );
  }

  // A bare string prompt (`await ask('...')`) or a display-only descriptor with no recognized
  // field — the same single-text-input fallback `Message.tsx` uses on the main surface.
  return (
    <Prim.Box borderWidth="1px" borderStyle="solid" borderColor="var(--agent)" borderRadius={4} padding={16}>
      <Prim.Row gap="$2">
        <Prim.TextField
          flexGrow={1} flexShrink={1} flexBasis="0%" backgroundColor="$background" borderWidth={1} borderColor="$border" borderRadius="$radius-lg" paddingHorizontal="$3" paddingVertical="$1.5" fontSize="$sm" color="$foreground" placeholderTextColor="$muted-foreground"
          value={text}
          placeholder="Enter value..."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(id, text); }}
        />
        <Prim.Pressable type="button" onClick={() => onSubmit(id, text)}><Prim.Text>Submit</Prim.Text></Prim.Pressable>
        <Prim.Pressable type="button" onClick={() => onCancel(id)}><Prim.Text>Cancel</Prim.Text></Prim.Pressable>
      </Prim.Row>
    </Prim.Box>
  );
}
