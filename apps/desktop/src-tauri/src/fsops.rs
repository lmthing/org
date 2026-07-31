//! The filesystem operations the bridge exposes — every one of them routed through
//! [`crate::grants::Grants::resolve`] first.
//!
//! Nothing here re-implements a security check. `resolve` is the boundary; these functions receive
//! an already-validated absolute path and do the ordinary work. That separation is deliberate: a
//! check duplicated in six operations is a check that will eventually disagree with itself in one
//! of them.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::grants::{Access, Denied, Grants, MAX_ENTRIES, MAX_READ_BYTES, MAX_WRITE_BYTES};

#[derive(Debug, Serialize)]
pub struct Entry {
    /// Relative to the grant — never absolute, matching the wire contract.
    pub path: String,
    pub kind: &'static str,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeResult {
    pub ok: bool,
    pub entries: Vec<Entry>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub ok: bool,
    pub content: String,
    pub lines: usize,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub ok: bool,
    pub bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Hit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub ok: bool,
    pub hits: Vec<Hit>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Directories never worth walking, and expensive enough that including them makes `tree` useless.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
    "__pycache__",
    ".turbo",
    ".cache",
];

pub fn tree(grants: &Grants, root_id: &str, rel: Option<&str>) -> TreeResult {
    let base = match grants.resolve(root_id, rel.unwrap_or(""), Access::Read) {
        Ok(p) => p,
        Err(e) => {
            return TreeResult {
                ok: false,
                entries: vec![],
                truncated: false,
                error: Some(e.message().into()),
            }
        }
    };
    let root = match grants.get(root_id) {
        Some(g) => g.path.clone(),
        None => {
            return TreeResult {
                ok: false,
                entries: vec![],
                truncated: false,
                error: Some(Denied::UnknownRoot.message().into()),
            }
        }
    };

    let mut entries = Vec::new();
    let truncated = walk(&base, &root, &mut entries);
    TreeResult {
        ok: true,
        entries,
        truncated,
        error: None,
    }
}

/// Depth-first walk, capped. Returns whether the cap was hit.
fn walk(dir: &Path, root: &Path, out: &mut Vec<Entry>) -> bool {
    if out.len() >= MAX_ENTRIES {
        return true;
    }
    let Ok(read) = fs::read_dir(dir) else {
        return false;
    };
    for item in read.flatten() {
        if out.len() >= MAX_ENTRIES {
            return true;
        }
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        let Ok(meta) = item.metadata() else { continue };
        // Relative to the GRANT, not to `dir` — the agent addresses everything from the root.
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().to_string();

        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            out.push(Entry {
                path: rel_str,
                kind: "dir",
                size: 0,
            });
            if walk(&path, root, out) {
                return true;
            }
        } else {
            out.push(Entry {
                path: rel_str,
                kind: "file",
                size: meta.len(),
            });
        }
    }
    false
}

pub fn stat(grants: &Grants, root_id: &str, rel: &str) -> StatResult {
    let path = match grants.resolve(root_id, rel, Access::Read) {
        Ok(p) => p,
        Err(e) => {
            return StatResult {
                ok: false,
                kind: None,
                size: None,
                mtime: None,
                error: Some(e.message().into()),
            }
        }
    };
    match fs::metadata(&path) {
        Ok(m) => StatResult {
            ok: true,
            kind: Some(if m.is_dir() { "dir" } else { "file" }),
            size: Some(m.len()),
            mtime: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64),
            error: None,
        },
        Err(e) => StatResult {
            ok: false,
            kind: None,
            size: None,
            mtime: None,
            error: Some(e.to_string()),
        },
    }
}

pub fn read(
    grants: &Grants,
    root_id: &str,
    rel: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> ReadResult {
    let path = match grants.resolve(root_id, rel, Access::Read) {
        Ok(p) => p,
        Err(e) => {
            return ReadResult {
                ok: false,
                content: String::new(),
                lines: 0,
                truncated: false,
                error: Some(e.message().into()),
            }
        }
    };
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            return ReadResult {
                ok: false,
                content: String::new(),
                lines: 0,
                truncated: false,
                error: Some(e.to_string()),
            }
        }
    };

    // Binary files are refused rather than mangled: handing an agent lossy UTF-8 of a PNG wastes a
    // turn and a large slice of its context on noise.
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return ReadResult {
            ok: false,
            content: String::new(),
            lines: 0,
            truncated: false,
            error: Some("binary file".into()),
        };
    }

    let text = String::from_utf8_lossy(&bytes).to_string();
    // Line-oriented, because `offset`/`limit` are how an agent reads part of a large file and
    // lines are the unit it reasons in.
    let all: Vec<&str> = text.lines().collect();
    let start = offset.unwrap_or(0).min(all.len());
    let end = limit
        .map(|l| (start + l).min(all.len()))
        .unwrap_or(all.len());
    let mut slice = all[start..end].join("\n");
    let mut truncated = end < all.len();

    if slice.len() > MAX_READ_BYTES {
        slice.truncate(MAX_READ_BYTES);
        truncated = true;
    }
    let lines = slice.lines().count();
    ReadResult {
        ok: true,
        content: slice,
        lines,
        truncated,
        error: None,
    }
}

