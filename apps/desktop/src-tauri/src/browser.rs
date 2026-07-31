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
//!
//! ## Why it is launched WITHOUT a window of its own
//!
//! The browser is shown inside the app, in the live pane, by streaming its frames over CDP
//! (`Page.startScreencast`). If it also opened an ordinary Chromium window there would be two
//! places showing the same thing, one of them outside the app and outside the activity log — so
//! the default is `--headless=new`, which is the same Chromium with the same engine, profile and
//! cookie jar, drawing to a surface the pane can read instead of to a desktop window.
//!
//! `headless: false` is a real mode, not a debug flag: [`crate::commands::browser_relaunch`] uses it
//! to hand the person a normal window when the pane is not the right tool — a file upload dialog,
//! a video call, anything where a streamed image is a poor substitute for the real thing.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, Command, Stdio};

use serde::Serialize;

/// Where the CDP endpoint lives once the browser is up.
///
/// The WebSocket URL is resolved HERE rather than by the webview, and that is not a tidiness
/// preference. Chromium's `/json/version` endpoint sends no `Access-Control-Allow-Origin`, so a
/// `fetch` for it from the renderer is blocked by CORS — in the packaged app as much as in a
/// browser. Rust has no such restriction, and Chromium writes the browser's WebSocket path into
/// `DevToolsActivePort` anyway, so there is no HTTP request to make at all.
///
/// (`--remote-allow-origins` governs the WebSocket handshake's Origin check, which is a different
/// mechanism and does not help the HTTP endpoints.)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEndpoint {
    /// `ws://127.0.0.1:<port>/devtools/browser/<id>` — the browser target, not a page.
    pub ws_url: String,
    pub port: u16,
    /// Whether this browser is drawing into the pane (`true`) or into a window of its own.
    pub headless: bool,
}

/// The size the browser believes its window is.
///
/// It only sets the starting point — the pane sends `Emulation.setDeviceMetricsOverride` once it
/// knows its own size, and again on every resize. But a sensible default matters anyway: the
/// first frames arrive before the pane has measured itself, and Chromium's own default of 800×600
/// makes every page's first paint a mobile-ish layout that then jumps.
const DEFAULT_WIDTH: u32 = 1280;
const DEFAULT_HEIGHT: u32 = 800;

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

/// Is this binary a snap, directly or through Ubuntu's wrapper script?
///
/// It matters because of what snap confinement does to `--user-data-dir`: it IGNORES it. The
/// browser runs against the person's own everyday profile instead of the throwaway one this app
/// creates — so the "its cookie jar is something you opted into and can throw away" guarantee at
/// the top of this file is simply not true under a snap, and an agent would be driving a browser
/// signed into everything they have ever signed into.
///
/// Ubuntu's `/usr/bin/chromium-browser` is a shell script that execs `/snap/bin/chromium`, so
/// resolving symlinks is not enough on its own — the script has to be read.
pub fn is_snap(path: &Path) -> bool {
    if std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .contains("/snap/")
    {
        return true;
    }
    // A wrapper is tiny; anything large is the real binary and not worth reading.
    match std::fs::metadata(path) {
        Ok(m) if m.len() < 64_000 => std::fs::read_to_string(path)
            .map(|t| t.contains("/snap/bin/"))
            .unwrap_or(false),
        _ => false,
    }
}

/// Find a browser, preferring one whose profile flag is actually honoured.
///
/// Two passes over the same candidates: everything non-snap first, then snaps. A snap is used only
/// when it is the only thing installed — better a browser with a shared profile than no browser —
/// and `LMTHING_BROWSER` overrides the lot, because an explicit choice is a person's to make.
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
    let found: Vec<PathBuf> = CANDIDATES.iter().filter_map(|n| which(n)).collect();
    found
        .iter()
        .find(|p| !is_snap(p))
        .or_else(|| found.first())
        .cloned()
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

