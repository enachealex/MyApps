//! VectorCraft (vector illustration) as a tab of the ArtCraft suite.
//!
//! Adapted from VectorCraft's `apps/vectorcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/vectorcraft): the same app wrapper, services and preferences
//! (`ui.json` and the folders beside it, shared with a standalone VectorCraft); its clipboard,
//! printing and settings-folder modules are used unchanged. The suite provides the window, the GPU
//! device, the log and the title bar, so VectorCraft's own are left out: its adapter selection,
//! restarts on another adapter and first-frame watch (`gpu.rs`, `compositor_gpu.rs`), its logger,
//! its title bar and caption buttons (`custom_titlebar` stays off), the window's placement and
//! size (`window.rs`: the suite's window is never moved for it, nor its geometry saved into
//! VectorCraft's preferences), the X11-through-XWayland switch (`xwayland.rs`), the `--control`
//! automation server and, on macOS, the menu-bar menus, Finder file opens and the early exit before
//! the window is torn down (one window of several apps can't hand the menu bar to one of them, nor
//! end the process for it). Also left out, because they need `unsafe` (which this workspace
//! forbids): the font files VectorCraft adds to its font scans from DirectWrite's system collection
//! on Windows and CoreText's font manager on macOS (`system_fonts.rs`, `mac_fonts.rs`; fonts in the
//! font folders are still found), and the Format menu of macOS save sheets (`mac_save_format.rs`).
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

// VectorCraft's own modules, unchanged. Their tests unwrap, as tests may.
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/vectorcraft/apps/vectorcraft/src/clipboard.rs"]
mod clipboard;
// It picks Windows 7's PowerShell commands under VectorCraft's `windows7` feature, which this
// crate doesn't have.
#[allow(unexpected_cfgs)]
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/vectorcraft/apps/vectorcraft/src/printing.rs"]
mod printing;
#[path = "../../../vendor/vectorcraft/apps/vectorcraft/src/profile.rs"]
mod profile;
mod services;

use std::path::PathBuf;

use vectorcraft_engine::Session;
use vectorcraft_engine::cmd::fileio;
use vectorcraft_engine::file_access;
use vectorcraft_ui_egui::VectorcraftApp;
use vectorcraft_ui_egui::graphics::GraphicsLoss;

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "vectorcraft",
        name: "VectorCraft",
        summary: "Vector illustration",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/vectorcraft.png"),
        // Its own documents and templates (DrawCraft's too, from before the rename), and the vector
        // formats File › Open reads that belong to an illustration app. PDF, bitmaps, Photoshop and
        // DXF files open too, but other apps of the suite own them.
        extensions: &["vectorcraft", "vctemplate", "drawcraft", "svg", "svgz", "ai", "ait", "eps", "emf", "wmf", "afdesign"],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    // File dialogs open over the window, the one thing here that needs the real one.
    let parent = cc.winit_window().cloned();
    Box::new(move |cc| launch(cc, parent, startup))
}

