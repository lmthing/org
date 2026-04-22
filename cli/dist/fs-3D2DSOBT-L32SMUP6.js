import {
  recordRead
} from "./chunk-IKFUKRCF.js";

// ../repl/dist/fs-3D2DSOBT.js
import * as nodeFs from "fs/promises";
import * as nodePath from "path";
import { glob as nodeGlob } from "fs/promises";
var workingDir = process.cwd();
var activeLedger = null;
function setWorkingDir(dir) {
  workingDir = dir;
}
function setReadLedger(ledger) {
  activeLedger = ledger;
}
function safePath(p) {
  const resolved = nodePath.resolve(workingDir, p);
  if (!resolved.startsWith(workingDir)) {
    throw new Error(`Path traversal blocked: ${p} resolves outside working directory`);
  }
  return resolved;
}
var fsModule = {
  id: "fs",
  description: "File system operations",
  functions: [
    {
      name: "readFile",
      description: "Read file contents",
      signature: "(path: string, encoding?: string) => Promise<string>",
      fn: async (path, encoding) => {
        const resolved = safePath(path);
        const content = await nodeFs.readFile(resolved, encoding || "utf-8");
        if (activeLedger) recordRead(activeLedger, resolved);
        return content;
      }
    },
    {
      name: "writeFile",
      description: "Write content to file",
      signature: "(path: string, content: string) => Promise<void>",
      fn: async (path, content) => {
        await nodeFs.writeFile(safePath(path), content, "utf-8");
      }
    },
    {
      name: "appendFile",
      description: "Append to file",
      signature: "(path: string, content: string) => Promise<void>",
      fn: async (path, content) => {
        await nodeFs.appendFile(safePath(path), content, "utf-8");
      }
    },
    {
      name: "listDir",
      description: "List directory entries",
      signature: "(path: string, options?: { recursive?: boolean }) => Promise<string[]>",
      fn: async (path, options) => {
        const opts = options;
        const entries = await nodeFs.readdir(safePath(path), { recursive: opts?.recursive });
        return entries.map(String);
      }
    },
    {
      name: "glob",
      description: "Glob pattern match",
      signature: "(pattern: string, cwd?: string) => Promise<string[]>",
      fn: async (pattern, cwd) => {
        const dir = cwd ? safePath(cwd) : workingDir;
        const results = [];
        for await (const entry of nodeGlob(pattern, { cwd: dir })) {
          results.push(entry);
        }
        return results;
      }
    },
    {
      name: "stat",
      description: "File metadata",
      signature: "(path: string) => Promise<{ size: number, modified: string, isDir: boolean }>",
      fn: async (path) => {
        const stats = await nodeFs.stat(safePath(path));
        return { size: stats.size, modified: stats.mtime.toISOString(), isDir: stats.isDirectory() };
      }
    },
    {
      name: "exists",
      description: "Check if path exists",
      signature: "(path: string) => Promise<boolean>",
      fn: async (path) => {
        try {
          await nodeFs.access(safePath(path));
          return true;
        } catch {
          return false;
        }
      }
    },
    {
      name: "mkdir",
      description: "Create directory (recursive)",
      signature: "(path: string) => Promise<void>",
      fn: async (path) => {
        await nodeFs.mkdir(safePath(path), { recursive: true });
      }
    },
    {
      name: "remove",
      description: "Delete file or directory",
      signature: "(path: string) => Promise<void>",
      fn: async (path) => {
        await nodeFs.rm(safePath(path), { recursive: true, force: true });
      }
    },
    {
      name: "copy",
      description: "Copy file or directory",
      signature: "(src: string, dest: string) => Promise<void>",
      fn: async (src, dest) => {
        await nodeFs.cp(safePath(src), safePath(dest), { recursive: true });
      }
    },
    {
      name: "move",
      description: "Move/rename file or directory",
      signature: "(src: string, dest: string) => Promise<void>",
      fn: async (src, dest) => {
        await nodeFs.rename(safePath(src), safePath(dest));
      }
    }
  ]
};
var fs_default = fsModule;
export {
  fs_default as default,
  setReadLedger,
  setWorkingDir
};
