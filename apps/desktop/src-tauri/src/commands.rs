//! What the webview may ask the host to do.
//!
//! The bridge's WebSocket lives in the WEBVIEW rather than here, and that is a deliberate choice
//! with two consequences worth stating:
//!
//! - **Less Rust.** A socket, a JWT and a reconnect loop are trivial in the renderer and would be
//!   an async runtime, a TLS stack and a token-plumbing problem in Rust. The security boundary is
//!   not the socket — it is [`crate::grants`] — so nothing is gained by moving the transport down.
//! - **The bridge is visible.** It runs only while the window is open, which is the honest
//!   behaviour: a person should be able to see that their machine is reachable, and closing the
//!   app should end that. A background daemon would be strictly harder to reason about.
//!
//! Every command below routes through `Grants::resolve` before touching the disk.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::browser::{self, BrowserEndpoint};
use crate::fsops;
use crate::grants::{Grant, Grants, Mode};
use crate::sidecar::{self, LocalPod};

/// The persisted form. The absolute path lives HERE and is never sent over the bridge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredGrant {
    pub id: String,
    pub path: String,
    pub label: String,
    /// "ro" | "rw"
    pub mode: String,
}

/// What the agent is allowed to learn about a grant: an opaque id, a label, and a mode.
///
/// Deliberately no path. An agent that never learns `/home/someone/...` cannot leak the directory
/// layout, and it has no use for one — every request is `rootId` + a relative path.
#[derive(Debug, Clone, Serialize)]
pub struct PublicGrant {
    pub id: String,
    pub label: String,
    pub mode: String,
}

#[derive(Default)]
pub struct GrantState(pub Mutex<Vec<StoredGrant>>);

/// The launched browser, if any. Held so it can be killed with the app rather than outliving it —
/// a browser the person did not open and cannot see is exactly the wrong thing to leave behind.
#[derive(Default)]
pub struct BrowserState(pub Mutex<Option<browser::BrowserProcess>>);

/// Its OWN profile directory, never the person's everyday one: the cookie jar an agent can reach
/// should be something they opted into and can throw away. Stable across relaunches, so popping
/// out to a window and coming back keeps every session the person signed into.
fn browser_profile_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-browser"))
}