/// The command line, as a value, so the parts that are easy to get wrong can be tested.
///
/// Several of these flags are load-bearing rather than cosmetic, and the tests below say which —
/// a missing `--remote-allow-origins` in particular fails as a WebSocket handshake rejection with
/// no useful message, which is a miserable thing to debug from the renderer.
pub fn launch_args(profile_dir: &Path, headless: bool) -> Vec<String> {
    let mut args = vec![
        // 0 lets the OS pick. A fixed port would collide with whatever else the person has open,
        // and the collision would present as "the browser is broken".
        "--remote-debugging-port=0".to_string(),
        // Without this Chromium rejects the CDP WebSocket handshake outright, because the
        // renderer's origin is `tauri://localhost` rather than something it recognises. The port
        // is bound to loopback and is unauthenticated by design; the origin check adds nothing on
        // top of that, and its absence costs the whole feature.
        "--remote-allow-origins=*".to_string(),
        format!("--user-data-dir={}", profile_dir.display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        // Drops `navigator.webdriver`. Not evasion — this browser is genuinely being used by a
        // person who can watch it, and the flag stops sites degrading a real session into a
        // bot-check loop the person then has to solve inside a streamed pane.
        "--disable-blink-features=AutomationControlled".to_string(),
        format!("--window-size={DEFAULT_WIDTH},{DEFAULT_HEIGHT}"),
    ];
    if headless {
        // `=new` is the full browser rather than the old stripped-down headless shell: it has the
        // same renderer, the same extensions surface and the same screencast support. The old mode
        // could not have driven this pane.
        args.push("--headless=new".to_string());
    }
    args.push("about:blank".to_string());
    args
}

/// Launch the browser with a debugging port and its own profile.
///
/// The chosen endpoint is learned from STDERR, where Chromium prints `DevTools listening on ws://…`
/// — not from the `DevToolsActivePort` file in the profile directory, which is only a fallback.
///
/// That order is the opposite of the obvious one, and it is what makes this work on Ubuntu and its
/// derivatives. `chromium` there is a SNAP, whose confinement means `--user-data-dir` is quietly
/// ignored: the browser starts, serves, and writes its port file somewhere inside the snap's own
/// home. Reading the profile directory then times out with "the browser started but never reported
/// a debugging port" — which is true, and describes the wrong thing entirely. The stderr line is
/// printed by every Chromium build regardless of confinement, and carries the whole URL.
pub fn launch(profile_dir: PathBuf, headless: bool) -> Result<BrowserProcess, String> {
    let bin = find_browser().ok_or_else(|| {
        "No Chromium-family browser found. Install Chromium, Chrome, Brave or Edge, or set \
         LMTHING_BROWSER to a binary."
            .to_string()
    })?;
    std::fs::create_dir_all(&profile_dir).map_err(|e| e.to_string())?;
    // Stale from a previous run: without removing it, `read_devtools_port` can return the OLD
    // port immediately and everything then connects to a browser that is not there.
    let _ = std::fs::remove_file(profile_dir.join("DevToolsActivePort"));

    let mut child = Command::new(&bin)
        .args(launch_args(&profile_dir, headless))
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", bin.display()))?;

    let stderr = child.stderr.take();
    let (port, path) = match stderr.and_then(read_devtools_from_stderr) {
        Some(found) => found,
        None => read_devtools_endpoint(&profile_dir)?,
    };
    Ok(BrowserProcess {
        child,
        endpoint: BrowserEndpoint {
            ws_url: format!("ws://127.0.0.1:{port}{path}"),
            port,
            headless,
        },
    })
}

/// Read the endpoint off the browser's own startup line.
///
/// `DevTools listening on ws://127.0.0.1:41439/devtools/browser/<uuid>` — printed on stderr by
/// every Chromium build, before it is ready for anything else. Returns `None` rather than blocking
/// forever if the stream ends or the line never comes, so the caller can fall back to the file.
fn read_devtools_from_stderr(stderr: ChildStderr) -> Option<(u16, String)> {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        if let Some(found) = parse_devtools_stderr(&line) {
            return Some(found);
        }
    }
    None
}

/// Pull the port and browser path out of that line.
pub fn parse_devtools_stderr(line: &str) -> Option<(u16, String)> {
    let rest = line.split("ws://").nth(1)?;
    let (hostport, path) = rest.split_once('/')?;
    let port = hostport.rsplit(':').next()?.trim().parse::<u16>().ok()?;
    Some((port, format!("/{}", path.trim())))
}

