// src/cli/test-runner.ts
import { spawnSync } from "child_process";
import { readdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
var __dirname = dirname(fileURLToPath(import.meta.url));
function collectTestFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(full));
    } else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files;
}
function findVitestBin() {
  let dir = __dirname;
  while (true) {
    const candidate = join(dir, "node_modules", ".bin", "vitest");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "vitest";
}
function findMonorepoRoot() {
  let dir = __dirname;
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function runSpaceTests(spacePaths, options = {}) {
  const testFiles = [];
  for (const spacePath of spacePaths) {
    const abs = resolve(spacePath);
    const found = collectTestFiles(abs);
    testFiles.push(...found);
  }
  if (testFiles.length === 0) {
    console.log("No test files found in the specified space(s).");
    for (const sp of spacePaths) console.log(`  Searched: ${resolve(sp)}`);
    return 0;
  }
  console.log(`
\x1B[36m\u2501\u2501\u2501 lmthing test \u2501\u2501\u2501\x1B[0m`);
  console.log(`\x1B[90mFound ${testFiles.length} test file(s):\x1B[0m`);
  for (const f of testFiles) console.log(`\x1B[90m  ${f}\x1B[0m`);
  console.log();
  const vitestBin = findVitestBin();
  const cwd = findMonorepoRoot() ?? process.cwd();
  const env = { ...process.env };
  const result = spawnSync(vitestBin, ["run", "--reporter", "verbose", ...testFiles], {
    cwd,
    env,
    stdio: "inherit"
  });
  return result.status ?? 1;
}
export {
  runSpaceTests
};