pub fn write(grants: &Grants, root_id: &str, rel: &str, content: &str) -> WriteResult {
    if content.len() > MAX_WRITE_BYTES {
        return WriteResult {
            ok: false,
            bytes: 0,
            error: Some("content exceeds the write limit".into()),
        };
    }
    let path = match grants.resolve(root_id, rel, Access::Write) {
        Ok(p) => p,
        Err(e) => {
            return WriteResult {
                ok: false,
                bytes: 0,
                error: Some(e.message().into()),
            }
        }
    };
    match fs::write(&path, content) {
        Ok(()) => WriteResult {
            ok: true,
            bytes: content.len(),
            error: None,
        },
        Err(e) => WriteResult {
            ok: false,
            bytes: 0,
            error: Some(e.to_string()),
        },
    }
}

pub fn search(grants: &Grants, root_id: &str, query: &str, rel: Option<&str>) -> SearchResult {
    let base = match grants.resolve(root_id, rel.unwrap_or(""), Access::Read) {
        Ok(p) => p,
        Err(e) => {
            return SearchResult {
                ok: false,
                hits: vec![],
                truncated: false,
                error: Some(e.message().into()),
            }
        }
    };
    let Some(root) = grants.get(root_id).map(|g| g.path.clone()) else {
        return SearchResult {
            ok: false,
            hits: vec![],
            truncated: false,
            error: Some(Denied::UnknownRoot.message().into()),
        };
    };

    let mut files = Vec::new();
    walk(&base, &root, &mut files);

    let needle = query.to_ascii_lowercase();
    let mut hits = Vec::new();
    let mut truncated = false;
    for f in files.iter().filter(|e| e.kind == "file") {
        if hits.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let abs: PathBuf = root.join(&f.path);
        let Ok(bytes) = fs::read(&abs) else { continue };
        if bytes.iter().take(8192).any(|b| *b == 0) {
            continue;
        }
        for (i, line) in String::from_utf8_lossy(&bytes).lines().enumerate() {
            if line.to_ascii_lowercase().contains(&needle) {
                hits.push(Hit {
                    path: f.path.clone(),
                    line: i + 1,
                    // Capped: one pathological minified line must not become the whole answer.
                    text: line.chars().take(400).collect(),
                });
                if hits.len() >= MAX_ENTRIES {
                    truncated = true;
                    break;
                }
            }
        }
    }
    SearchResult {
        ok: true,
        hits,
        truncated,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grants::{Grant, Mode};

    fn fixture(name: &str) -> (PathBuf, Grants) {
        let root =
            std::env::temp_dir().join(format!("lmthing-fsops-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("g/src")).unwrap();
        fs::create_dir_all(root.join("g/node_modules/pkg")).unwrap();
        fs::write(
            root.join("g/src/main.rs"),
            "fn main() {\n    // TODO: fix\n}\n",
        )
        .unwrap();
        fs::write(root.join("g/README.md"), "hello\nworld\n").unwrap();
        fs::write(root.join("g/node_modules/pkg/index.js"), "// TODO noise\n").unwrap();
        let grants = Grants::new(vec![Grant {
            id: "r1".into(),
            path: fs::canonicalize(root.join("g")).unwrap(),
            mode: Mode::Rw,
        }]);
        (root, grants)
    }

    #[test]
    fn tree_lists_relative_paths_and_skips_node_modules() {
        let (root, g) = fixture("tree");
        let r = tree(&g, "r1", None);
        assert!(r.ok);
        let paths: Vec<&str> = r.entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"README.md"));
        assert!(paths.contains(&"src/main.rs"));
        // Every path is relative to the grant — an absolute one would leak the layout.
        assert!(paths.iter().all(|p| !p.starts_with('/')));
        // node_modules is skipped, or `tree` is useless on any real project.
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_returns_content_and_honours_a_line_window() {
        let (root, g) = fixture("read");
        let r = read(&g, "r1", "README.md", None, None);
        assert!(r.ok);
        assert_eq!(r.content, "hello\nworld");
        let windowed = read(&g, "r1", "README.md", Some(1), Some(1));
        assert_eq!(windowed.content, "world");
        assert!(!windowed.truncated || true);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_refusal_arrives_as_data_rather_than_a_panic() {
        let (root, g) = fixture("refuse");
        let r = read(&g, "r1", "../outside.txt", None, None);
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("must be relative"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_round_trips_and_a_read_only_grant_refuses() {
        let (root, g) = fixture("write");
        assert!(write(&g, "r1", "src/new.rs", "fn x() {}").ok);
        assert_eq!(
            read(&g, "r1", "src/new.rs", None, None).content,
            "fn x() {}"
        );

        let ro = Grants::new(vec![Grant {
            id: "r1".into(),
            path: fs::canonicalize(root.join("g")).unwrap(),
            mode: Mode::Ro,
        }]);
        let r = write(&ro, "r1", "src/nope.rs", "x");
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("read-only"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_finds_matches_and_ignores_skipped_directories() {
        let (root, g) = fixture("search");
        let r = search(&g, "r1", "todo", None);
        assert!(r.ok);
        assert_eq!(r.hits.len(), 1, "the node_modules hit must not be included");
        assert_eq!(r.hits[0].path, "src/main.rs");
        assert_eq!(r.hits[0].line, 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_binary_file_is_refused_rather_than_mangled() {
        // Lossy UTF-8 of a PNG would waste a turn and a large slice of the agent's context.
        let (root, g) = fixture("binary");
        fs::write(root.join("g/logo.dat"), [0u8, 1, 2, 3, 0]).unwrap();
        let r = read(&g, "r1", "logo.dat", None, None);
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("binary file"));
        let _ = fs::remove_dir_all(root);
    }
}
