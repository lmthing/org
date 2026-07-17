export interface CliArgs {
  space: string;
  agent?: string;
  message: string;
  model?: string;
  traceFile?: string;
  webPort?: number;
  repl?: boolean;
  claude?: boolean;
  systemSpaces?: string[];
  noSystemSpaces?: boolean;
  /** Overwrite locally-modified system spaces with the shipped versions. */
  adoptSystemSpaces?: boolean;
  maxEpisodes?: number;
  maxToolCalls?: number;
  maxForkDepth?: number;
  maxWallClockMs?: number;
  /** Path to a scripted mock provider module (ESM). When set, the CLI skips
   *  resolveModel/createStream entirely so no API key is required. */
  mock?: string;
  /** Path to write the resolved system prompt to, then exit. Keyless — does not
   *  run the model. Captures exactly the `system` message the model would see. */
  dumpSystemPrompt?: string;
  /** Bypass an agent's `defaultAction` routing so the first turn runs the
   *  model-driven turn loop (follows the freeform message verbatim). */
  noDefaultAction?: boolean;
  /** Multi-session server mode (`lmthing serve --port 8080 …`). One HTTP+WS server
   *  hosting many independent agent sessions. */
  serve?: boolean;
  /** Port for `serve` mode. */
  servePort?: number;
  /** Max concurrent sessions for `serve` mode. */
  maxSessions?: number;
  /** Snapshot output dir for `serve` mode. */
  snapshotsDir?: string;
  /** Path to a .env file to load instead of `<cwd>/.env` (consumed early by loadEnv in bin.ts). */
  envFile?: string;
  /** Working directory to switch into before anything else resolves — the runtime root becomes
   *  `<cwd>/.lmthing` and `<cwd>/.env` is loaded from it. Default: the directory the command was
   *  run from. Consumed early by `applyCwd` in bin.ts (before formal arg parsing). */
  cwd?: string;
  /** Materialize the runtime into `<cwd>/.lmthing` (`lmthing init`). Keyless. */
  init?: boolean;
  /** Active project name for multi-session server mode (default: "user"). */
  project?: string;
  /** Headless single-shot mode: send one request to the THING agent, stream
   *  output to stdout, then exit. `--space` defaults to `process.cwd()`. */
  request?: string;
}

