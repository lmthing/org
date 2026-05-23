#!/usr/bin/env tsx
/**
 * `llm-repl` — generic disk-driven space session.
 *
 * The CLI loads any space, picks an agent + flow, composes the system prompt
 * from disk, and runs the LLM loop until the flow's declared sink fires.
 * Domain-specific behavior (functions, system prompts, cycle hints, sink
 * declarations, knowledge) all live in the space, not here.
 *
 * Usage:
 *   tsx src/cli/space-bin.ts "<task>" [options]
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSpaceSession } from "../session/index.js";
import type { ModelAlias } from "../session/model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sandboxed host functions can transiently surface unhandled rejections
// (e.g. when a Promise.allSettled iteration aborts mid-array). Log them
// so they're visible in the transcript but DO NOT kill the session — the
// per-cycle catch logic upstream handles the actual contract.
process.on("uncaughtException", (e) => {
  console.error(`[uncaughtException] ${e instanceof Error ? e.message : String(e)}`);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[unhandledRejection] ${reason instanceof Error ? reason.message : String(reason)}`);
});

// load .env from cwd up to workspace root
for (const p of [
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "..", "..", ".env"),
  resolve(__dirname, "..", "..", "..", ".env"),
]) {
  if (existsSync(p)) { loadEnv({ path: p }); break; }
}

interface Args {
  task: string;
  spaceDir?: string;
  agent?: string;
  flow?: string;
  modelAlias: ModelAlias;
  maxCycles?: number;
  baseDir?: string;
  verbose: boolean;
}

function printHelp(): void {
  console.error(`llm-repl — disk-driven space session

Usage:
  llm-repl "<task>" --space <path> [options]

Options:
  --space <path>        REQUIRED. Path to a space directory (with agents/,
                        flows/, functions/, components/, knowledge/, index.ts).
  --agent <slug>        agent slug under <space>/agents/
                        (default: flow's defaultAgent, then first agent)
  --flow <slug>         flow slug under <space>/flows/
                        (default: first flow)
  --model <alias>       LM_MODEL_<ALIAS> — XS|S|M|M_R|L|L_R (default: L)
  --cycles N            override flow's default cycle budget (= step count)
  --base-dir <path>     session storage root (default: /tmp/llm-repl-sessions)
  -v, --verbose         echo each statement as it executes

The agent, the flow steps, the sink declaration, the knowledge tree, and the
auto-discovered function/component signatures all live on disk inside the
space — this binary has no domain-specific code.`);
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const defaults: Args = {
    task: "",
    modelAlias: "L",
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--space": defaults.spaceDir = resolve(argv[++i]!); break;
      case "--agent": defaults.agent = argv[++i]!; break;
      case "--flow": defaults.flow = argv[++i]!; break;
      case "--model": defaults.modelAlias = argv[++i] as ModelAlias; break;
      case "--cycles": defaults.maxCycles = parseInt(argv[++i]!, 10); break;
      case "--base-dir": defaults.baseDir = resolve(argv[++i]!); break;
      case "-v": case "--verbose": defaults.verbose = true; break;
      case "-h": case "--help": printHelp(); process.exit(0);
      default: positional.push(a!);
    }
  }
  if (positional.length === 0) { printHelp(); process.exit(1); }
  if (!defaults.spaceDir) {
    console.error("✗ --space <path> is required");
    process.exit(1);
  }
  defaults.task = positional.join(" ");
  return defaults;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.error(`▸ space: ${args.spaceDir}`);
  console.error(`▸ model: ${args.modelAlias} (${process.env[`LM_MODEL_${args.modelAlias}`] ?? "<unset>"})`);
  if (args.agent) console.error(`▸ agent: ${args.agent}`);
  if (args.flow) console.error(`▸ flow: ${args.flow}`);

  const { manifest, sessionDir, output } = await runSpaceSession({
    spaceDir: args.spaceDir!,
    task: args.task,
    ...(args.agent ? { agent: args.agent } : {}),
    ...(args.flow ? { flow: args.flow } : {}),
    modelAlias: args.modelAlias,
    ...(args.maxCycles !== undefined ? { maxCycles: args.maxCycles } : {}),
    ...(args.baseDir ? { baseDir: args.baseDir } : {}),
    verbose: args.verbose,
  });

  console.error("");
  console.error(`▸ session: ${sessionDir}`);
  console.error(`▸ manifest: ${sessionDir}/session.json`);
  console.error(`▸ trace: ${sessionDir}/trace.jsonl`);
  console.error(`▸ status: ${manifest.finalStatus}  agent=${manifest.options.agent}  flow=${manifest.options.flow}  sink=${manifest.sinkName}`);
  console.error("");

  if (output) {
    console.error("── OUTPUT ──");
    console.log(output);
  } else {
    console.error(`✗ No output was submitted. Final status: ${manifest.finalStatus}${manifest.errorMessage ? " — " + manifest.errorMessage : ""}`);
    process.exit(5);
  }
}

main().catch((e: unknown) => {
  console.error(`✗ ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