fn launch(cc: &eframe::CreationContext<'_>, parent: services::Parent, startup: craft_suite::Startup) -> Box<dyn eframe::App> {
    let prefs = prefs_enabled() && !startup.no_settings;
    vectorcraft_ui_egui::i18n::detect_system_lang_in_background();
    // VectorCraft's own Fonts folder, which text.addFontFiles copies fonts into, before the first
    // font scan (the app's start). Set with or without `VECTORCRAFT_NO_PREFS`, as in VectorCraft.
    if !startup.no_settings {
        install_fonts();
    }
    let saved = if prefs { read_prefs() } else { None };
    let mut app = VectorcraftApp::new(Session::new(), services::services(parent, cc.egui_ctx.clone()));
    if prefs {
        load_prefs(&mut app, saved);
    }
    // User Defined swatch and graphic style libraries live next to the preferences (whatever
    // `VECTORCRAFT_NO_PREFS` says, as in VectorCraft).
    if !startup.no_settings {
        let swatches = prefs_path().and_then(|p| Some(p.parent()?.join("Swatches").to_string_lossy().to_string()));
        app.session.swatch_libraries.set_user_dir(swatches);
        let styles = prefs_path().and_then(|p| Some(p.parent()?.join("Graphic Styles").to_string_lossy().to_string()));
        app.session.style_libraries.set_user_dir(styles);
    }
    // So do the Libraries panel's libraries and the Data Recovery copies; runs without preferences
    // keep libraries for the session only and make no recovery copies (unless the recoveryFolder
    // preference is set).
    if prefs {
        let libraries = prefs_path().and_then(|p| Some(p.parent()?.join("Libraries").to_string_lossy().to_string()));
        app.session.libraries.set_dir(libraries);
        let recovery = prefs_path().and_then(|p| Some(p.parent()?.join("Data Recovery").to_string_lossy().to_string()));
        app.session.recovery.set_default_folder(recovery);
    }
    let graphics_loss = GraphicsLoss::default();
    if let Some(rs) = &cc.wgpu_render_state {
        let summary = adapter_summary(&rs.adapter.get_info());
        log::info!("VectorCraft renders with {summary}");
        app.graphics_adapter = Some(summary);
        let (loss, ctx) = (graphics_loss.clone(), cc.egui_ctx.clone());
        rs.device.set_device_lost_callback(move |reason, msg| loss.report(&ctx, format!("{reason:?}: {msg}")));
    }
    // The suite draws the title bar: no caption buttons, drag area or resize edges of VectorCraft's.
    app.custom_titlebar = false;
    let files = startup.files.iter().map(|f| f.to_string_lossy().into_owned()).collect();
    file_access::unconfined(|| open_files(&mut app, files));
    Box::new(App { app, graphics_loss, graphics_lost: false, prefs })
}

struct App {
    app: VectorcraftApp,
    /// Reported by wgpu when the window's graphics device is lost (a driver reset).
    graphics_loss: GraphicsLoss,
    /// The graphics device was lost and the unsaved changes are kept for Data Recovery.
    graphics_lost: bool,
    /// Read and save the user's preferences.
    prefs: bool,
}

impl eframe::App for App {
    // Each frame runs unconfined: it is the person at the keyboard's (the automation roots only
    // confine VectorCraft's control channel, which doesn't run here).
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        file_access::unconfined(|| self.logic_frame(ctx));
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        file_access::unconfined(|| self.app.raw_input_hook(raw));
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        file_access::unconfined(|| self.app.ui(ui));
        // Not while a file dialog's sheet has the keyboard: its name field's composition would go.
        #[cfg(target_os = "macos")]
        if !self.app.file_dialog_open() && self.app.take_ime_discard() {
            discard_marked_text();
        }
    }

    fn on_exit(&mut self) {
        if self.prefs {
            file_access::unconfined(|| save_prefs(&self.app));
        }
    }

    /// As the standalone app, built without eframe's persistence: its state is in `ui.json`.
    fn persist_egui_memory(&self) -> bool {
        false
    }
}

