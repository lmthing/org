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

use crate::fsops;
use crate::grants::{Grant, Grants, Mode};

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
