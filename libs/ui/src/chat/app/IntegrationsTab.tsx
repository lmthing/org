import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { Button } from '../components/ui/Button.js';
import { Spinner } from '../components/ui/Spinner.js';
import { authHeaders } from './auth.js';
import { useStore } from '../store/store.js';
import { dataPlaneOrigin } from '../../lib/app-urls.js';
import { SettingsSchemaForm, type JsonSchema } from '../../studio/integrations/SettingsSchemaForm.js';
import { Markdown } from '../../elements/content/markdown/index.js';
import { overlayEnvKeys, waitForPodReady, resumeMessage } from './auto-resume.js';

/** One installed integration space, as returned by the pod's
 *  `GET /api/projects/:projectId/integrations` (S13 adds `missingRequired`/`configured`). */
interface InstalledIntegration {
  spaceId: string;
  title: string;
  icon: string | null;
  tags: string[];
  settings: JsonSchema | null;
  readme?: string | null;
  missingRequired: string[];
  configured: boolean;
}

/** One inbound-webhook binding from the gateway `GET /api/inbound`. */
interface InboundBinding {
  path: string;
  provider: string;
  agentRef: string;
  projectId: string;
}
interface InboundInfo {
  baseUrl: string;
  bindings: InboundBinding[];
}

/** Per-integration auto-resume state after a save (pod restarts on env PUT). */
type ResumeState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'waiting' }
  | { kind: 'done' }
  | { kind: 'timeout'; message: string };

