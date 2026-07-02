import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';
import {
  WINDOW_LABELS,
  parseDurationDays,
  windowBounds,
  sumSpend,
  remainingPct,
  isoDate,
} from './budget-math.js';

/**
 * GET /api/budget — remaining budget per rolling window (1d / 7d / 30d) for the
 * pod's user, computed from LiteLLM using only the pod's own `LMTHINGCLOUD_API_KEY`.
 *
 * LiteLLM doesn't expose per-window spend, so we read the window caps + the key's
 * `created_at` from `/key/info` and sum per-day spend from `/user/daily/activity`,
 * anchoring each window to the first-provision day. Non-lmthingcloud / local pods
 * (no env) return 404, which the UI treats as "hidden".
 */

interface KeyBudgetLimit {
  budget_duration?: string;
  max_budget?: number;
}
interface KeyInfoResponse {
  info?: { created_at?: string; budget_limits?: KeyBudgetLimit[] };
}
interface DailyActivityResponse {
  results?: { date?: string; metrics?: { spend?: number } }[];
  metadata?: { total_pages?: number };
}

export interface BudgetWindowResult {
  duration: string;
  label: string;
  remainingPct: number | null;
  resetsAt: string;
}

const CACHE_MS = 30_000;
let cache: { at: number; body: { windows: BudgetWindowResult[] } } | null = null;

function litellmBase(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

async function fetchDailyActivity(
  base: string,
  headers: Record<string, string>,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const byDate = new Map<string, number>();
  let page = 1;
  // 30d is at most ~31 daily rows (< one page), but page defensively anyway.
  for (; page <= 5; page++) {
    const url = `${base}/user/daily/activity?start_date=${start}&end_date=${end}&page=${page}`;
    const r = await fetch(url, { headers });
    if (!r.ok) break;
    const j = (await r.json()) as DailyActivityResponse;
    for (const row of j.results ?? []) {
      if (row.date && typeof row.metrics?.spend === 'number') {
        byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.metrics.spend);
      }
    }
    const totalPages = j.metadata?.total_pages;
    if (!totalPages || page >= totalPages) break;
  }
  return byDate;
}

export const handleBudget: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const apiKey = process.env.LMTHINGCLOUD_API_KEY;
  const baseUrl = process.env.LMTHINGCLOUD_BASE_URL;
  if (!apiKey || !baseUrl) {
    sendJson(res, 404, { error: 'budget not available' });
    return;
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    sendJson(res, 200, cache.body);
    return;
  }

  const base = litellmBase(baseUrl);
  const headers = { Authorization: `Bearer ${apiKey}` };

  try {
    const keyRes = await fetch(`${base}/key/info`, { headers });
    if (!keyRes.ok) {
      sendJson(res, 404, { error: 'budget not available' });
      return;
    }
    const info = ((await keyRes.json()) as KeyInfoResponse).info ?? {};
    const limits = (info.budget_limits ?? []).filter(
      (l): l is Required<KeyBudgetLimit> =>
        typeof l.budget_duration === 'string' && typeof l.max_budget === 'number',
    );
    if (limits.length === 0) {
      sendJson(res, 404, { error: 'no budget windows' });
      return;
    }

    const createdMs = info.created_at ? Date.parse(info.created_at) : Date.now();
    const nowMs = Date.now();

    const specs = limits.map((l) => {
      const nDays = parseDurationDays(l.budget_duration) ?? 1;
      const { start, reset } = windowBounds(createdMs, nowMs, nDays);
      return { duration: l.budget_duration, maxBudget: l.max_budget, nDays, start, reset };
    });

    const earliest = Math.min(...specs.map((s) => s.start));
    const daily = await fetchDailyActivity(base, headers, isoDate(earliest), isoDate(nowMs));

    const windows: BudgetWindowResult[] = specs
      .sort((a, b) => a.nDays - b.nDays)
      .map((s) => ({
        duration: s.duration,
        label: WINDOW_LABELS[s.duration] ?? s.duration,
        remainingPct: remainingPct(s.maxBudget, sumSpend(daily, s.start, nowMs)),
        resetsAt: new Date(s.reset).toISOString(),
      }));

    const body = { windows };
    cache = { at: Date.now(), body };
    sendJson(res, 200, body);
  } catch (err) {
    sendJson(res, 502, {
      error: err instanceof Error ? err.message : 'budget fetch failed',
    });
  }
};