/// Start the browser (or return the running one's endpoint).
///
/// Explicit, like connecting the bridge: a browser signed into somebody's accounts, reachable by a
/// cloud agent, must not appear because an app was launched.
#[tauri::command]
pub fn browser_start(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<BrowserEndpoint, String> {
    let mut slot = state.0.lock().map_err(|_| "browser state is poisoned")?;
    if let Some(p) = slot.as_ref() {
        return Ok(p.endpoint.clone());
    }
    let proc = browser::launch(browser_profile_dir(&app)?, true)?;
    let endpoint = proc.endpoint.clone();
    *slot = Some(proc);
    Ok(endpoint)
}

/// Move the browser between the pane and a window of its own.
///
/// A relaunch rather than a mode switch, because Chromium has no way to grow a window at runtime.
/// The profile is the same directory, so cookies, logins and history survive — what is lost is the
/// open tabs, which is why the caller passes the current URL back in.
///
/// This exists because a streamed pane is genuinely the wrong tool for some things: an OS file
/// picker, a camera prompt, a video call. Refusing to admit that would leave the person stuck.
///
/// Restoring the page is the RENDERER's job — it owns the CDP connection, and a second client
/// opened here just to send one `Page.navigate` would give two parties a claim on which target is
/// current.
#[tauri::command]
pub fn browser_relaunch(
    app: AppHandle,
    state: State<'_, BrowserState>,
    headless: bool,
) -> Result<BrowserEndpoint, String> {
    let mut slot = state.0.lock().map_err(|_| "browser state is poisoned")?;
    if let Some(mut p) = slot.take() {
        let _ = p.child.kill();
        // Chromium holds a lock on the profile directory; starting the replacement before the old
        // process has actually gone yields "profile is already in use" and a browser that never
        // reports a port.
        let _ = p.child.wait();
    }
    let proc = browser::launch(browser_profile_dir(&app)?, headless)?;
    let endpoint = proc.endpoint.clone();
    *slot = Some(proc);
    Ok(endpoint)
}

#[tauri::command]
pub fn browser_stop(state: State<'_, BrowserState>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|_| "browser state is poisoned")?;
    if let Some(mut p) = slot.take() {
        let _ = p.child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn browser_status(state: State<'_, BrowserState>) -> Option<BrowserEndpoint> {
    state
        .0
        .lock()
        .ok()
        .and_then(|s| s.as_ref().map(|p| p.endpoint.clone()))
}

/// The running local pod, if any.
#[derive(Default)]
pub struct SidecarState(pub Mutex<Option<sidecar::LocalPodProcess>>);

fn mode_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("local-mode"))
}

/// The persisted local-mode base, read at window creation.
pub fn persisted_local_base(app: &AppHandle) -> Option<String> {
    let p = mode_file(app)?;
    let text = std::fs::read_to_string(p).ok()?;
    let trimmed = text.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Start the bundled `lmthing serve` and remember that this is how the app should come back.
///
/// The caller reloads the window afterwards: the bridge is injected before any page script and read
/// synchronously during module init, so there is no way to repoint a LIVE page at a different pod.
/// Restarting is also the honest behaviour — every socket and cached session belongs to the pod
/// being left behind.
#[tauri::command]
pub fn local_mode_enable(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<LocalPod, String> {
    let mut slot = state.0.lock().map_err(|_| "sidecar state is poisoned")?;
    if let Some(p) = slot.as_ref() {
        return Ok(p.pod.clone());
    }
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("workspace");
    let proc = sidecar::start(workspace)?;
    let pod = proc.pod.clone();
    if let Some(f) = mode_file(&app) {
        let _ = std::fs::write(f, &pod.base);
    }
    *slot = Some(proc);
    Ok(pod)
}

#[tauri::command]
pub fn local_mode_disable(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|_| "sidecar state is poisoned")?;
    if let Some(mut p) = slot.take() {
        let _ = p.child.kill();
    }
    if let Some(f) = mode_file(&app) {
        let _ = std::fs::remove_file(f);
    }
    Ok(())
}

#[tauri::command]
pub fn local_mode_status(state: State<'_, SidecarState>) -> Option<LocalPod> {
    state
        .0
        .lock()
        .ok()
        .and_then(|s| s.as_ref().map(|p| p.pod.clone()))
}

fn store_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("grants.json"))
}

