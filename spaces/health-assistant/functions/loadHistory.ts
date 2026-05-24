/**
 * Load the user's complete health history from the profile.
 *
 * Reads all category files from the profile directory and returns
 * a unified HealthHistory object.
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface LoadHistoryOpts {
  /** Specific categories to load. Default: all. */
  categories?: string[];
  /** Sort order for records within each category. Default: "desc" (newest first). */
  sortOrder?: "asc" | "desc";
  /** Filter records after this date (ISO 8601). */
  since?: string;
  /** Filter records before this date (ISO 8601). */
  until?: string;
}

export interface HealthHistory {
  loadedAt: string;
  categories: Record<string, Array<Record<string, unknown>>>;
  totalRecords: number;
  dateRange: { earliest?: string; latest?: string };
}

function resolveProfileDir(): string {
  return process.env.HEALTH_PROFILE_DIR ?? resolve(process.cwd(), "profile");
}

export async function loadHistory(opts: LoadHistoryOpts = {}): Promise<HealthHistory> {
  const profileDir = resolveProfileDir();
  const sortOrder = opts.sortOrder ?? "desc";

  let files: string[];
  try {
    files = await readdir(profileDir);
  } catch {
    return { loadedAt: new Date().toISOString(), categories: {}, totalRecords: 0, dateRange: {} };
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const targetFiles = opts.categories
    ? jsonFiles.filter((f) => opts.categories!.includes(f.replace(".json", "")))
    : jsonFiles;

  const categories: Record<string, Array<Record<string, unknown>>> = {};
  let totalRecords = 0;
  let earliest: string | undefined;
  let latest: string | undefined;

  for (const file of targetFiles) {
    const category = file.replace(".json", "");
    try {
      const raw = await readFile(resolve(profileDir, file), "utf-8");
      let records = JSON.parse(raw) as Array<Record<string, unknown>>;

      // Apply date filters
      if (opts.since) {
        records = records.filter((r) => {
          const d = r.date as string | undefined;
          return d && d >= opts.since!;
        });
      }
      if (opts.until) {
        records = records.filter((r) => {
          const d = r.date as string | undefined;
          return d && d <= opts.until!;
        });
      }

      // Sort by date
      records.sort((a, b) => {
        const da = (a.date as string) ?? "";
        const db = (b.date as string) ?? "";
        return sortOrder === "desc" ? db.localeCompare(da) : da.localeCompare(db);
      });

      // Track date range
      for (const r of records) {
        const d = r.date as string | undefined;
        if (d) {
          if (!earliest || d < earliest) earliest = d;
          if (!latest || d > latest) latest = d;
        }
      }

      categories[category] = records;
      totalRecords += records.length;
    } catch {
      categories[category] = [];
    }
  }

  return {
    loadedAt: new Date().toISOString(),
    categories,
    totalRecords,
    dateRange: { earliest, latest },
  };
}
