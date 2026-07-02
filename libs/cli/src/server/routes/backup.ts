import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';
import { runBackup, runRestore, readBackupStatus } from '../backup.js';

/**
 * Backup/restore of the pod workspace to the user's GitHub repo. The workspace
 * root is `ctx.effectiveLmthingRoot` (the `.lmthing` tree on the PVC); when it's
 * absent (non-project mode) backup is unavailable.
 */

function workTreeOr404(res: ServerResponse, root: string | undefined): root is string {
  if (!root) {
    sendJson(res, 400, { error: 'workspace backup unavailable (no project root)' });
    return false;
  }
  return true;
}

export const handleBackupNow: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  _params,
  ctx,
): Promise<void> => {
  const root = ctx.effectiveLmthingRoot;
  if (!workTreeOr404(res, root)) return;
  try {
    const result = await runBackup({ trigger: 'manual', workTree: root });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'backup failed' });
  }
};

export const handleBackupStatus: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  _params,
  ctx,
): Promise<void> => {
  const root = ctx.effectiveLmthingRoot;
  if (!workTreeOr404(res, root)) return;
  const status = await readBackupStatus(root);
  sendJson(res, 200, status);
};

export const handleRestore: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  _params,
  ctx,
): Promise<void> => {
  const root = ctx.effectiveLmthingRoot;
  if (!workTreeOr404(res, root)) return;
  try {
    const result = await runRestore({ workTree: root });
    sendJson(res, result.ok ? 200 : 409, result);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'restore failed' });
  }
};
