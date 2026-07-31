//! The desktop shell.
//!
//! Deliberately small. Everything a person looks at is `@lmthing/ui`, rendered by
//! the webview from the same source `apps/web` and `apps/mobile` render; this crate
//! owns the window, the deep link, and telling the page where the pod is.
//!
//! Phase 2 adds exactly one more file to this crate — `grants.rs`, the filesystem
//! jail — and that one IS the security boundary. Nothing else here is load-bearing
//! for safety, which is the point: the surface that has to be right is one function.

mod commands;
mod config;
mod fsops;
mod grants;
mod menu;
mod navigation;

use config::{DesktopBridge, Tokens};
use tauri::{Manager, Theme, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub fn run() {
    let bridge = DesktopBridge::load();
    let tokens = Tokens::load();

    let builder = tauri::Builder::default();

    // MUST be registered first, per the plugin's own contract.
    //
    // On Linux and Windows a `lmthing://` callback LAUNCHES A SECOND COPY of the app
    // with the URL in argv rather than delivering it to the running one. Without this
    // the SSO callback lands in a fresh process with no pending login to resolve,
    // while the window the user is looking at waits out its five-minute timeout.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        // The deep-link plugin picks the URL out of argv itself; this handler exists to
        // bring the instance that owns the pending login back to the front.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        // Size and position across launches. A window that reopens at the default 1100×760 in the
        // middle of the screen every time is the clearest signal that something is a web page in a
        // frame rather than an application.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // The folder picker for adding a grant. The person chooses; nothing else may.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::grant_list,
            commands::grant_list_detailed,
            commands::grant_add,
            commands::grant_remove,
            commands::fs_op,
        ])
        .setup(move |app| {
            // The grant list, restored from disk. Empty on a fresh install: the bridge can reach
            // nothing at all until the person points it at something.
            app.manage(commands::GrantState(std::sync::Mutex::new(
                commands::load_grants(app.handle()),
            )));

            // Without an Edit menu, macOS ⌘C/⌘V/⌘A do nothing at all — AppKit routes them through
            // menu items, not the webview. See `menu.rs`.
            menu::install(app.handle())?;

            // Development only, and only where the OS has no installer to do it. A packaged
            // build gets its scheme from the bundle manifest; runtime registration exists so
            // `tauri dev` can exercise the real login path instead of leaving it untested
            // until release day.
            #[cfg(all(debug_assertions, any(target_os = "linux", target_os = "windows")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("lmthing")
                .inner_size(1100.0, 760.0)
                // Below this the shared surfaces stop having room for a transcript and its
                // composer at once, and the composer is the control used constantly.
                .min_inner_size(680.0, 480.0)
                // Runs before ANY page script, on every navigation — which is what lets
                // `@lmthing/auth` read the bridge synchronously during module init rather
                // than having to wait for an event.
                .initialization_script(bridge.initialization_script())
                // The app has one document and leaving it is fatal — no back button, no address
                // bar, and the pod socket and everything typed goes with it. So: allow-list the
                // bundle's own origin and hand every other URL to the system browser, which is
                // where the person's sessions and password manager already are.
                //
                // This sits BELOW the DOM deliberately. A JS click handler only sees clicks;
                // `location =`, a form POST, `target="_blank"` and `<meta refresh>` all bypass it.
                .on_navigation({
                    let handle = app.handle().clone();
                    move |url| {
                        if navigation::allow_navigation(url) {
                            return true;
                        }
                        // Best-effort: a URL the OS cannot open is not a reason to let the
                        // navigation through, which is the one outcome that loses the app.
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                        false
                    }
                })
                .build()?;

            // The colour the OS paints between the window appearing and the webview's first
            // paint. Set after build rather than on the builder because the theme is a
            // property of the created window; the page decides the same thing for itself via
            // `matchMedia`, so this is only about the moment before it can.
            let dark = matches!(window.theme(), Ok(Theme::Dark));
            if let Some(color) = parse_hex(tokens.background_for(dark)) {
                let _ = window.set_background_color(Some(color));
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running lmthing desktop");
}

/// `#rrggbb` from the design tokens → an opaque window colour.
///
/// Returns `None` rather than panicking on a malformed value: a colour is cosmetic, and taking the
/// whole app down over one would be a far worse bug than the flash it prevents. The generator is
/// what guarantees the value is well-formed, and its own test asserts that.
fn parse_hex(hex: &str) -> Option<tauri::window::Color> {
    let hex = hex.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some(tauri::window::Color(r, g, b, 255))
}

#[cfg(test)]
mod tests {
    use super::parse_hex;

    #[test]
    fn parses_a_token_colour_and_rejects_junk() {
        let c = parse_hex("#1a1512").expect("well-formed");
        assert_eq!((c.0, c.1, c.2, c.3), (0x1a, 0x15, 0x12, 255));
        assert!(parse_hex("1a1512").is_none(), "a missing # is not a colour");
        assert!(
            parse_hex("#abc").is_none(),
            "shorthand is not supported by the generator"
        );
        assert!(parse_hex("#gggggg").is_none());
    }
}
