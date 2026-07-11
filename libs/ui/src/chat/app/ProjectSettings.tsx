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

  if (!loaded) return <div className="flex items-center justify-center p-6"><Spinner /></div>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">Environment variables loaded by the pod at startup.</p>
      <textarea
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        rows={14}
        value={content}
        onChange={(e) => { setContent(e.target.value); setStatus('idle'); }}
        placeholder="KEY=value"
        spellCheck={false}
      />
      <div className="flex items-center gap-3 self-end">
        {status === 'saved' && <span className="text-xs text-success">Saved</span>}
        {status === 'error' && <span className="text-xs text-destructive">Error saving</span>}
        <Button variant="default" size="sm" loading={saving} onClick={() => void save()}>
          Save env
        </Button>
      </div>
    </div>
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

  if (!loaded) return <div className="flex items-center justify-center p-6"><Spinner /></div>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <textarea
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        rows={12}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Instructions for THING in this project…"
      />
      <Button variant="default" size="sm" loading={saving} onClick={() => void save()} className="self-end">
        Save instructions
      </Button>
    </div>
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
    <div className="flex flex-col gap-2 p-4">
      {docs.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
      {docs.map(d => (
        <div key={d} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/40">
          <span className="text-sm">📄</span>
          <span className="text-sm text-foreground truncate flex-1" title={d}>{d}</span>
        </div>
      ))}
      <label className={cn('mt-2 self-start cursor-pointer', uploading && 'opacity-50 pointer-events-none')}>
        <Button variant="outline" size="sm" loading={uploading}>
          {uploading ? 'Uploading…' : '+ Upload file'}
        </Button>
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => void handleFile(e)} />
      </label>
    </div>
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

  if (spaces === null) return <div className="flex items-center justify-center p-6"><Spinner /></div>;
  if (spaces.length === 0) return <p className="p-4 text-sm text-muted-foreground">No spaces yet. Ask THING to build a specialist.</p>;

  return (
    <div className="flex flex-col gap-2 p-4">
      {spaces.map(s => {
        const actions = s.agents.flatMap(a => a.actions);
        return (
          <div key={s.id} className="border border-border rounded-xl px-3 py-2.5 bg-card">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-foreground flex-1 truncate">{s.name}</span>
              <span className="text-xs text-muted-foreground font-mono">{s.id}</span>
            </div>
            {s.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{s.description}</p>}
            <div className="flex flex-wrap gap-1">
              <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{s.agents.length} agent{s.agents.length !== 1 && 's'}</span>
              {s.functionCount > 0 && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{s.functionCount} fn</span>}
              {s.componentCount > 0 && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{s.componentCount} comp</span>}
              {s.hasKnowledge && <span className="text-xs bg-knowledge/15 text-knowledge px-1.5 py-0.5 rounded-full">knowledge</span>}
              {actions.map(a => <span key={a.id} className="text-xs bg-agent/15 text-agent px-1.5 py-0.5 rounded-full">/{a.id}</span>)}
            </div>
          </div>
        );
      })}
    </div>
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
