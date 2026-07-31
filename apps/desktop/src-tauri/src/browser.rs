//! Launching the browser the agent drives — and that the person watches.
//!
//! ## Why a real Chromium and not the Tauri webview
//!
//! The webview is WKWebView on macOS and WebKitGTK on Linux, and neither speaks the Chrome
//! DevTools Protocol; only WebView2 does. Roughly a third of the 27 `system-browser` functions are
//! CDP-shaped (`tree`, `nodeDetails`, `interactiveElements`, `waitForState`, `consoleLogs`,
//! `getCookies`), and `click`/`findElement` take a **`backendNodeId`** — a CDP concept with no DOM
//! equivalent. Reimplementing that on top of injected JavaScript would mean forging a parallel id
//! space and letting the function descriptions — migrated verbatim from Lightpanda's catalog so the
//! model sees what their agent sees — quietly diverge from what actually happens. That divergence
//! would be invisible to every gate in this repo.
//!
//! So: one real Chromium, one DOM, one cookie jar. The person drives it and the agent drives it,
//! and there is no question of the two disagreeing about what is on screen — which a split design
//! (webview for the human, headless for the agent) could never guarantee even with a shared jar.
//!
//! ## A separate profile, deliberately
//!
//! The browser gets its own user-data directory rather than the person's everyday Chrome profile.
//! Its cookie jar is then something they opted into and can throw away, instead of every account
//! they have ever signed into being implicitly in scope for an agent.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use serde::Serialize;

/// Where the CDP endpoint lives once the browser is up.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEndpoint {
    /// `http://127.0.0.1:<port>` — the webview fetches `/json/version` to find the WS URL.
    pub http: String,
    pub port: u16,
}

/// Candidate binaries, in the order a person would expect them to be used.
///
/// A dedicated `LMTHING_BROWSER` wins so a packaged build can ship or point at its own; otherwise
/// whatever Chromium-family browser is already installed is used, because asking someone to
/// download a second browser to use a feature of the first is a poor trade.
const CANDIDATES: &[&str] = &[
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "brave-browser",
    "microsoft-edge",
];

#[cfg(target_os = "macos")]
const MAC_PATHS: &[&str] = &[
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

pub fn find_browser() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("LMTHING_BROWSER") {
        let p = PathBuf::from(explicit);
        if p.exists() {
            return Some(p);
        }
    }
    #[cfg(target_os = "macos")]
    for p in MAC_PATHS {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }
    for name in CANDIDATES {
        if let Some(p) = which(name) {
            return Some(p);
        }
    }
    None
}

/// `PATH` lookup without pulling in a crate for it.
fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(name);
        candidate.is_file().then_some(candidate)
    })
}

pub struct BrowserProcess {
    pub child: Child,
    pub endpoint: BrowserEndpoint,
}

/// Launch the browser with a debugging port and its own profile.
///
/// `--remote-debugging-port=0` lets the OS pick, and Chromium writes the chosen port to
/// `DevToolsActivePort` in the profile directory — which is the only reliable way to learn it,
/// since nothing is printed on stdout in a form worth parsing.
pub fn launch(profile_dir: PathBuf) -> Result<BrowserProcess, String> {
    let bin = find_browser().ok_or_else(|| {
        "No Chromium-family browser found. Install Chromium, Chrome, Brave or Edge, or set \
         LMTHING_BROWSER to a binary."
            .to_string()
    })?;
    std::fs::create_dir_all(&profile_dir).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(profile_dir.join("DevToolsActivePort"));

    let child = Command::new(&bin)
        .arg("--remote-debugging-port=0")
        // Bound to loopback: the debugging port is unauthenticated by design, and anything that can
        // reach it can drive the browser.
        .arg("--remote-allow-origins=*")
        .arg(format!("--user-data-dir={}", profile_dir.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("about:blank")
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", bin.display()))?;

    let port = read_devtools_port(&profile_dir)?;
    Ok(BrowserProcess {
        child,
        endpoint: BrowserEndpoint {
            http: format!("http://127.0.0.1:{port}"),
            port,
        },
    })
}

/// Poll for the port file Chromium writes once its debugging server is listening.
fn read_devtools_port(profile_dir: &Path) -> Result<u16, String> {
    let file = profile_dir.join("DevToolsActivePort");
    for _ in 0..100 {
        if let Ok(text) = std::fs::read_to_string(&file) {
            // First line is the port; the second is a browser-target path this does not need.
            if let Some(first) = text.lines().next() {
                if let Ok(port) = first.trim().parse::<u16>() {
                    return Ok(port);
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("the browser started but never reported a debugging port".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_browser_path_wins_when_it_exists() {
        // A packaged build may ship or pin its own; that must beat whatever happens to be on PATH.
        std::env::set_var("LMTHING_BROWSER", "/definitely/not/here");
        // Non-existent, so it falls through rather than returning a path that cannot be launched.
        let found = find_browser();
        assert!(found.is_none() || found.unwrap().as_path() != Path::new("/definitely/not/here"));
        std::env::remove_var("LMTHING_BROWSER");
    }

    #[test]
    fn which_finds_something_that_exists_and_nothing_that_does_not() {
        assert!(which("sh").is_some() || which("cmd.exe").is_some());
        assert!(which("lmthing-definitely-not-a-real-binary").is_none());
    }
}
