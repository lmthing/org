//! What this window is allowed to navigate to.
//!
//! There is exactly one document in this app, and leaving it is fatal. A Tauri window has no back
//! button, no address bar and no tab: navigate the webview to `https://example.com` and the bundle
//! is gone, along with the React tree, the pod WebSocket and whatever the person was typing. The
//! only way back is to force-quit.
//!
//! That is not a hypothetical. Chat transcripts render markdown links, team messages contain URLs,
//! and `LoginScreen` used to assign `location.href` for SSO (fixed separately, in
//! `libs/auth/src/platform/sso.ts`). Any one of them would have destroyed the app.
//!
//! So navigation is allow-listed rather than filtered: the bundle's own origin is permitted, and
//! **everything else is refused and handed to the system browser instead** — which is also where
//! the person's existing sessions and password manager are. A JS click handler would not do,
//! because it only sees clicks: `window.location =`, a form POST, `target="_blank"` and a
//! `<meta refresh>` all bypass it. This sits below all of them.

use tauri::Url;

/// Origins that ARE the app.
///
/// - `tauri://localhost` — the packaged bundle on macOS and Linux.
/// - `http://tauri.localhost` — the same thing on Windows, which cannot use a custom scheme for the
///   main document.
/// - `http://localhost:*` / `http://127.0.0.1:*` — the Vite dev server under `tauri dev`, and
///   (phase 3) the bundled `lmthing serve` sidecar on loopback.
pub fn is_internal(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("tauri.localhost")
        ),
        _ => false,
    }
}

/// Whether the webview may follow `url`. `false` means the caller opens it externally instead.
///
/// Kept as a pure function of the URL so it can be tested without a window — this is a security
/// boundary of the "do not destroy the app" kind, and the interesting cases are all string cases.
pub fn allow_navigation(url: &Url) -> bool {
    is_internal(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).expect("test url")
    }

    #[test]
    fn the_app_itself_is_allowed_on_every_platform() {
        assert!(allow_navigation(&u("tauri://localhost/index.html")));
        assert!(allow_navigation(&u("http://tauri.localhost/index.html")));
        assert!(allow_navigation(&u("http://localhost:5173/")));
        assert!(allow_navigation(&u("http://127.0.0.1:41234/chat")));
    }

    #[test]
    fn anything_that_would_replace_the_app_is_refused() {
        // The realistic ones: a link in a chat transcript, a team message, an OAuth page.
        assert!(!allow_navigation(&u("https://example.com/")));
        assert!(!allow_navigation(&u("https://lmthing.com/auth/sso")));
        assert!(!allow_navigation(&u("http://192.168.1.10/")));
    }

    #[test]
    fn a_lookalike_host_does_not_get_in() {
        // `localhost.evil.com` and `evil-tauri.localhost` both END with an allowed name; a
        // `ends_with` check — the obvious way to write this — would have admitted both and handed
        // an attacker the whole window.
        assert!(!allow_navigation(&u("https://localhost.evil.com/")));
        assert!(!allow_navigation(&u("https://evil-tauri.localhost/")));
        assert!(!allow_navigation(&u("https://notlocalhost/")));
    }

    #[test]
    fn non_http_schemes_are_refused_too() {
        // `file://` would expose the whole disk to a page; `javascript:` is script injection into
        // the app's own origin. Neither is something a navigation should ever perform.
        assert!(!allow_navigation(&u("file:///etc/passwd")));
        assert!(!allow_navigation(&u("javascript:alert(1)")));
        assert!(!allow_navigation(&u("data:text/html,<h1>hi")));
    }
}