function schemaKeys(schema: JsonSchema | null | undefined): string[] {
  return schema?.properties ? Object.keys(schema.properties) : [];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Chat drawer's Integrations tab (S13). Configure an installed integration's API
 * keys WITHOUT the keys ever entering the LLM context: the schema form's values are
 * pod env vars written via the gateway GET-merge-PUT `/api/compute/env`, and only
 * the NAMES of missing required keys are surfaced (from the pod's `missingRequired`).
 * After a save the pod restarts; once it's serving again we post ONE resume nudge
 * into the active chat (via `onConfigured`) so THING continues — with a visible
 * "waiting…" state and a Retry on timeout (never a silent drop).
 */
export function IntegrationsTab({
  projectId,
  onConfigured,
}: {
  projectId: string;
  /** Post the resume message into the active chat. Returns whether it was delivered
   *  (an open socket). Supplied by the chat shell, which owns the send machinery. */
  onConfigured?: (spaceId: string, message: string) => void;
}) {
  const CLOUD = dataPlaneOrigin('cloud');
  const [integrations, setIntegrations] = React.useState<InstalledIntegration[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [inbound, setInbound] = React.useState<InboundInfo | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [resume, setResume] = React.useState<Record<string, ResumeState>>({});
  // Guard: a save/resume already in flight for a space must not double-post.
  const inFlight = React.useRef<Set<string>>(new Set());

  const allKeys = React.useMemo(
    () => Array.from(new Set((integrations ?? []).flatMap((i) => schemaKeys(i.settings)))),
    [integrations],
  );

  // Load the integrations installed in this project (same-origin pod route).
  React.useEffect(() => {
    let cancelled = false;
    setIntegrations(null);
    setLoadError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/integrations`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setIntegrations(Array.isArray(d?.integrations) ? d.integrations : []);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Failed to load installed integrations.');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Pull the current values for the keys that matter, from the gateway env.
  React.useEffect(() => {
    if (allKeys.length === 0) return;
    let cancelled = false;
    fetch(`${CLOUD}/api/compute/env`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.vars) return;
        const cur = d.vars as Record<string, string>;
        setFields((prev) => ({ ...Object.fromEntries(allKeys.map((k) => [k, cur[k] ?? ''])), ...prev }));
      })
      .catch(() => {
        /* best-effort — fields stay blank */
      });
    return () => {
      cancelled = true;
    };
  }, [CLOUD, allKeys]);

  // Public inbound webhook URLs to paste into providers (gateway broker).
  React.useEffect(() => {
    let cancelled = false;
    fetch(`${CLOUD}/api/inbound`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: InboundInfo) => {
        if (cancelled) return;
        setInbound({ baseUrl: d?.baseUrl ?? '', bindings: Array.isArray(d?.bindings) ? d.bindings : [] });
      })
      .catch(() => {
        /* best-effort — the URL section is simply omitted */
      });
    return () => {
      cancelled = true;
    };
  }, [CLOUD]);

  const copy = (key: string, url: string) => {
    void navigator.clipboard?.writeText(url);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  /** Probe: pod edge serving again AND the chat socket is live (so the follow-up
   *  message actually reaches the agent, never dropped on a closed socket). */
  const probeReady = async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/env', { headers: authHeaders() });
      if (!r.ok) return false;
    } catch {
      return false;
    }
    return useStore.getState().connection === 'open';
  };

  const runResume = async (spaceId: string) => {
    setResume((s) => ({ ...s, [spaceId]: { kind: 'waiting' } }));
    try {
      await waitForPodReady({ probe: probeReady, sleep, now: () => Date.now() });
      onConfigured?.(spaceId, resumeMessage(spaceId));
      setResume((s) => ({ ...s, [spaceId]: { kind: 'done' } }));
      // Refresh status so the badge flips to "configured".
      try {
        const d = await fetch(`/api/projects/${encodeURIComponent(projectId)}/integrations`, {
          headers: authHeaders(),
        }).then((r) => r.json());
        if (Array.isArray(d?.integrations)) setIntegrations(d.integrations);
      } catch {
        /* best-effort */
      }
    } catch (err) {
      setResume((s) => ({
        ...s,
        [spaceId]: { kind: 'timeout', message: err instanceof Error ? err.message : 'Restart timed out' },
      }));
    } finally {
      inFlight.current.delete(spaceId);
    }
  };

  const save = async (integration: InstalledIntegration) => {
    const spaceId = integration.spaceId;
    if (inFlight.current.has(spaceId)) return; // guard: no double save/post
    inFlight.current.add(spaceId);
    setResume((s) => ({ ...s, [spaceId]: { kind: 'saving' } }));
    const keys = schemaKeys(integration.settings);
    try {
      // GET-merge-PUT: the PUT replaces the whole var set, so re-read fresh and
      // overlay only this integration's keys before writing.
      const cur = await fetch(`${CLOUD}/api/compute/env`, { headers: authHeaders() })
        .then((r) => r.json())
        .catch(() => ({ vars: {} }));
      const all = overlayEnvKeys((cur?.vars ?? {}) as Record<string, string>, keys, fields);
      const res = await fetch(`${CLOUD}/api/compute/env`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ vars: all }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to save');
      }
      // Saved → pod is restarting. Wait for it, then nudge THING to continue.
      void runResume(spaceId);
    } catch (err) {
      inFlight.current.delete(spaceId);
      setResume((s) => ({
        ...s,
        [spaceId]: { kind: 'error', message: err instanceof Error ? err.message : 'Failed to save' },
      }));
    }
  };

  const retryResume = (spaceId: string) => {
    if (inFlight.current.has(spaceId)) return;
    inFlight.current.add(spaceId);
    void runResume(spaceId);
  };

  if (integrations === null && !loadError) {
    return (
      <Prim.Row justifyContent="center" padding="$6" alignItems="center">
        <Spinner />
      </Prim.Row>
    );
  }
  if (loadError) return <Prim.Text as="p" padding="$4" fontSize="$sm" color="$destructive">{loadError}</Prim.Text>;
  if (integrations !== null && integrations.length === 0) {
    return (
      <Prim.Text as="p" padding="$4" fontSize="$sm" color="$muted-foreground">
        No integrations installed in this project yet. Ask THING to add one from the store.
      </Prim.Text>
    );
  }

  return (
    <Prim.Col gap="$4" padding="$4">
      {(integrations ?? []).map((integration) => {
        const keys = schemaKeys(integration.settings);
        const bindings = (inbound?.bindings ?? []).filter((b) => b.projectId === projectId);
        const st = resume[integration.spaceId] ?? { kind: 'idle' };
        return (
          <Prim.Col key={integration.spaceId} borderWidth={1} borderColor="$border" borderRadius="$radius-xl" backgroundColor="$card" padding="$3" gap="$3">
            <Prim.Row gap="$2" alignItems="center">
              {integration.icon && <Prim.Text aria-hidden="true">{integration.icon}</Prim.Text>}
              <Prim.Text fontSize="$sm" fontWeight="$medium" color="$foreground" flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{integration.title}</Prim.Text>
              {integration.configured ? (
                <Prim.Text className="bg-success/15" fontSize="$xs" color="$success" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full">configured</Prim.Text>
              ) : (
                <Prim.Text className="bg-warning/15" fontSize="$xs" color="$warning" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full">
                  {integration.missingRequired.length} key{integration.missingRequired.length !== 1 && 's'} needed
                </Prim.Text>
              )}
            </Prim.Row>

            {integration.readme ? (
              <Prim.Box as="details" className="bg-muted/40" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" paddingHorizontal="$3" paddingVertical="$2">
                <Prim.Box as="summary" fontSize="$xs" color="$muted-foreground" cursor="pointer" userSelect="none">
                  Setup guide — how to get your keys
                </Prim.Box>
                <Prim.Box fontSize="$sm" color="$foreground" marginTop="0.5rem">
                  <Markdown source={integration.readme} />
                </Prim.Box>
              </Prim.Box>
            ) : null}

            {keys.length > 0 ? (
              <SettingsSchemaForm
                schema={integration.settings as JsonSchema}
                values={fields}
                onChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))}
              />
            ) : (
              <Prim.Text as="p" fontSize="$xs" color="$muted-foreground">This integration has no configurable settings.</Prim.Text>
            )}

            {bindings.length > 0 && (
              <Prim.Col gap="$1.5">
                <Prim.Text as="p" fontSize="$xs" color="$muted-foreground">
                  Inbound webhook URL{bindings.length !== 1 && 's'} — paste into the provider:
                </Prim.Text>
                {bindings.map((b) => {
                  const url = `${inbound?.baseUrl ?? ''}/${b.path}`;
                  const key = `${b.projectId}/${b.path}`;
                  return (
                    <Prim.Row key={key} gap="$2" alignItems="center">
                      <Prim.Text as="code" flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0} fontSize="$xs" fontFamily="$mono" color="$foreground" backgroundColor="$background" borderWidth={1} borderColor="$border" borderRadius="$radius" paddingHorizontal="$2" paddingVertical="$1" overflowX="auto" whiteSpace="nowrap">
                        {url}
                      </Prim.Text>
                      <Button variant="outline" size="sm" onClick={() => copy(key, url)}>
                        {copied === key ? 'Copied' : 'Copy'}
                      </Button>
                    </Prim.Row>
                  );
                })}
              </Prim.Col>
            )}

            <Prim.Row gap="$3" flexWrap="wrap" alignItems="center">
              <Button
                variant="default"
                size="sm"
                loading={st.kind === 'saving'}
                disabled={st.kind === 'saving' || st.kind === 'waiting'}
                onClick={() => void save(integration)}
              >
                {st.kind === 'saving' ? 'Saving…' : 'Save keys'}
              </Button>
              {st.kind === 'waiting' && (
                <Prim.Text fontSize="$xs" color="$muted-foreground" alignItems="center" gap="$1.5" display="flex">
                  <Spinner size={12} /> Waiting for the pod to restart…
                </Prim.Text>
              )}
              {st.kind === 'done' && <Prim.Text fontSize="$xs" color="$success">Saved — THING notified.</Prim.Text>}
              {st.kind === 'error' && <Prim.Text fontSize="$xs" color="$destructive">{st.message}</Prim.Text>}
              {st.kind === 'timeout' && (
                <Prim.Text fontSize="$xs" color="$muted-foreground" alignItems="center" gap="$2" display="flex">
                  {st.message}
                  <Button variant="outline" size="sm" onClick={() => retryResume(integration.spaceId)}>
                    Retry
                  </Button>
                </Prim.Text>
              )}
            </Prim.Row>
          </Prim.Col>
        );
      })}
    </Prim.Col>
  );
}