impl App {
    fn logic_frame(&mut self, ctx: &egui::Context) {
        if let Some(why) = self.graphics_loss.take() {
            // eframe can't give a window a new device: the user saves and starts again.
            self.graphics_lost = self.app.graphics_lost(&why);
            self.app.status(if self.graphics_lost {
                "The graphics device was lost: unsaved changes are kept for Data Recovery. Save your documents and restart VectorCraft"
            } else {
                "The graphics device was lost: save your documents and restart VectorCraft"
            });
        }
        if self.graphics_lost && ctx.input(|i| i.viewport().close_requested()) {
            // The window can't show the Save Changes question: it closes, and the next launch
            // offers the changes back.
            vectorcraft_ui_egui::background::wait_all(&mut self.app);
            return;
        }
        self.app.logic(ctx);
        if self.app.ui.status == "quit" {
            // File › Quit, or a close once Save Changes was answered for every document: the
            // window closes (the suite asks its other apps first). Once only: should another app
            // keep the window open, showing VectorCraft's tab again mustn't close it.
            self.app.ui.status.clear();
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }
}

/// Open files handed to the app (start-up) as documents. A file that can't be opened is reported
/// to the user and in the log; the others still open.
fn open_files(app: &mut VectorcraftApp, files: Vec<String>) {
    for f in files {
        if let Err(e) = vectorcraft_ui_egui::io::open_reporting(app, &f) {
            log::warn!("vectorcraft: {f}: {e}");
        }
    }
}

/// Tell the macOS input method to drop its composition (the Type tool kept the marked text as
/// typed). winit's IME toggle only clears its own copy, so the IME would type it again.
#[cfg(target_os = "macos")]
fn discard_marked_text() {
    if let Some(mtm) = objc2::MainThreadMarker::new()
        && let Some(ic) = objc2_app_kit::NSTextInputContext::currentInputContext(mtm)
    {
        ic.discardMarkedText();
    }
}

/// Where UI preferences live: ~/Library/Application Support/VectorCraft (macOS),
/// %APPDATA%\VectorCraft (Windows), $XDG_CONFIG_HOME or ~/.config/vectorcraft (Linux), or
/// `VECTORCRAFT_CONFIG_DIR` (`prefs_dir.rs`, which isn't used as is: its test sets the process's
/// Fonts folder, which would race with a settings-free start in the same test process).
fn prefs_path() -> Option<PathBuf> {
    profile::prefs_path(false)
}

/// The same place under the project's former name (DrawCraft): read once if there are no
/// VectorCraft preferences yet, so settings survive the rename.
fn legacy_prefs_path() -> Option<PathBuf> {
    profile::prefs_path(true)
}

/// Have the font scans read VectorCraft's own Fonts folder, next to the settings (`prefs_dir.rs`).
fn install_fonts() {
    if let Some(dir) = prefs_path().and_then(|p| Some(p.parent()?.join("Fonts"))) {
        vectorcraft_text::set_app_font_dir(dir);
    }
}

/// Runs without preferences (`VECTORCRAFT_NO_PREFS`, agents' test runs) neither read nor write them.
fn prefs_enabled() -> bool {
    std::env::var_os("VECTORCRAFT_NO_PREFS").is_none()
}

/// The saved UI preferences.
fn read_prefs() -> Option<vectorcraft_ui_egui::UiState> {
    let bytes = prefs_path().and_then(|p| std::fs::read(p).ok()).or_else(|| legacy_prefs_path().and_then(|p| std::fs::read(p).ok()))?;
    decode_saved_prefs(&bytes)
}

/// Recover only optional persisted docking metadata. Runtime UiState and command decoding
/// remains strict, and an unreadable workspace layout cannot discard unrelated preferences.
fn decode_saved_prefs(bytes: &[u8]) -> Option<vectorcraft_ui_egui::UiState> {
    use serde_json::{Map, Value, json};

    fn recover(object: &mut Map<String, Value>, hidden_key: &str) {
        if let Some(layout) = object.get("docking")
            && serde_json::from_value::<vectorcraft_ui_egui::UiState>(json!({"docking": layout})).is_err()
        {
            object.remove("docking");
        }
        if let Some(hidden) = object.get_mut(hidden_key) {
            if let Value::Object(entries) = hidden {
                entries.retain(|panel, location| serde_json::from_value::<vectorcraft_ui_egui::UiState>(json!({"docking_hidden": {panel: location}})).is_ok());
            } else {
                object.remove(hidden_key);
            }
        }
    }

    let mut value: Value = serde_json::from_slice(bytes).ok()?;
    let object = value.as_object_mut()?;
    recover(object, "docking_hidden");
    if let Some(Value::Array(workspaces)) = object.get_mut("custom_workspaces") {
        for workspace in workspaces {
            if let Some(object) = workspace.as_object_mut() {
                recover(object, "dockingHidden");
            }
        }
    }
    serde_json::from_value(value).ok()
}

fn load_prefs(app: &mut VectorcraftApp, saved: Option<vectorcraft_ui_egui::UiState>) {
    if let Some(ui) = saved {
        app.ui = ui.sanitized();
    }
    vectorcraft_ui_egui::prefs_dialog::restore(app);
}

fn save_prefs(app: &VectorcraftApp) {
    if let Some(p) = prefs_path() {
        let _ = std::fs::create_dir_all(p.parent().unwrap_or(std::path::Path::new(".")));
        let mut ui = app.ui.clone();
        ui.engine_prefs = app.session.prefs.to_json();
        if let Ok(bytes) = serde_json::to_vec_pretty(&ui) {
            // Preferences are best effort: a failed write keeps the previous file.
            let _ = fileio::write_atomic(&p, &bytes);
        }
    }
}

/// "name (backend, kind)" of the adapter the window renders with, for Help › About and bug reports.
fn adapter_summary(info: &eframe::wgpu::AdapterInfo) -> String {
    format!("{} ({:?}, {:?})", info.name.trim(), info.backend, info.device_type)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn the_tool_has_an_icon_and_opens_vector_art() {
        let t = tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"vectorcraft") && t.extensions.contains(&"svg"));
        for e in t.extensions {
            assert_eq!(*e, e.to_ascii_lowercase());
            assert!(fileio::OPEN_EXTS.contains(e), "VectorCraft doesn't open .{e}");
        }
    }

    #[test]
    fn vectorcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&tool(), 30).unwrap();
    }

    /// From VectorCraft's `main.rs`, with the code it tests.
    #[test]
    fn unreadable_saved_docking_keeps_preferences_and_every_workspace() {
        use serde_json::json;
        let mut app = VectorcraftApp::new(Session::new(), Default::default());
        app.run("window.panel.float", json!({"panel":"layers"})).unwrap();
        app.ui.toolbar = false;
        app.ui.engine_prefs = json!({"interfaceLanguage":"fr", "uiBrightness":"light"});
        app.ui.custom_workspaces =
            vec![vectorcraft_ui_egui::workspaces::capture(&app.ui, "Future"), vectorcraft_ui_egui::workspaces::capture(&app.ui, "Valid")];
        let original = serde_json::to_value(&app.ui).unwrap();
        let valid_location = original["docking_hidden"]["layers"].clone();
        assert!(valid_location.is_object());
        for invalid_layout in [json!({"root":{"FutureNode":{}},"floating":[]}), json!(false)] {
            for invalid_hidden in [json!({"layers":{"placement":{"FuturePlacement":{}}},"swatches":valid_location}), json!(["malformed"])] {
                let mut raw = original.clone();
                raw["docking"] = invalid_layout.clone();
                raw["docking_hidden"] = invalid_hidden.clone();
                raw["custom_workspaces"][0]["docking"] = invalid_layout.clone();
                raw["custom_workspaces"][0]["dockingHidden"] = invalid_hidden.clone();
                assert!(serde_json::from_value::<vectorcraft_ui_egui::UiState>(raw.clone()).is_err(), "runtime serde stays strict");
                let loaded = decode_saved_prefs(&serde_json::to_vec(&raw).unwrap()).unwrap();
                assert_eq!(loaded.engine_prefs, app.ui.engine_prefs);
                assert!(!loaded.toolbar);
                assert!(loaded.docking.is_none());
                assert!(!loaded.docking_hidden.contains_key("layers"));
                if invalid_hidden.is_object() {
                    assert_eq!(serde_json::to_value(loaded.docking_hidden.get("swatches")).unwrap(), valid_location);
                } else {
                    assert!(loaded.docking_hidden.is_empty());
                }
                assert_eq!(loaded.custom_workspaces.len(), 2);
                assert_eq!(loaded.custom_workspaces[0].name, "Future");
                assert!(loaded.custom_workspaces[0].docking.is_none());
                assert!(!loaded.custom_workspaces[0].docking_hidden.contains_key("layers"));
                assert_eq!(serde_json::to_value(&loaded.custom_workspaces[1]).unwrap(), original["custom_workspaces"][1]);
            }
        }
        let roundtrip = decode_saved_prefs(&serde_json::to_vec(&original).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(roundtrip).unwrap(), original);
        assert!(decode_saved_prefs(&serde_json::to_vec(&json!({"toolbar":"invalid"})).unwrap()).is_none(), "unrelated fields retain normal strict parsing");
    }
}
