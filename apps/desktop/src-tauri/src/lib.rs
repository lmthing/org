//! The desktop shell.
//!
//! Deliberately small. Everything a person looks at is `@lmthing/ui`, rendered by
//! the webview from the same source `apps/web` and `apps/mobile` render; this crate
//! owns the window, the deep link, and telling the page where the pod is.
//!
//! Phase 2 adds exactly one more file to this crate — `grants.rs`, the filesystem
//! jail — and that one IS the security boundary. Nothing else here is load-bearing
//! for safety, which is the point: the surface that has to be right is one function.

mod browser_view;
mod commands;
mod config;
mod fsops;
mod grants;
#[cfg(target_os = "linux")]
mod gtk_pane;
mod menu;
mod navigation;
mod sidecar;

use config::{DesktopBridge, Tokens};
use tauri::{Emitter, Manager, Theme, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub fn run() {
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
            commands::browserview_open,
            commands::browserview_bounds,
            commands::browserview_navigate,
            commands::browserview_hide,
            commands::browserview_show,
            commands::browserview_close,
            commands::browserview_state,
            commands::browserview_eval,
            commands::local_mode_enable,
            commands::local_mode_disable,
            commands::local_mode_status,
        ])
        .setup(move |app| {
            // The grant list, restored from disk. Empty on a fresh install: the bridge can reach
            // nothing at all until the person points it at something.
            app.manage(commands::GrantState(std::sync::Mutex::new(
                commands::load_grants(app.handle()),
            )));

            // Every OTHER piece of command state, and this is not optional bookkeeping: a command
            // whose `State<'_, T>` was never managed fails at CALL time with "state not managed for
            // field `state`", not at build time. `browser_start` shipped that way — the command was
            // registered, the Rust compiled, `cargo test` passed, and the E2E never noticed because
            // it stubs `invoke` wholesale. The first person to click Browser found it.
            //
            // Registering them together, right here, is what makes the omission visible: a new
            // command with state has one obvious place to appear, next to the others.
            app.manage(commands::SidecarState::default());

            // Without an Edit menu, macOS ⌘C/⌘V/⌘A do nothing at all — AppKit routes them through
            // menu items, not the webview. See `menu.rs`.
            menu::install(app.handle())?;

            // The menu's one non-predefined item. Forwarded to the webview as an event rather than
            // acted on here: which pane is open is React state, and Rust has no business knowing
            // it. The window is looked up by label because the handler outlives any one borrow of
            // the builder above.
            {
                let handle = app.handle().clone();
                app.on_menu_event(move |_app, event| {
                    if event.id() == menu::TOGGLE_BROWSER {
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.emit("lmthing://toggle-browser", ());
                        }
                    }
                });
            }

            // Development only, and only where the OS has no installer to do it. A packaged
            // build gets its scheme from the bundle manifest; runtime registration exists so
            // `tauri dev` can exercise the real login path instead of leaving it untested
            // until release day.
            #[cfg(all(debug_assertions, any(target_os = "linux", target_os = "windows")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Built HERE rather than before the builder, so a persisted local-mode setting is
            // read from this app's own config directory — which needs the AppHandle.
            let bridge = DesktopBridge::load_with(commands::persisted_local_base(app.handle()));

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

            // Devtools, on request.
            //
            // Worth a few lines because of how a webview fails: when the page does not render, the
            // window is simply the background colour, and that is indistinguishable from a window
            // that never loaded anything. There is no log — WebKitGTK does not forward console
            // messages to stderr — so without this the only way to find out whether the bundle
            // threw, rendered nothing, or was never fetched is to guess.
            //
            // Opt-in rather than always-on in debug builds: `tauri dev` is also how the app is
            // demonstrated, and a devtools pane that appears uninvited every launch is its own
            // small annoyance.
            #[cfg(debug_assertions)]
            if std::env::var("LMTHING_DEVTOOLS").is_ok() {
                window.open_devtools();
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

    /// Every `State<'_, T>` a command asks for must be `app.manage`d.
    ///
    /// This is a SOURCE check, and it has to be, because the compiler cannot see the connection at
    /// all: `#[tauri::command]` resolves state by TYPE at runtime, so a command whose state was
    /// never managed compiles cleanly, links cleanly, passes `cargo test` and then fails the first
    /// time a person clicks the button — "state not managed for field `state`". `browser_start`
    /// shipped exactly that way. The E2E could not catch it either, because it stubs `invoke`
    /// wholesale and never reaches Rust.
    ///
    /// Reading the two files is crude next to a real registry, and it is what the failure mode
    /// deserves: the whole bug is that the two lists silently disagreed.
    #[test]
    fn every_command_state_is_managed() {
        let commands = include_str!("commands.rs");
        // COMMENTS STRIPPED. Without this the check passes on a `// app.manage(...)` line, because
        // a commented-out call still contains the substring — which is exactly how somebody
        // disables one while debugging and forgets. Verified by commenting the line out and
        // watching this fail.
        let lib: String = include_str!("lib.rs")
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        let mut wanted: Vec<&str> = Vec::new();
        for (_, rest) in commands
            .match_indices("State<'_, ")
            .map(|(i, _)| (i, &commands[i..]))
        {
            let after = &rest["State<'_, ".len()..];
            let Some(end) = after.find('>') else { continue };
            let ty = after[..end].trim();
            if !wanted.contains(&ty) {
                wanted.push(ty);
            }
        }
        assert!(
            !wanted.is_empty(),
            "no command state found — has commands.rs moved?"
        );

        for ty in wanted {
            let managed = format!("app.manage(commands::{ty}");
            assert!(
                lib.contains(&managed),
                "`{ty}` is asked for by a command but never managed in lib.rs's setup — every call \
                 to that command will fail at RUNTIME with \"state not managed\". Add \
                 `{managed}::default());`",
            );
        }
    }

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
