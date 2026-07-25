import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../lib/cn.js';
import { Drawer } from '../components/ui/Drawer.js';
import { Button } from '../components/ui/Button.js';
import { Spinner } from '../components/ui/Spinner.js';
import { Tabs } from '../components/ui/Tabs.js';
import { authHeaders } from './auth.js';
import { IntegrationsTab } from './IntegrationsTab.js';

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: authHeaders() }); if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: {'content-type':'application/json', ...authHeaders()}, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`); return r.json() as Promise<T>;
}
async function apiPut(path: string, body: unknown): Promise<void> {
  const r = await fetch(path, { method: 'PUT', headers: {'content-type':'application/json', ...authHeaders()}, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`);
}

function EnvTab() {
  const [content, setContent] = React.useState('');
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<'idle' | 'saved' | 'error'>('idle');

  React.useEffect(() => {
    setLoaded(false);
    setStatus('idle');
    apiGet<{ content: string }>('/api/env')
      .then(r => { setContent(r.content); setLoaded(true); })
      .catch(() => { setContent(''); setLoaded(true); });
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus('idle');
    try {
      await apiPut('/api/env', { content });
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <Prim.Row justifyContent="center" padding="$6" alignItems="center"><Spinner /></Prim.Row>;

  return (
    <Prim.Col gap="$3" padding="$4">
      <Prim.Text as="p" fontSize="$xs" color="$muted-foreground">Environment variables loaded by the pod at startup.</Prim.Text>
      <Prim.TextArea
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        rows={14}
        value={content}
        onChange={(e) => { setContent(e.target.value); setStatus('idle'); }}
        placeholder="KEY=value"
        spellCheck={false}
      />
      <Prim.Row gap="$3" alignItems="center" alignSelf="flex-end">
        {status === 'saved' && <Prim.Text fontSize="$xs" color="$success">Saved</Prim.Text>}
        {status === 'error' && <Prim.Text fontSize="$xs" color="$destructive">Error saving</Prim.Text>}
        <Button variant="default" size="sm" loading={saving} onClick={() => void save()}>
          Save env
        </Button>
      </Prim.Row>
    </Prim.Col>
  );
}

function InstructionsTab({ projectId }: { projectId: string }) {
  const [content, setContent] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setLoaded(false);
    apiGet<{ content: string }>(`/api/projects/${projectId}/instructions`)
      .then(r => { setContent(r.content); setLoaded(true); })
      .catch(() => { setContent(''); setLoaded(true); });
  }, [projectId]);

  const save = async () => {
    setSaving(true);
    try { await apiPut(`/api/projects/${projectId}/instructions`, { content }); }
    finally { setSaving(false); }
  };

  if (!loaded) return <Prim.Row justifyContent="center" padding="$6" alignItems="center"><Spinner /></Prim.Row>;

  return (
    <Prim.Col gap="$3" padding="$4">
      <Prim.TextArea
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        rows={12}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Instructions for THING in this project…"
      />
      <Button variant="default" size="sm" loading={saving} onClick={() => void save()} className="self-end">
        Save instructions
      </Button>
    </Prim.Col>
  );
}

function DocumentsTab({ projectId }: { projectId: string }) {
  const [docs, setDocs] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const reload = () => {
    apiGet<{ documents: string[] }>(`/api/projects/${projectId}/documents`)
      .then(r => setDocs(r.documents)).catch(() => setDocs([]));
  };
  React.useEffect(() => { reload(); }, [projectId]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const content = await file.text();
      await apiPost(`/api/projects/${projectId}/documents`, { name: file.name, content });
      reload();
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <Prim.Col gap="$2" padding="$4">
      {docs.length === 0 && <Prim.Text as="p" fontSize="$sm" color="$muted-foreground">No documents yet.</Prim.Text>}
      {docs.map(d => (
        <Prim.Row key={d} backgroundColor="color-mix(in srgb, var(--muted) 40%, transparent)" gap="$2" paddingHorizontal="$3" paddingVertical="$2" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" alignItems="center">
          <Prim.Text fontSize="$sm">📄</Prim.Text>
          <Prim.Text fontSize="$sm" color="$foreground" flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={d}>{d}</Prim.Text>
        </Prim.Row>
      ))}
      <Prim.Text as="label" marginTop="0.5rem" className={uploading && 'opacity-50 pointer-events-none'} alignSelf="flex-start" cursor="pointer">
        <Button variant="outline" size="sm" loading={uploading}>
          {uploading ? 'Uploading…' : '+ Upload file'}
        </Button>
        <Prim.TextField ref={fileRef} type="file" className="hidden" onChange={(e) => void handleFile(e)} />
      </Prim.Text>
    </Prim.Col>
  );
}

interface SpaceAction { id: string; label: string; }
interface SpaceMeta { id: string; name: string; description: string; agents: { slug: string; title: string; actions: SpaceAction[] }[]; functionCount: number; componentCount: number; hasKnowledge: boolean; }

function SpacesTab({ projectId }: { projectId: string }) {
  const [spaces, setSpaces] = React.useState<SpaceMeta[] | null>(null);
  React.useEffect(() => {
    apiGet<{ spaces: SpaceMeta[] }>(`/api/projects/${projectId}/spaces`)
      .then(r => setSpaces(r.spaces)).catch(() => setSpaces([]));
  }, [projectId]);

  if (spaces === null) return <Prim.Row justifyContent="center" padding="$6" alignItems="center"><Spinner /></Prim.Row>;
  if (spaces.length === 0) return <Prim.Text as="p" padding="$4" fontSize="$sm" color="$muted-foreground">No spaces yet. Ask THING to build a specialist.</Prim.Text>;

  return (
    <Prim.Col gap="$2" padding="$4">
      {spaces.map(s => {
        const actions = s.agents.flatMap(a => a.actions);
        return (
          <Prim.Box key={s.id} borderWidth={1} borderColor="$border" borderRadius="$radius-xl" paddingHorizontal="$3" paddingVertical="$2.5" backgroundColor="$card">
            <Prim.Row gap="$2" marginBottom="$1" alignItems="center">
              <Prim.Text fontSize="$sm" fontWeight="$medium" color="$foreground" flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{s.name}</Prim.Text>
              <Prim.Text fontSize="$xs" color="$muted-foreground" fontFamily="$mono">{s.id}</Prim.Text>
            </Prim.Row>
            {s.description && <Prim.Text as="p" className="text-xs text-muted-foreground line-clamp-2" marginBottom="0.5rem">{s.description}</Prim.Text>}
            <Prim.Row flexWrap="wrap" gap="$1">
              <Prim.Text fontSize="$xs" backgroundColor="$muted" color="$muted-foreground" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full">{s.agents.length} agent{s.agents.length !== 1 && 's'}</Prim.Text>
              {s.functionCount > 0 && <Prim.Text fontSize="$xs" backgroundColor="$muted" color="$muted-foreground" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full">{s.functionCount} fn</Prim.Text>}
              {s.componentCount > 0 && <Prim.Text fontSize="$xs" backgroundColor="$muted" color="$muted-foreground" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full">{s.componentCount} comp</Prim.Text>}
              {s.hasKnowledge && <Prim.Text backgroundColor="color-mix(in srgb, var(--knowledge) 15%, transparent)" fontSize="$xs" color="$knowledge" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full">knowledge</Prim.Text>}
              {actions.map(a => <Prim.Text key={a.id} backgroundColor="color-mix(in srgb, var(--agent) 15%, transparent)" fontSize="$xs" color="$agent" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full">/{a.id}</Prim.Text>)}
            </Prim.Row>
          </Prim.Box>
        );
      })}
    </Prim.Col>
  );
}

interface ProjectSettingsProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
  /** Post the "integration configured — continue" nudge into the active chat after
   *  a save from the Integrations tab (once the pod is back). Lifted from the chat
   *  shell, which owns the message-send machinery. */
  onIntegrationConfigured?: (spaceId: string, message: string) => void;
}

export function ProjectSettings({ open, onClose, projectId, projectName, onIntegrationConfigured }: ProjectSettingsProps) {
  const [tab, setTab] = React.useState('instructions');
  const tabs = [
    { id: 'instructions', label: 'Instructions' },
    { id: 'documents', label: 'Documents' },
    { id: 'spaces', label: 'Spaces' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'env', label: 'Env' },
  ];

  return (
    <Drawer open={open} onClose={onClose} title={`${projectName ?? 'Project'} settings`} width="w-96" side="right">
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'instructions' && <InstructionsTab projectId={projectId} />}
      {tab === 'documents' && <DocumentsTab projectId={projectId} />}
      {tab === 'spaces' && <SpacesTab projectId={projectId} />}
      {tab === 'integrations' && <IntegrationsTab projectId={projectId} onConfigured={onIntegrationConfigured} />}
      {tab === 'env' && <EnvTab />}
    </Drawer>
  );
}
