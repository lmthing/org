//! The browser pane: a second real webview, inside this app's window.
//!
//! ## What changed, and why
//!
//! The first version of this pane ran a real Chromium with no window and streamed its frames in
//! over CDP (`Page.startScreencast`), drawing them into an `<img>`. Everything about that worked,
//! and it was still wrong: JPEG frames are not a browser. Scrolling has a texture that a stream of
//! images does not reproduce, text is softened by compression, IME never behaves, and an OS file
//! picker cannot appear inside a picture. A person notices in about three seconds.
//!
//! So the pane is now an actual webview, positioned inside the app's window by the OS
//! ([`tauri::window::Window::add_child`]). Real scrolling, real text, real form controls, real file
//! pickers, real video — because it is a real browser view, not a video of one.
//!
//! It also costs nothing to install. The webview is already on the machine: WebView2 on Windows,
//! WKWebView on macOS, WebKitGTK on Linux. The alternative under discussion was downloading a
//! ~185MB Chromium on first use.
//!
//! ## What this gives up, honestly
//!
//! **The Chrome DevTools Protocol.** Only WebView2 speaks it; WKWebView and WebKitGTK do not. So
//! the agent cannot drive this pane with CDP, and everything `backendNodeId`-shaped is gone with
//! it. Reads and actions are injected JavaScript instead, evaluated in the page
//! ([`tauri::webview::Webview::eval_with_callback`], which serialises the result to JSON and hands
//! it back to Rust — the one API that makes this design possible at all).
//!
//! The practical difference is narrower than it sounds for reading a page and wider than it sounds
//! for acting on one: a dispatched `click` is not an OS-level mouse press, and a minority of login
//! flows and bot checks can tell. Where that matters, the person is right there and can click it.
//!
//! **DOM z-order does not apply to it.** A child webview is an OS rectangle inside the window, not
//! an element in the app's document, so anything the app draws over that rectangle — a drawer, a
//! dialog — is painted UNDERNEATH. The pane is therefore hidden rather than covered whenever
//! something must appear on top; see `hide`/`show`.

use serde::Serialize;
use tauri::webview::{Webview, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

/// The label the child webview is registered under. One pane, one label.
pub const BROWSER_LABEL: &str = "browser";
/// The window the pane lives inside.
pub const MAIN_LABEL: &str = "main";

/// Where the pane sits, in CSS pixels within the window.
///
/// Sent by the renderer, which is the only party that knows: the split divider is draggable and the
/// toolbar above the pane is laid out by the same CSS as everything else. Rust measuring it would
/// mean re-deriving the layout in a second place and keeping the two agreeing.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct PaneRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    pub open: bool,
    pub url: String,
}

fn find(app: &AppHandle) -> Option<Webview> {
    app.get_webview(BROWSER_LABEL)
}

/// Open the pane at `rect`, or move the existing one there.
///
/// Idempotent on purpose: the renderer calls this on open AND on every resize, and making the
/// caller track which case it is in would put the same state in two places.
pub fn open(app: &AppHandle, url: &str, rect: PaneRect) -> Result<ViewState, String> {
    if let Some(view) = find(app) {
        set_bounds(app, rect)?;
        view.show().map_err(|e| e.to_string())?;
        return state(app);
    }
    let window = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "the main window is gone".to_string())?;
    let parsed = parse_url(url)?;

    let builder = WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(parsed))
        // Runs before any page script, on every navigation. This is what makes the pane
        // controllable at all — see `agent.js` for what it installs and why it is deliberately
        // tiny.
        .initialization_script(include_str!("agent.js"));

    // NOT `.focused(true)`. Taking focus on open sounds helpful and breaks the control that opened
    // it: the pane's own webview then owns the keyboard, so Ctrl-B goes to the PAGE and never
    // reaches the app — the shortcut opens the browser and cannot close it again. A person clicks
    // into a page to type in it, the same as any other pane.

    // NO `auto_resize()`. It sounds like exactly what a pane wants and is the opposite: it ties the
    // view to the WINDOW's size rather than to the rectangle it was given, so the page renders full
    // width, at the wrong offset, spilling past the bottom edge — over the app and over whatever is
    // behind it. The pane's geometry is the SPLIT's, which Rust cannot know: the divider is
    // draggable and the toolbar is laid out by CSS. The renderer measures and calls `set_bounds`.

    window
        .add_child(
            builder,
            LogicalPosition::new(rect.x, rect.y),
            LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)),
        )
        .map_err(|e| format!("could not open the browser pane: {e}"))?;
    // Linux needs its widgets rearranged before ANY position will stick. Done here rather than in
    // `set_bounds` so it happens exactly once, on the one call that just created the view.
    #[cfg(target_os = "linux")]
    crate::gtk_pane::install(app)?;

    // Set again, straight away. `add_child` takes a position and size and platforms do not all
    // honour them identically at creation time; going through the same path the resize observer
    // uses means there is ONE definition of where the pane is rather than two that can disagree.
    set_bounds(app, rect)?;
    state(app)
}

