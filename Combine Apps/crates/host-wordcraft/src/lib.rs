//! WordCraft (word processing) as a tab of the ArtCraft suite.
//!
//! Adapted from WordCraft's `apps/wordcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/wordcraft): the same app, services, preferences and user fonts,
//! which it shares with a standalone WordCraft. Its `file_dialogs`, `print` and `animations`
//! modules are used unchanged. The suite provides the window, the GPU device, the log and the
//! title bar, so WordCraft's Windows graphics set-up (`graphics.rs`), logger and panic hook
//! (`logging.rs`) are left out, as are its `--control` automation server, its `--sample` document,
//! the saved window size and position (the suite's window keeps its own; WordCraft's stays as a
//! standalone WordCraft left it) and, on macOS, Finder file opens (`apple_events.rs`) and quitting
//! through `NSApplication` (one window of several apps closes as a whole, and can't hand the menu
//! bar to one of them). WordCraft's title row leaves no room for macOS traffic lights: the suite's
//! title bar is above it.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use std::path::PathBuf;

use serde_json::json;
use wordcraft_engine::Session;
use wordcraft_ui_egui::{Services, UiState, WordApp, paste_picture::ClipboardPicture};

/// WordCraft's own helper modules, under the lints of WordCraft's workspace. A directory module, so
/// that `animations` finds its `animations/desktop.rs` (a `#[path]` file looks for its submodules
/// beside itself).
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/wordcraft/apps/wordcraft/src"]
mod upstream {
    pub mod animations;
    pub mod file_dialogs;
    pub mod print;
}
use upstream::{animations, file_dialogs, print};

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "wordcraft",
        name: "WordCraft",
        summary: "Writing and document design",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/wordcraft.png"),
        extensions: &["docx", "docm", "dotx", "dotm", "doc", "dot", "odt", "rtf", "txt", "md", "markdown", "tex", "latex", "ltx"],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |cc| {
        let prefs = prefs_enabled() && !startup.no_settings;
        if prefs {
            load_user_fonts();
        }
        let (file_dialog, dialogs) = file_dialogs::hook(&cc.egui_ctx);
        let mut app = WordApp::new(Session::new(wordcraft_doc::Document::new()), services(file_dialog, &cc.egui_ctx));
        if prefs {
            load_prefs(&mut app);
        }
        app.integrated_titlebar = false;
        for f in &startup.files {
            let Some(path) = f.to_str() else {
                log::warn!("{}: not a UTF-8 path", f.display());
                continue;
            };
            if let Err(e) = app.run("file.open", json!({"path": path})) {
                log::warn!("{path}: {e}");
            }
        }
        Box::new(App { app, dialogs, prefs, quit_sent: None })
    })
}

struct App {
    app: WordApp,
    /// Shows the file dialogs the app asked for, parented to the window.
    dialogs: file_dialogs::Launcher,
    /// Read and save the user's preferences.
    prefs: bool,
    /// The frame in which a quit (File › Close) asked the window to close.
    quit_sent: Option<u64>,
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.app.logic(ctx);
        self.dialogs.show(frame);
        // The window's close button: with unsaved changes, ask first (`WordApp::close_requested`).
        let closing = ctx.input(|i| i.viewport().close_requested());
        if closing && !self.app.close_requested() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
        } else if self.app.quit_requested && !closing {
            // A quit closes the window, which then asks the other apps in it. Sent once (a
            // standalone WordCraft sends it every frame until the process ends): the suite takes a
            // close requested again while it asks the others as a new round, starting over. If one
            // of them keeps the window open, the quit is cancelled and WordCraft carries on.
            match self.quit_sent {
                None => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    self.quit_sent = Some(ctx.cumulative_frame_nr());
                }
                Some(sent) if ctx.cumulative_frame_nr() > sent + 1 => {
                    self.app.quit_requested = false;
                    self.quit_sent = None;
                }
                Some(_) => {}
            }
        }
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.app.ui(ui);
        self.dialogs.show(frame);
    }

    fn on_exit(&mut self) {
        if self.prefs {
            save_prefs(&self.app);
        }
    }
}

/// `ui.json` in WordCraft's settings folder, shared with a standalone WordCraft.
fn prefs_path() -> Option<PathBuf> {
    wordcraft_control_key::settings_dir().map(|b| b.join("ui.json"))
}

/// `WORDCRAFT_NO_PREFS` runs neither read nor write them, as in WordCraft.
fn prefs_enabled() -> bool {
    std::env::var_os("WORDCRAFT_NO_PREFS").is_none()
}

fn load_prefs(app: &mut WordApp) {
    if let Some(p) = prefs_path()
        && let Ok(bytes) = std::fs::read(&p)
        && let Some(ui) = UiState::from_json(&bytes)
    {
        app.apply_prefs(ui);
    }
}

/// Fonts the user added live in `fonts` in the settings folder: load them, and store fonts added
/// later there.
fn load_user_fonts() {
    let Some(dir) = wordcraft_control_key::settings_dir().map(|d| d.join("fonts")) else { return };
    let (loaded, skipped) = wordcraft_fonts::FontDb::global().load_user_fonts(&dir);
    if !loaded.is_empty() || !skipped.is_empty() {
        log::info!("user fonts: {} loaded, {} skipped from {}", loaded.len(), skipped.len(), dir.display());
    }
}

fn save_prefs(app: &WordApp) {
    if let Some(p) = prefs_path() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(&app.prefs()) {
            let _ = std::fs::write(&p, bytes);
        }
    }
}

/// Native file dialogs, shown without blocking the window (`file_dialogs`), File › Print through
/// the system's PDF viewer (`print`), pictures on the system clipboard, and the system's animation
/// setting (`animations`).
fn services(file_dialog: file_dialogs::Hook, ctx: &egui::Context) -> Services {
    Services {
        file_dialog: Some(file_dialog),
        print: Some(print::hook()),
        clipboard_picture: Some(Box::new(clipboard_picture)),
        animations_enabled: Some(animations::hook(ctx)),
        clipboard_text: Some(Box::new(|| arboard::Clipboard::new().ok()?.get_text().ok())),
        ..Default::default()
    }
}

/// The picture on the system clipboard: copied files, else image pixels. The UI checks the sizes
/// before inserting anything.
fn clipboard_picture() -> Option<ClipboardPicture> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| log::warn!("clipboard: {e}")).ok()?;
    if let Ok(files) = clipboard.get().file_list()
        && !files.is_empty()
    {
        return Some(ClipboardPicture::Files(files));
    }
    let image = clipboard.get_image().ok()?;
    Some(ClipboardPicture::Pixels { width: image.width, height: image.height, rgba: image.bytes.into_owned() })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_documents() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"docx") && t.extensions.contains(&"txt") && t.extensions.contains(&"md"));
        assert!(t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn wordcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }
}
