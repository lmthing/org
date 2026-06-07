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
  maxEpisodes?: number;
  maxToolCalls?: number;
  maxForkDepth?: number;
  maxWallClockMs?: number;
  /** Path to a scripted mock provider module (ESM). When set, the CLI skips
   *  resolveModel/createStream entirely so no API key is required. */
  mock?: string;
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

  while (args.length > 0) {
    const arg = args.shift()!;

    switch (arg) {
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

  if (!result.space) {
    throw new Error('--space <dir> is required');
  }
  // message is only required in terminal (non-interactive, non-web) mode
  if (!result.webPort && !result.repl && !result.message) {
    throw new Error('A message argument is required (or use --web for browser mode, --repl for interactive mode)');
  }

  return result as CliArgs;
}