/** Parse a CLI numeric flag value; throws a clear error on a non-number. */
function parseNumericFlag(flag: string, val: string | undefined): number {
  if (val === undefined) throw new Error(`${flag} requires a value`);
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} requires a non-negative number, got "${val}"`);
  return n;
}

export function parseArgs(argv: string[]): CliArgs {
  // argv is process.argv.slice(2)
  const args = [...argv];
  const result: Partial<CliArgs> = {};

  // Leading subcommands: `lmthing serve` / `lmthing init`.
  if (args[0] === 'serve') {
    args.shift();
    result.serve = true;
  } else if (args[0] === 'init') {
    args.shift();
    result.init = true;
  }

  while (args.length > 0) {
    const arg = args.shift()!;

    switch (arg) {
      case '--port': {
        const val = args.shift();
        if (!val || !/^\d+$/.test(val)) throw new Error('--port requires a numeric value');
        result.servePort = parseInt(val, 10);
        break;
      }
      case '--max-sessions': {
        result.maxSessions = parseNumericFlag('--max-sessions', args.shift());
        break;
      }
      case '--snapshots-dir': {
        const val = args.shift();
        if (!val) throw new Error('--snapshots-dir requires a value');
        result.snapshotsDir = val;
        break;
      }
      case '--env-file': {
        const val = args.shift();
        if (!val) throw new Error('--env-file requires a value');
        result.envFile = val;
        break;
      }
      case '--cwd': {
        const val = args.shift();
        if (!val) throw new Error('--cwd requires a value');
        result.cwd = val;
        break;
      }
      case '--project':
      case '-p': {
        const val = args.shift();
        if (!val) throw new Error('--project requires a value');
        result.project = val;
        break;
      }
      case '--space':
      case '-s': {
        const val = args.shift();
        if (!val) throw new Error('--space requires a value');
        result.space = val;
        break;
      }
      case '--agent':
      case '-a': {
        const val = args.shift();
        if (!val) throw new Error('--agent requires a value');
        result.agent = val;
        break;
      }
      case '--model':
      case '-m': {
        const val = args.shift();
        if (!val) throw new Error('--model requires a value');
        result.model = val;
        break;
      }
      case '--trace': {
        const val = args.shift();
        if (!val) throw new Error('--trace requires a value');
        result.traceFile = val;
        break;
      }
      case '--repl':
      case '-r': {
        result.repl = true;
        break;
      }
      case '--claude': {
        result.claude = true;
        break;
      }
      case '--system-spaces': {
        const val = args.shift();
        if (!val) throw new Error('--system-spaces requires a comma-separated list of dirs');
        result.systemSpaces = val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--no-system-spaces': {
        result.noSystemSpaces = true;
        break;
      }
      case '--adopt-system-spaces': {
        result.adoptSystemSpaces = true;
        break;
      }
      case '--no-default-action': {
        result.noDefaultAction = true;
        break;
      }
      case '--max-episodes': {
        result.maxEpisodes = parseNumericFlag('--max-episodes', args.shift());
        break;
      }
      case '--max-tool-calls': {
        result.maxToolCalls = parseNumericFlag('--max-tool-calls', args.shift());
        break;
      }
      case '--max-fork-depth': {
        result.maxForkDepth = parseNumericFlag('--max-fork-depth', args.shift());
        break;
      }
      case '--max-wallclock-ms': {
        result.maxWallClockMs = parseNumericFlag('--max-wallclock-ms', args.shift());
        break;
      }
      case '--mock': {
        const val = args.shift();
        if (!val) throw new Error('--mock requires a path to a mock module');
        result.mock = val;
        break;
      }
      case '--request': {
        const val = args.shift();
        if (!val) throw new Error('--request requires a message value');
        result.request = val;
        break;
      }
      case '--dump-system-prompt': {
        const val = args.shift();
        if (!val) throw new Error('--dump-system-prompt requires an output file path');
        result.dumpSystemPrompt = val;
        break;
      }
      case '--web': {
        // Optional port argument: --web [port]  (defaults to 3000)
        const next = args[0];
        if (next && /^\d+$/.test(next)) {
          args.shift();
          result.webPort = parseInt(next, 10);
        } else {
          result.webPort = 3000;
        }
        break;
      }
      default: {
        // Treat as the message (last positional argument)
        if (!arg.startsWith('-')) {
          result.message = arg;
        } else {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
      }
    }
  }

  // init: keyless subcommand — no space or message required.
  if (result.init) {
    return result as CliArgs;
  }

  // Serve mode: --space is optional (it becomes the default spaceDir), and no
  // message is required (sessions are created via POST /api/sessions).
  if (result.serve) {
    return result as CliArgs;
  }

  // Bare invocation (no positional message, no --space, none of the interactive
  // or single-run flags set): treat as the default "launch server" path. The
  // bin.ts entry-point handles it; no validation needed here.
  // --request: headless single-shot mode — space and message both optional.
  if (result.request) {
    return result as CliArgs;
  }

  const isBareDefault =
    !result.space &&
    !result.message &&
    !result.repl &&
    !result.webPort &&
    !result.dumpSystemPrompt &&
    !result.mock;
  if (isBareDefault) {
    return result as CliArgs;
  }

  if (!result.space) {
    throw new Error('--space <dir> is required');
  }
  // message is only required in terminal (non-interactive, non-web) mode
  if (!result.webPort && !result.repl && !result.dumpSystemPrompt && !result.message) {
    throw new Error('A message argument is required (or use --web for browser mode, --repl for interactive mode)');
  }

  return result as CliArgs;
}
