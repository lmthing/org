//! Positioning the browser pane on Linux, by rearranging GTK ourselves.
//!
//! ## Why this file has to exist
//!
//! Tauri's `Window::add_child` takes a position and a size, and on Linux it discards both.
//!
//! The path is short enough to state exactly. `tauri-runtime-wry` builds a child webview into
//! `window.default_vbox()` — a `GtkBox` (`tauri-runtime-wry-2.11.4/src/lib.rs:5236`). wry, handed a
//! `GtkBox`, calls `pack_start(webview, true, true, 0)`
//! (`wry-0.55.1/src/webkitgtk/mod.rs:597`): the child is STACKED, expanded to full width, and the
//! requested position is dropped on the floor. It also records `is_in_fixed_parent = false`, which
//! makes wry's own `set_bounds` a no-op — its only other branch is `#[cfg(feature = "x11")]` over a
//! field that is `None` on this path anyway.
//!
//! So there is no combination of arguments that positions a child webview on Linux. It is not a
//! Wayland problem and not a scale-factor problem; it presents as a browser rendered full width
//! below the app, spilling past the bottom edge, which is precisely what a vertical box does.
//!
//! ## What this does instead
//!
//! Rearranges the widgets once, into the shape that supports positioning:
//!
//! ```text
//! window
//!  └─ default_vbox (GtkBox)
//!      └─ GtkOverlay          <- inserted here
//!          ├─ main webview    (base child, fills)
//!          └─ browser webview (overlay child, placed by margins)
//! ```
//!
//! A `GtkOverlay` was chosen over a `GtkFixed` because the base child still fills the container on
//! its own. With a `Fixed`, the app's own webview would need an explicit size on every window
//! resize — a second layout to keep in sync, and the first one to go wrong on a maximise.
//!
//! ## What it depends on, and how it will break
//!
//! It depends on Tauri putting webviews in `default_vbox`, which is an internal arrangement rather
//! than a promise. A Tauri upgrade could change it. The failure would be visible immediately — the
//! pane back to full width, exactly as it is today — and [`install`] is written to give up quietly
//! rather than panic if the shape is not what it expects, because a browser in the wrong place is
//! survivable and a crash on launch is not.

use gtk::prelude::*;
use tauri::{Manager, Runtime};

use crate::browser_view::{PaneRect, BROWSER_LABEL};

/// Rearrange the window's widgets so the pane can be positioned. Safe to call more than once.
///
/// Runs on the GTK main thread, which is why it goes through `with_webview` rather than doing the
/// work here: touching a widget from another thread is undefined behaviour, and GTK will not tell
/// you that you did.
pub fn install<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let Some(browser) = app.get_webview(BROWSER_LABEL) else {
        return Err("the browser pane is not open".into());
    };
    browser
        .with_webview(|platform| {
            let child = platform.inner();
            // The vbox is reached through the widget's own parent rather than being captured: GTK
            // types are not `Send`, and `with_webview` requires a `Send` closure.
            let Some(parent) = child.parent() else { return };
            let Ok(vbox) = parent.downcast::<gtk::Box>() else {
                // Already rearranged, or Tauri changed its layout. Nothing safe to do either way.
                return;
            };
            // The app's webview, identified BY TYPE — not as "the one that is not the browser".
            //
            // The vbox holds three things: the menu bar, the app's webview and the browser's. The
            // first version took the first non-browser child and got the MENU BAR, which it then
            // stretched to fill the window while the real app webview stayed behind in the box.
            // The symptom was an app that rendered black with "Edit View Window" floating in the
            // middle of it — a layout so wrong it did not look like a mis-selection at all.
            let child_widget: gtk::Widget = child.clone().upcast();
            let children = vbox.children();
            let Some(base) = children
                .into_iter()
                .find(|w| w != &child_widget && w.type_().name() == "WebKitWebView")
            else {
                // Loud, because the app still runs and looks merely odd. Silence here would leave
                // someone hunting a CSS bug that is not in the CSS.
                eprintln!(
                    "[pane] no WebKitWebView to use as the app surface — Tauri's window layout has \
                     changed. Leaving it alone; the pane will be unpositioned."
                );
                return;
            };

            // Remove both BEFORE adding either: a widget in two containers is a GTK warning and an
            // undefined parent.
            vbox.remove(&base);
            vbox.remove(&child);

            let fixed = gtk::Fixed::new();
            fixed.put(&base, 0, 0);
            fixed.put(&child, 0, 0);
            vbox.pack_start(&fixed, true, true, 0);

            // THE APP FILLS THE WINDOW, always, and the browser sits on top of part of it.
            //
            // This is the whole reason for `Fixed` over `Overlay`. An overlay positions its
            // children by alignment and margins, and on a `WebKitWebView` it honours the size and
            // discards the position — measured, not assumed. `Fixed::move_` takes coordinates and
            // uses them.
            //
            // The cost of `Fixed` is that it gives its children no size at all, so the app's own
            // webview has to be told the container's size on every change. That is this handler,
            // and it is also what makes the app full-height rather than sharing the window with
            // the pane the way the original vertical box did.
            {
                let base = base.clone();
                fixed.connect_size_allocate(move |_, alloc| {
                    base.set_size_request(alloc.width(), alloc.height());
                });
            }

            fixed.show_all();
        })
        .map_err(|e| e.to_string())
}

/// Put the pane at `rect`. Logical pixels, which is what the renderer measures in.
pub fn place<R: Runtime>(app: &tauri::AppHandle<R>, rect: PaneRect) -> Result<(), String> {
    let Some(browser) = app.get_webview(BROWSER_LABEL) else {
        return Ok(());
    };
    let (x, y) = (
        rect.x.round().max(0.0) as i32,
        rect.y.round().max(0.0) as i32,
    );
    let (w, h) = (
        rect.width.round().max(1.0) as i32,
        rect.height.round().max(1.0) as i32,
    );
    browser
        .with_webview(move |platform| {
            let child = platform.inner();
            let Some(fixed) = child.parent().and_then(|p| p.downcast::<gtk::Fixed>().ok()) else {
                // Not rearranged yet, or Tauri's layout changed. Positioning a widget that is not
                // in a `Fixed` silently does nothing, so there is no point pretending otherwise.
                return;
            };
            // Both are needed and neither implies the other: `move_` sets where it goes, and a
            // `Fixed` child takes its size ONLY from its own size request.
            fixed.move_(&child, x, y);
            child.set_size_request(w, h);
        })
        .map_err(|e| e.to_string())
}