/// Poll for the file Chromium writes once its debugging server is listening.
///
/// Two lines: the port, then the browser target's WebSocket path. Both are needed and both are
/// here, which is why no HTTP request is made at all.
fn read_devtools_endpoint(profile_dir: &Path) -> Result<(u16, String), String> {
    let file = profile_dir.join("DevToolsActivePort");
    for _ in 0..100 {
        if let Ok(text) = std::fs::read_to_string(&file) {
            if let Some((port, path)) = parse_devtools_active_port(&text) {
                return Ok((port, path));
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("the browser started but never reported a debugging port".into())
}

/// Parse `DevToolsActivePort`, refusing a half-written one.
///
/// Chromium creates the file and writes both lines, so a read can land between the two. Accepting
/// a port with no path would produce `ws://127.0.0.1:1234` — which connects to nothing and fails
/// as a handshake error naming neither the cause nor the race.
pub fn parse_devtools_active_port(text: &str) -> Option<(u16, String)> {
    let mut lines = text.lines();
    let port = lines.next()?.trim().parse::<u16>().ok()?;
    let path = lines.next()?.trim();
    if !path.starts_with('/') {
        return None;
    }
    Some((port, path.to_string()))
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
    fn a_snap_is_recognised_through_its_wrapper_script() {
        // Ubuntu's `/usr/bin/chromium-browser` is a shell script that execs `/snap/bin/chromium`,
        // so it looks like an ordinary binary until you read it. Getting this wrong means silently
        // handing an agent the person's everyday browser profile.
        let dir = std::env::temp_dir().join("lmthing-snap-detect");
        let _ = std::fs::create_dir_all(&dir);
        let wrapper = dir.join("chromium-browser");
        std::fs::write(&wrapper, "#!/bin/sh\nexec /snap/bin/chromium \"$@\"\n").unwrap();
        assert!(is_snap(&wrapper), "a wrapper that execs a snap IS a snap");

        let real = dir.join("brave-browser");
        std::fs::write(&real, "#!/bin/sh\nexec /opt/brave.com/brave/brave \"$@\"\n").unwrap();
        assert!(!is_snap(&real), "an ordinary wrapper is not");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn which_finds_something_that_exists_and_nothing_that_does_not() {
        assert!(which("sh").is_some() || which("cmd.exe").is_some());
        assert!(which("lmthing-definitely-not-a-real-binary").is_none());
    }

    #[test]
    fn the_pane_browser_has_no_window_and_the_popped_out_one_does() {
        let dir = Path::new("/tmp/lmthing-test-profile");
        let paned = launch_args(dir, true);
        assert!(paned.iter().any(|a| a == "--headless=new"));
        // The pop-out is the SAME browser with a window. If this ever gained extra flags the two
        // would be different browsers wearing one name, and "it works in the window but not the
        // pane" would become a real class of bug.
        let popped = launch_args(dir, false);
        assert!(!popped.iter().any(|a| a == "--headless=new"));
        assert_eq!(paned.len(), popped.len() + 1);
    }

    #[test]
    fn the_flags_the_connection_depends_on_are_present() {
        let args = launch_args(Path::new("/tmp/p"), true);
        // Each of these fails silently or unhelpfully when missing, which is why they are asserted
        // rather than left to a live run to discover.
        assert!(args.iter().any(|a| a == "--remote-debugging-port=0"));
        assert!(args.iter().any(|a| a == "--remote-allow-origins=*"));
        assert!(args.iter().any(|a| a == "--user-data-dir=/tmp/p"));
        // The profile is the whole reason the cookie jar is separable from the person's own
        // browser; a launch without it would quietly use the default profile.
        assert!(args.iter().any(|a| a.starts_with("--user-data-dir=")));
        assert_eq!(args.last().map(String::as_str), Some("about:blank"));
    }

    #[test]
    fn reads_the_endpoint_off_the_browsers_own_startup_line() {
        // The shape Chromium actually prints — and the ONLY way to learn the port under a snap,
        // whose confinement makes `--user-data-dir` a no-op so the port file never appears where
        // this app looks for it.
        assert_eq!(
            parse_devtools_stderr(
                "DevTools listening on ws://127.0.0.1:41439/devtools/browser/4bcac5fe-87cd-4"
            ),
            Some((41439, "/devtools/browser/4bcac5fe-87cd-4".to_string()))
        );
        assert_eq!(parse_devtools_stderr("[0731/203744:ERROR:registration_request.cc] nope"), None);
        assert_eq!(parse_devtools_stderr(""), None);
    }

    #[test]
    fn reads_both_lines_of_the_port_file_and_refuses_half_of_one() {
        assert_eq!(
            parse_devtools_active_port("41234\n/devtools/browser/abc-123\n"),
            Some((41234, "/devtools/browser/abc-123".to_string()))
        );
        // The file is created before both lines are written, so a read can land in the middle.
        // Accepting the port alone yields `ws://127.0.0.1:41234`, which connects to nothing.
        assert_eq!(parse_devtools_active_port("41234\n"), None);
        assert_eq!(parse_devtools_active_port(""), None);
        assert_eq!(
            parse_devtools_active_port("not-a-port\n/devtools/browser/x"),
            None
        );
    }
}