/// Move and resize the pane. Called on every divider drag and window resize.
///
/// One rectangle, one meaning, two mechanisms. On Windows and macOS a child webview is a real child
/// view and Tauri positions it; on Linux it is a `GtkBox` child whose position Tauri discards, so
/// the widgets were rearranged into an overlay at creation and the placement is by margin. The
/// LAYOUT is identical on all three — the renderer measures the same pane and sends the same
/// numbers — which is the point: a browser that sits somewhere different depending on the OS is a
/// different product on each.
pub fn set_bounds(app: &AppHandle, rect: PaneRect) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if find(app).is_none() {
            return Ok(());
        }
        crate::gtk_pane::place(app, rect)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let Some(view) = find(app) else { return Ok(()) };
        view.set_position(LogicalPosition::new(rect.x, rect.y))
            .map_err(|e| e.to_string())?;
        view.set_size(LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)))
            .map_err(|e| e.to_string())
    }
}

/// Hide without destroying.
///
/// Used for the two cases a DOM element would have solved by itself: switching to a surface that
/// does not show the pane, and anything the app draws that would otherwise be painted underneath
/// it. Hiding keeps the page loaded, the scroll position, and whatever the person had typed.
pub fn hide(app: &AppHandle) -> Result<(), String> {
    match find(app) {
        Some(view) => view.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    match find(app) {
        Some(view) => view.show().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    match find(app) {
        Some(view) => view.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn navigate(app: &AppHandle, url: &str) -> Result<ViewState, String> {
    let view = find(app).ok_or_else(|| "the browser pane is not open".to_string())?;
    view.navigate(parse_url(url)?).map_err(|e| e.to_string())?;
    state(app)
}

pub fn state(app: &AppHandle) -> Result<ViewState, String> {
    Ok(match find(app) {
        Some(view) => ViewState {
            open: true,
            url: view.url().map(|u| u.to_string()).unwrap_or_default(),
        },
        None => ViewState {
            open: false,
            url: String::new(),
        },
    })
}

/// What the person typed, turned into somewhere to go.
///
/// An address bar takes three kinds of input and only one of them is a URL. Treating the other two
/// as URLs is the difference between a browser and a text field: `example.com` must not become a
/// search, and `athens weather` must not become a failed navigation to a host that does not exist.
pub fn parse_url(input: &str) -> Result<Url, String> {
    let text = input.trim();
    if text.is_empty() {
        return Err("nothing to open".into());
    }
    // Already a scheme — but only `//` proves it. Without that check `localhost:3000` parses as the
    // scheme `localhost`, and the pane goes nowhere with no error worth reading.
    if text.contains("://") {
        return Url::parse(text).map_err(|e| format!("{text} is not a URL: {e}"));
    }
    let looks_like_host = !text.contains(' ')
        && (text.contains('.') || text.starts_with("localhost") || text.starts_with("127.0.0.1"));
    let candidate = if looks_like_host {
        format!("https://{text}")
    } else {
        format!("https://duckduckgo.com/?q={}", urlencode(text))
    };
    Url::parse(&candidate).map_err(|e| format!("could not open {text}: {e}"))
}

/// Percent-encode a query, without a crate for it.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_address_bar_takes_three_kinds_of_input() {
        assert_eq!(
            parse_url("https://example.com").unwrap().as_str(),
            "https://example.com/"
        );
        // A bare host is a host, not a search. Getting this wrong is the single most visible way an
        // address bar can be wrong.
        assert_eq!(
            parse_url("example.com").unwrap().as_str(),
            "https://example.com/"
        );
        assert_eq!(
            parse_url(" news.ycombinator.com ").unwrap().as_str(),
            "https://news.ycombinator.com/"
        );
        // Words are a search.
        let q = parse_url("athens weather").unwrap();
        assert_eq!(q.host_str(), Some("duckduckgo.com"));
        assert!(q.as_str().contains("athens+weather"));
        assert!(parse_url("   ").is_err());
    }

    #[test]
    fn a_port_is_not_a_scheme() {
        // `localhost:3000` contains a colon and IS NOT a scheme. Splitting on ':' instead of '://'
        // sends the pane to the scheme `localhost`, which fails silently.
        let u = parse_url("localhost:3000").unwrap();
        assert_eq!(u.scheme(), "https");
        assert_eq!(u.host_str(), Some("localhost"));
        assert_eq!(u.port(), Some(3000));
    }

    #[test]
    fn a_query_is_encoded_so_it_survives_the_trip() {
        assert_eq!(urlencode("a b&c=d"), "a+b%26c%3Dd");
        assert_eq!(urlencode("ok-_.~"), "ok-_.~");
    }
}
