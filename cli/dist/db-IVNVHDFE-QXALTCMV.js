// ../repl/dist/db-IVNVHDFE.js
async function getSqlite() {
  try {
    return (await import("better-sqlite3")).default;
  } catch {
    throw new Error("better-sqlite3 is required for database operations. Install with: pnpm add better-sqlite3");
  }
}
var dbInstance = null;
var dbPath = "./repl.db";
function setDbPath(path) {
  dbPath = path;
  dbInstance = null;
}
async function getDb() {
  if (!dbInstance) {
    const Database = await getSqlite();
    dbInstance = new Database(dbPath);
  }
  return dbInstance;
}
var dbModule = {
  id: "db",
  description: "Database queries (SQLite)",
  functions: [
    {
      name: "dbQuery",
      description: "Run SELECT query, return rows",
      signature: "(sql: string, params?: any[]) => Promise<any[]>",
      fn: async (sql, params) => {
        const db = await getDb();
        const stmt = db.prepare(sql);
        return stmt.all(...params ?? []);
      }
    },
    {
      name: "dbExecute",
      description: "Run INSERT/UPDATE/DELETE",
      signature: "(sql: string, params?: any[]) => Promise<{ changes: number }>",
      fn: async (sql, params) => {
        const db = await getDb();
        const stmt = db.prepare(sql);
        const result = stmt.run(...params ?? []);
        return { changes: result.changes };
      }
    },
    {
      name: "dbSchema",
      description: "Get database schema",
      signature: "() => Promise<{ tables: Array<{ name: string, columns: any[] }> }>",
      fn: async () => {
        const db = await getDb();
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const result = [];
        for (const table of tables) {
          const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
          result.push({ name: table.name, columns });
        }
        return { tables: result };
      }
    }
  ]
};
var db_default = dbModule;
export {
  db_default as default,
  setDbPath
};
