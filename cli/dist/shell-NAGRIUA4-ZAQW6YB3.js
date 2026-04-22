// ../repl/dist/shell-NAGRIUA4.js
import { execFile, spawn } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var shellCwd = process.cwd();
function setShellCwd(dir) {
  shellCwd = dir;
}
var shellModule = {
  id: "shell",
  description: "Shell command execution",
  functions: [
    {
      name: "exec",
      description: "Run shell command",
      signature: "(command: string, options?: { cwd?: string, timeout?: number }) => Promise<{ stdout: string, stderr: string, exitCode: number }>",
      fn: async (command, options) => {
        const opts = options;
        const args = command.split(" ");
        const cmd = args[0];
        const cmdArgs = args.slice(1);
        try {
          const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
            cwd: opts?.cwd ?? shellCwd,
            timeout: opts?.timeout ?? 3e4
          });
          return { stdout, stderr, exitCode: 0 };
        } catch (err) {
          return {
            stdout: err.stdout ?? "",
            stderr: err.stderr ?? err.message,
            exitCode: err.code ?? 1
          };
        }
      }
    },
    {
      name: "execLive",
      description: "Streaming command output",
      signature: "(command: string, options?: { cwd?: string, timeout?: number }) => AsyncIterable<{ stream: 'stdout' | 'stderr', data: string }>",
      fn: (command, options) => {
        const opts = options;
        const args = command.split(" ");
        const cmd = args[0];
        const cmdArgs = args.slice(1);
        return {
          async *[Symbol.asyncIterator]() {
            const child = spawn(cmd, cmdArgs, {
              cwd: opts?.cwd ?? shellCwd,
              timeout: opts?.timeout ?? 3e4
            });
            const chunks = [];
            let resolve = null;
            let done = false;
            child.stdout?.on("data", (data) => {
              chunks.push({ stream: "stdout", data: data.toString() });
              resolve?.();
            });
            child.stderr?.on("data", (data) => {
              chunks.push({ stream: "stderr", data: data.toString() });
              resolve?.();
            });
            child.on("close", () => {
              done = true;
              resolve?.();
            });
            child.on("error", () => {
              done = true;
              resolve?.();
            });
            while (!done || chunks.length > 0) {
              if (chunks.length === 0 && !done) {
                await new Promise((r) => {
                  resolve = r;
                });
              }
              while (chunks.length > 0) yield chunks.shift();
            }
          }
        };
      }
    },
    {
      name: "which",
      description: "Find binary in PATH",
      signature: "(binary: string) => Promise<string | null>",
      fn: async (binary) => {
        try {
          const { stdout } = await execFileAsync("which", [binary]);
          return stdout.trim() || null;
        } catch {
          return null;
        }
      }
    }
  ]
};
var shell_default = shellModule;
export {
  shell_default as default,
  setShellCwd
};
