export interface CliArgs {
  space: string;
  agent?: string;
  message: string;
  model?: string;
  traceFile?: string;
  webPort?: number;
  repl?: boolean;
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
