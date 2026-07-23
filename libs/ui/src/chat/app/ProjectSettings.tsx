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

  if (!loaded) return <Prim.Box className="flex items-center justify-center p-6"><Spinner /></Prim.Box>;

  return (
    <Prim.Box className="flex flex-col gap-3 p-4">
      <Prim.Text as="p" className="text-xs text-muted-foreground">Environment variables loaded by the pod at startup.</Prim.Text>
      <Prim.TextArea
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        rows={14}
        value={content}
        onChange={(e) => { setContent(e.target.value); setStatus('idle'); }}
        placeholder="KEY=value"
        spellCheck={false}
      />
      <Prim.Box className="flex items-center gap-3 self-end">
        {status === 'saved' && <Prim.Text className="text-xs text-success">Saved</Prim.Text>}
        {status === 'error' && <Prim.Text className="text-xs text-destructive">Error saving</Prim.Text>}
        <Button variant="default" size="sm" loading={saving} onClick={() => void save()}>
          Save env
        </Button>
      </Prim.Box>
    </Prim.Box>
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

  if (!loaded) return <Prim.Box className="flex items-center justify-center p-6"><Spinner /></Prim.Box>;

  return (
    <Prim.Box className="flex flex-col gap-3 p-4">
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
    </Prim.Box>
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
    <Prim.Box className="flex flex-col gap-2 p-4">
      {docs.length === 0 && <Prim.Text as="p" className="text-sm text-muted-foreground">No documents yet.</Prim.Text>}
      {docs.map(d => (
        <Prim.Box key={d} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/40">
          <Prim.Text className="text-sm">📄</Prim.Text>
          <Prim.Text className="text-sm text-foreground truncate flex-1" title={d}>{d}</Prim.Text>
        </Prim.Box>
      ))}
      <Prim.Text as="label" className={cn('mt-2 self-start cursor-pointer', uploading && 'opacity-50 pointer-events-none')}>
        <Button variant="outline" size="sm" loading={uploading}>
          {uploading ? 'Uploading…' : '+ Upload file'}
        </Button>
        <Prim.TextField ref={fileRef} type="file" className="hidden" onChange={(e) => void handleFile(e)} />
      </Prim.Text>
    </Prim.Box>
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

  if (spaces === null) return <Prim.Box className="flex items-center justify-center p-6"><Spinner /></Prim.Box>;
  if (spaces.length === 0) return <Prim.Text as="p" className="p-4 text-sm text-muted-foreground">No spaces yet. Ask THING to build a specialist.</Prim.Text>;

  return (
    <Prim.Box className="flex flex-col gap-2 p-4">
      {spaces.map(s => {
        const actions = s.agents.flatMap(a => a.actions);
        return (
          <Prim.Box key={s.id} className="border border-border rounded-xl px-3 py-2.5 bg-card">
            <Prim.Box className="flex items-center gap-2 mb-1">
              <Prim.Text className="text-sm font-medium text-foreground flex-1 truncate">{s.name}</Prim.Text>
              <Prim.Text className="text-xs text-muted-foreground font-mono">{s.id}</Prim.Text>
            </Prim.Box>
            {s.description && <Prim.Text as="p" className="text-xs text-muted-foreground mb-2 line-clamp-2">{s.description}</Prim.Text>}
            <Prim.Box className="flex flex-wrap gap-1">
              <Prim.Text className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{s.agents.length} agent{s.agents.length !== 1 && 's'}</Prim.Text>
              {s.functionCount > 0 && <Prim.Text className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{s.functionCount} fn</Prim.Text>}
              {s.componentCount > 0 && <Prim.Text className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{s.componentCount} comp</Prim.Text>}
              {s.hasKnowledge && <Prim.Text className="text-xs bg-knowledge/15 text-knowledge px-1.5 py-0.5 rounded-full">knowledge</Prim.Text>}
              {actions.map(a => <Prim.Text key={a.id} className="text-xs bg-agent/15 text-agent px-1.5 py-0.5 rounded-full">/{a.id}</Prim.Text>)}
            </Prim.Box>
          </Prim.Box>
        );
      })}
    </Prim.Box>
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
