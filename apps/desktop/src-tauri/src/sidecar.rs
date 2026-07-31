//! Local mode — `lmthing serve` running on this machine instead of in the cloud.
//!
//! ## What it buys, and what it costs
//!
//! Buys: no cold wake (the 120s `waitForPodEdge` budget disappears), filesystem and browser
//! operations become in-process instead of a WAN round trip each, it works offline, and project
//! data never leaves the machine.
//!
//! Costs: no team pods (channels are inherently server-side), no push, no cross-device continuity,
//! and the person owns their own model keys and budget accounting. So it is a MODE, not a
//! replacement — and the same binary serves both, which is the point.
//!
//! ## Why this is a plain JavaScript sidecar
//!
//! Because `libs/cli` no longer has a native dependency. `better-sqlite3` was replaced by Node's
//! own `node:sqlite` (one file — `libs/cli/src/app/store.ts`), and `node-pty` is already a lazy
//! import that the chat/team/dashboard surfaces never reach. That collapses packaging from
//! "six platform × arch native rebuilds" to "copy a binary", and it is the single change that makes
//! this phase tractable at all.
//!
//! ## Where the binary comes from — and why it is not declared yet
//!
//! `bundle.externalBin` is deliberately ABSENT from `tauri.conf.json`. Tauri's build script
//! resolves external binaries at COMPILE time and fails the whole build when one is missing, so
//! declaring a sidecar that nothing produces does not "prepare for" packaging — it breaks
//! `cargo test`, `cargo build` and `tauri dev` for everyone, immediately and confusingly.
//!
//! The release pipeline that builds `lmthing serve` per platform must add
//! `"externalBin": ["binaries/lmthing-serve"]` back to the bundle config at the same time as it
//! stages `src-tauri/binaries/lmthing-serve-<target-triple>`. Until then, local mode runs from
//! `LMTHING_SIDECAR`, which is what a developer has anyway.
//!
//! This module only finds the binary, starts it, and reports the port.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPod {
    /// `http://127.0.0.1:<port>` — what the bridge's `apiBase` becomes in local mode.
    pub base: String,
    pub port: u16,
}

pub struct LocalPodProcess {
    pub child: Child,
    pub pod: LocalPod,
}

/// How long to wait for the sidecar to announce its port before giving up.
const READY_TIMEOUT_SECS: u64 = 30;

/// Find the bundled `lmthing serve` sidecar.
///
/// `LMTHING_SIDECAR` first so a developer can point at a checkout's `node libs/cli/dist/cli/bin.js`
/// without a packaged build; otherwise the binary Tauri placed beside the executable.
fn find_sidecar() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("LMTHING_SIDECAR") {
        let p = PathBuf::from(explicit);
        if p.exists() {
            return Some(p);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["lmthing-serve", "lmthing-serve.exe"] {
        let candidate = dir.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Start the local pod and wait until it reports a port.
///
/// Port 0 lets the OS choose, and the sidecar prints the chosen one — which matters because a fixed
/// port would collide with whatever else the person is running, and a collision would present as
/// "the app is broken" rather than "something else is on 8080".
pub fn start(workspace: PathBuf) -> Result<LocalPodProcess, String> {
    let bin = find_sidecar().ok_or_else(|| {
        "This build has no local-mode sidecar. Install a packaged build, or set LMTHING_SIDECAR to \
         a `lmthing` binary."
            .to_string()
    })?;
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

    let mut child = Command::new(&bin)
        .arg("serve")
        .arg("--port")
        .arg("0")
        .arg("--cwd")
        .arg(&workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the local workspace: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("the sidecar produced no output")?;
    let port = read_port(stdout)?;
    Ok(LocalPodProcess {
        child,
        pod: LocalPod {
            base: format!("http://127.0.0.1:{port}"),
            port,
        },
    })
}

/// Read the port out of the server's own startup line.
///
/// Parsed from stdout rather than probed, because probing cannot distinguish "not up yet" from
/// "up on a port we guessed wrong".
fn read_port(stdout: impl std::io::Read) -> Result<u16, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(READY_TIMEOUT_SECS);
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        if std::time::Instant::now() > deadline {
            break;
        }
        let Ok(line) = line else { break };
        if let Some(port) = parse_port(&line) {
            return Ok(port);
        }
    }
    Err("the local workspace started but never reported a port".into())
}

/// Pull a port out of a line like `listening on http://localhost:41234`.
///
/// Deliberately loose about the surrounding words and strict about the shape: the CLI's startup
/// banner is not a contract, and a parser that depended on its exact wording would break the next
/// time somebody improved the message.
pub fn parse_port(line: &str) -> Option<u16> {
    let idx = line
        .find("127.0.0.1:")
        .or_else(|| line.find("localhost:"))?;
    let rest = &line[idx..];
    let after_colon = &rest[rest.find(':')? + 1..];
    let digits: String = after_colon
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_port_in_the_shapes_the_cli_actually_prints() {
        assert_eq!(
            parse_port("[serve] listening on http://localhost:41234"),
            Some(41234)
        );
        assert_eq!(
            parse_port("listening on http://127.0.0.1:8080/"),
            Some(8080)
        );
        assert_eq!(
            parse_port("  ready → http://127.0.0.1:3000 (press ctrl-c)"),
            Some(3000)
        );
    }

    #[test]
    fn ignores_a_line_with_no_port() {
        assert_eq!(parse_port("[serve] booting"), None);
        assert_eq!(parse_port(""), None);
        // A host with no port must not be read as one — guessing here would connect the whole app
        // to nothing and report it as a network failure.
        assert_eq!(parse_port("http://localhost/"), None);
    }
}
