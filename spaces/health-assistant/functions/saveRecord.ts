/**
 * Save a structured health record to the user's persistent health profile.
 *
 * Records are stored in `profile/<category>.json` relative to the space root.
 * Each category file is an array of records. New records are appended unless
 * an existing record matches by `id` or `date`+`identifier`, in which case
 * it is updated.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export interface SaveRecordOpts {
  /** Merge strategy for existing records with same ID. Default: "upsert". */
  strategy?: "upsert" | "append" | "replace";
  /** Custom record ID (auto-generated if not provided). */
  id?: string;
  /** Date of the record (defaults to now, ISO 8601). */
  date?: string;
}

export interface SaveRecordResult {
  saved: boolean;
  category: string;
  recordId: string;
  totalRecords: number;
}

function resolveProfilePath(category: string): string {
  const base = process.env.HEALTH_PROFILE_DIR ?? resolve(process.cwd(), "profile");
  return resolve(base, `${category}.json`);
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveRecord(
  category: string,
  data: Record<string, unknown>,
  opts: SaveRecordOpts = {},
): Promise<SaveRecordResult> {
  const filePath = resolveProfilePath(category);
  const recordId = opts.id ?? generateId();
  const record: Record<string, unknown> = {
    id: recordId,
    date: opts.date ?? new Date().toISOString(),
    savedAt: new Date().toISOString(),
    ...data,
  };

  await mkdir(dirname(filePath), { recursive: true });

  if (opts.strategy === "replace") {
    await writeFile(filePath, JSON.stringify([record], null, 2), "utf-8");
    return { saved: true, category, recordId, totalRecords: 1 };
  }

  let records: Record<string, unknown>[] = [];
  try {
    const raw = await readFile(filePath, "utf-8");
    records = JSON.parse(raw) as Record<string, unknown>[];
  } catch {
    // File doesn't exist yet — start with empty array
  }

  if (opts.strategy === "append") {
    records.push(record);
  } else {
    // upsert: find existing by id or by date+category-specific identifier
    const existingIdx = records.findIndex((r) => {
      if (r.id === recordId) return true;
      if (record.date && r.date === record.date && r.identifier && r.identifier === record.identifier) return true;
      return false;
    });
    if (existingIdx >= 0) {
      records[existingIdx] = { ...records[existingIdx], ...record };
    } else {
      records.push(record);
    }
  }

  await writeFile(filePath, JSON.stringify(records, null, 2), "utf-8");

  return { saved: true, category, recordId, totalRecords: records.length };
}
