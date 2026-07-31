//! The application menu.
//!
//! This is not decoration, and on macOS it is not optional. AppKit routes ⌘C/⌘V/⌘X/⌘A through
//! **menu items**, not through the webview — an app with no Edit menu is an app where copy and
//! paste silently do nothing. For a chat client that is not a missing nicety, it is broken.
//!
//! Everything here is a `PredefinedMenuItem`, which means the OS supplies the label, the accelerator
//! and the behaviour per platform. A hand-rolled "Copy" bound to `CmdOrCtrl+C` would have to
//! reimplement the clipboard, would not follow the system keyboard layout, and would not be
//! localised.

use tauri::{
    menu::{IsMenuItem, Menu, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};

/// The macOS application menu. Absent elsewhere: on Windows and Linux the first submenu is just
/// another menu, and an "lmthing" entry holding Quit beside a Window menu is redundant chrome.
#[cfg(target_os = "macos")]
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    Submenu::with_items(
        app,
        "lmthing",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )
}

/// The one that must exist. See the module comment.
///
/// Windows and Linux get it too, even though their toolkits deliver clipboard keys to the webview
/// directly and would work without it: a visible, discoverable Edit menu is the convention on all
/// three platforms, and one code path is one thing to keep correct.
fn edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )
}

fn window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )
}

/// Build and install the menu.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let sections = [app_menu(app)?, edit_menu(app)?, window_menu(app)?];
    #[cfg(not(target_os = "macos"))]
    let sections = [edit_menu(app)?, window_menu(app)?];

    let refs: Vec<&dyn IsMenuItem<R>> = sections.iter().map(|s| s as &dyn IsMenuItem<R>).collect();
    app.set_menu(Menu::with_items(app, &refs)?)?;
    Ok(())
}
