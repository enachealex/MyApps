//! DesignCraft (page layout and publishing) as a tab of the ArtCraft suite.
//!
//! Adapted from DesignCraft's `apps/designcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/designcraft), with its `profile` module (the settings and
//! recovery folders) used unchanged: the same app, services, preferences and crash recovery,
//! shared with a standalone DesignCraft. The suite provides the window, the GPU device, the log
//! and the title bar, so DesignCraft's own graphics-backend choice with its start-up crash
//! fallback (`gpu.json`), logger and window options are left out, as are its `--control`
//! automation server, `--sample`, the X11 backend it prefers on Linux for file drops, and on
//! macOS its menu-bar menus (the menus stay in the window) and the title bar drawn into its
//! application bar (one window of several apps has one title bar and one menu bar, the suite's).
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

#[path = "../../../vendor/designcraft/apps/designcraft/src/profile.rs"]
mod profile;

use designcraft_engine::Session;
use designcraft_ui_egui::{DesignApp, Services};

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "designcraft",
        name: "DesignCraft",
        summary: "Page layout and publishing",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/designcraft.png"),
        extensions: &["designcraft", "idml"],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |_cc| {
        let mut session = Session::new();
        // Crash recovery: reopen what a previous run left unsaved, then keep it current.
        let recovered = if startup.no_settings {
            None
        } else {
            session.recovery_dir = profile::recovery_dir();
            session.execute("file.recovery.open", &serde_json::json!({})).ok()
        };
        let mut app = DesignApp::new(session, services());
        if let Some(n) = recovered.as_ref().and_then(|r| r["opened"].as_array()).map(Vec::len).filter(|n| *n > 0) {
            app.status(format!("Recovered {n} unsaved document{} from the last session.", if n == 1 { "" } else { "s" }));
        }
        let prefs = prefs_enabled() && !startup.no_settings;
        if prefs {
            load_prefs(&mut app);
        }
        app.integrated_titlebar = false;
        for f in &startup.files {
            let Some(path) = f.to_str() else {
                log::warn!("{}: DesignCraft only opens files whose names are Unicode", f.display());
                continue;
            };
            // A file that can't be opened also gets an alert with the reason.
            if let Err(e) = app.open_file("file.open", serde_json::json!({"path": path})) {
                log::warn!("{path}: {e}");
            }
        }
        Box::new(App { app, prefs })
    })
}

struct App {
    app: DesignApp,
    /// Read and save the user's preferences.
    prefs: bool,
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.app.logic(ctx);
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.app.ui(ui);
    }

    fn on_exit(&mut self) {
        if self.prefs {
            save_prefs(&self.app);
        }
    }
}

/// `DESIGNCRAFT_NO_PREFS` reads and writes nothing in the settings directory, as in DesignCraft.
fn prefs_enabled() -> bool {
    std::env::var_os("DESIGNCRAFT_NO_PREFS").is_none()
}

fn prefs_path() -> Option<std::path::PathBuf> {
    profile::config_dir().map(|b| b.join("ui.json"))
}

fn load_prefs(app: &mut DesignApp) {
    if let Some(p) = prefs_path()
        && let Ok(bytes) = std::fs::read(&p)
        && let Ok(ui) = designcraft_ui_egui::UiState::from_preferences_json(&bytes)
    {
        app.ui = ui;
    }
    // Engine preferences (Preferences dialog, favourites…) live beside the UI state.
    if let Some(p) = prefs_path().map(|p| p.with_file_name("prefs.json"))
        && let Ok(bytes) = std::fs::read(&p)
        && let Ok(prefs) = serde_json::from_slice::<designcraft_engine::Prefs>(&bytes)
    {
        app.session.prefs = prefs;
    }
}

fn save_prefs(app: &DesignApp) {
    if let Some(p) = prefs_path() {
        let _ = std::fs::create_dir_all(p.parent().unwrap_or(std::path::Path::new(".")));
        if let Ok(bytes) = serde_json::to_vec_pretty(&app.ui) {
            let _ = std::fs::write(&p, bytes);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(&app.session.prefs) {
            let _ = std::fs::write(p.with_file_name("prefs.json"), bytes);
        }
    }
}

/// One file-type row in an open dialog. `open_filters` is what `pick_open` applies.
struct OpenFilter {
    name: &'static str,
    extensions: &'static [&'static str],
}

fn open_filters(purpose: &str) -> &'static [OpenFilter] {
    match purpose {
        "swatches" => &[OpenFilter { name: "Swatch Exchange (ASE)", extensions: &["ase"] }],
        "script" => &[OpenFilter { name: "Script", extensions: &["dcscript", "txt", "json"] }],
        "icc" => &[OpenFilter { name: "ICC profile", extensions: &["icc", "icm"] }],
        "book" => &[OpenFilter { name: "Book", extensions: &["dcbook"] }],
        "xml" => &[OpenFilter { name: "XML", extensions: &["xml"] }],
        "library" => &[OpenFilter { name: "Object Library", extensions: &["dclib"] }],
        "dataMerge" => &[OpenFilter { name: "Data source (CSV, TSV, text, Excel)", extensions: &["csv", "tsv", "tab", "txt", "xlsx"] }],
        "place" => &[
            OpenFilter {
                name: "Graphics and text",
                extensions: &[
                    "png",
                    "jpg",
                    "jpeg",
                    "gif",
                    "webp",
                    "tif",
                    "tiff",
                    "bmp",
                    "psd",
                    "svg",
                    "pdf",
                    "ai",
                    "eps",
                    "txt",
                    "docx",
                    "rtf",
                    "md",
                    "xlsx",
                    "idml",
                    "designcraft",
                    "mp4",
                    "m4v",
                    "mov",
                    "webm",
                    "mp3",
                    "m4a",
                    "wav",
                    "ogg",
                ],
            },
            OpenFilter { name: "Graphics", extensions: &["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp", "psd", "svg", "pdf", "ai", "eps"] },
            OpenFilter { name: "Text (Word, RTF, plain, Excel)", extensions: &["docx", "rtf", "txt", "md", "xlsx"] },
            OpenFilter { name: "Video and sound", extensions: &["mp4", "m4v", "mov", "webm", "mp3", "m4a", "wav", "ogg"] },
        ],
        _ => &[
            OpenFilter { name: "DesignCraft or IDML", extensions: &["designcraft", "idml"] },
            OpenFilter { name: "DesignCraft", extensions: &["designcraft"] },
            OpenFilter { name: "InDesign Markup (IDML)", extensions: &["idml"] },
        ],
    }
}

fn services() -> Services {
    Services {
        pick_open: Some(Box::new(|purpose: &str| {
            let mut dialog = rfd::FileDialog::new();
            for filter in open_filters(purpose) {
                dialog = dialog.add_filter(filter.name, filter.extensions);
            }
            dialog.pick_file().map(|p| p.to_string_lossy().to_string())
        })),
        pick_save: Some(Box::new(|name: &str| rfd::FileDialog::new().set_file_name(name).save_file().map(|p| p.to_string_lossy().to_string()))),
        read: Some(Box::new(|p: &str| std::fs::read(p).map_err(|e| e.to_string()))),
        write: Some(Box::new(|p: &str, b: &[u8]| std::fs::write(p, b).map_err(|e| e.to_string()))),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_layouts() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"designcraft") && t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn designcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }
}