pub fn load_grants(app: &AppHandle) -> Vec<StoredGrant> {
    let Some(p) = store_path(app) else {
        return vec![];
    };
    let Ok(text) = std::fs::read_to_string(p) else {
        return vec![];
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_grants(app: &AppHandle, list: &[StoredGrant]) {
    if let Some(p) = store_path(app) {
        if let Ok(text) = serde_json::to_string_pretty(list) {
            let _ = std::fs::write(p, text);
        }
    }
}

/// Build the runtime jail from the stored list.
///
/// Canonicalisation happens here, once per operation batch, and a grant whose folder has since
/// been deleted or moved is DROPPED rather than passed through uncanonicalised — a comparison
/// target that does not exist cannot contain anything, and admitting it would defeat the check in
/// `resolve`.
fn to_grants(list: &[StoredGrant]) -> Grants {
    Grants::new(
        list.iter()
            .filter_map(|g| {
                let path = std::fs::canonicalize(&g.path).ok()?;
                Some(Grant {
                    id: g.id.clone(),
                    path,
                    mode: if g.mode == "rw" { Mode::Rw } else { Mode::Ro },
                })
            })
            .collect(),
    )
}

#[tauri::command]
pub fn grant_list(state: State<'_, GrantState>) -> Vec<PublicGrant> {
    state
        .0
        .lock()
        .map(|l| {
            l.iter()
                .map(|g| PublicGrant {
                    id: g.id.clone(),
                    label: g.label.clone(),
                    mode: g.mode.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Everything the SETTINGS UI needs, including the path — which the person chose and is entitled
/// to see. Separate from `grant_list` so the path cannot reach the bridge by accident.
#[tauri::command]
pub fn grant_list_detailed(state: State<'_, GrantState>) -> Vec<StoredGrant> {
    state.0.lock().map(|l| l.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn grant_add(
    app: AppHandle,
    state: State<'_, GrantState>,
    path: String,
    label: String,
    mode: String,
) -> Result<Vec<PublicGrant>, String> {
    // Canonicalise before storing: the person picked a real folder, and resolving it now means the
    // stored value cannot be a symlink that is re-pointed later.
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("could not open that folder: {e}"))?;
    if !canonical.is_dir() {
        return Err("a grant must be a folder".into());
    }
    let mut list = state.0.lock().map_err(|_| "grant store is poisoned")?;
    // Same folder twice is a no-op rather than an error — the person clicked "add" on something
    // they already had, and telling them off for it helps nobody.
    if !list.iter().any(|g| g.path == canonical.to_string_lossy()) {
        list.push(StoredGrant {
            id: uuid(),
            path: canonical.to_string_lossy().to_string(),
            label,
            mode: if mode == "rw" {
                "rw".into()
            } else {
                "ro".into()
            },
        });
    }
    save_grants(&app, &list);
    Ok(list
        .iter()
        .map(|g| PublicGrant {
            id: g.id.clone(),
            label: g.label.clone(),
            mode: g.mode.clone(),
        })
        .collect())
}

#[tauri::command]
pub fn grant_remove(
    app: AppHandle,
    state: State<'_, GrantState>,
    id: String,
) -> Result<Vec<PublicGrant>, String> {
    let mut list = state.0.lock().map_err(|_| "grant store is poisoned")?;
    list.retain(|g| g.id != id);
    save_grants(&app, &list);
    Ok(list
        .iter()
        .map(|g| PublicGrant {
            id: g.id.clone(),
            label: g.label.clone(),
            mode: g.mode.clone(),
        })
        .collect())
}

/// One filesystem operation on behalf of the pod.
///
/// Returns `serde_json::Value` because the six ops have six result shapes and the caller forwards
/// whatever comes back verbatim. Never returns `Err` for a REFUSAL: a denied path is a normal
/// outcome the agent must be able to read and act on, so it arrives as `{ ok: false, error }`
/// inside the value. `Err` is reserved for the command itself being unusable.
/// One request, as it arrives from the bridge. A struct rather than eight positional parameters:
/// the six ops use overlapping subsets, and a positional list of `Option`s is exactly the shape
/// where an argument eventually gets passed in the wrong slot.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsRequest {
    pub op: String,
    pub root_id: String,
    pub path: Option<String>,
    pub query: Option<String>,
    pub content: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[tauri::command]
pub fn fs_op(state: State<'_, GrantState>, req: FsRequest) -> Result<serde_json::Value, String> {
    let FsRequest {
        op,
        root_id,
        path,
        query,
        content,
        offset,
        limit,
    } = req;
    let list = state
        .0
        .lock()
        .map_err(|_| "grant store is poisoned")?
        .clone();
    let grants = to_grants(&list);
    let v = match op.as_str() {
        "tree" => serde_json::to_value(fsops::tree(&grants, &root_id, path.as_deref())),
        "stat" => serde_json::to_value(fsops::stat(
            &grants,
            &root_id,
            path.as_deref().unwrap_or(""),
        )),
        "read" => serde_json::to_value(fsops::read(
            &grants,
            &root_id,
            path.as_deref().unwrap_or(""),
            offset,
            limit,
        )),
        "write" => serde_json::to_value(fsops::write(
            &grants,
            &root_id,
            path.as_deref().unwrap_or(""),
            content.as_deref().unwrap_or(""),
        )),
        "search" => serde_json::to_value(fsops::search(
            &grants,
            &root_id,
            query.as_deref().unwrap_or(""),
            path.as_deref(),
        )),
        other => return Err(format!("unknown local filesystem operation: {other}")),
    };
    v.map_err(|e| e.to_string())
}

/// A v4-shaped id without pulling in the `uuid` crate for one call site.
fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("grant-{nanos:x}")
}
