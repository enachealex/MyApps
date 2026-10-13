//! CADCraft (computer-aided design and drafting) as a tab of the ArtCraft suite.
//!
//! Adapted from CADCraft's `apps/cadcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/cadcraft), with its `desktop_theme`, `spacemouse` and `workspace`
//! modules used unchanged: the same app, file formats, workspace (`workspace.json`, shared with a
//! standalone CADCraft), autosave and Drawing Recovery, 3D mouse and desktop theme. The suite
//! provides the window, the GPU device, the log and the title bar, so CADCraft's own window
//! options, present mode (`CADCRAFT_VSYNC`; the suite's window presents with vsync, so CADCraft's
//! frame cap for presenting without it isn't needed), device limits (the suite asks for all the
//! adapter offers, which covers CADCraft's larger buffers), Windows graphics set-up
//! (`graphics.rs`), XWayland event loop on Linux, and logger are left out, as are its
//! `--control` automation server and `--sample` option and, on macOS, its menu-bar menus and the
//! title bar drawn into its window (one window of several apps has one title bar and can't hand the
//! menu bar to one of them; CADCraft's in-window menu bar shows instead).
//!
//! CADCraft keeps its Options profile, theme, language, save format and autosave settings in
//! eframe storage, which in the suite is CADCraft's own store in the suite's settings folder. It
//! starts as a copy of a standalone CADCraft's `app.ron` (`Tool::standalone_storage`), and is the
//! suite's from then on.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

// Their tests unwrap, as CADCraft's clippy.toml allows in tests.
#[cfg_attr(test, allow(clippy::unwrap_used))]
#[path = "../../../vendor/cadcraft/apps/cadcraft/src/desktop_theme.rs"]
mod desktop_theme;
#[cfg_attr(test, allow(clippy::unwrap_used))]
#[path = "../../../vendor/cadcraft/apps/cadcraft/src/workspace.rs"]
mod workspace;
// `spacemouse.rs` has a module of its own (`spacemouse/motion.rs`), which a `#[path]` file would
// look for beside it; declared from its folder, it is found where it is.
#[path = "../../../vendor/cadcraft/apps/cadcraft/src"]
mod upstream {
    pub mod spacemouse;
}
use upstream::spacemouse;

use std::path::PathBuf;

use cadcraft_engine::Session;
use cadcraft_ui_egui::{CadApp, Services, i18n};

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "cadcraft",
        name: "CADCraft",
        summary: "Computer-aided design and drafting",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/cadcraft.png"),
        // Its drawings and templates (it also reads SVG, which belongs to the vector apps).
        extensions: &["dwg", "dxf", "dwt"],
        prepare,
        // Its Options profile, theme, language, save format and autosave settings live in its eframe
        // storage, which eframe keeps under its app id.
        standalone_storage: Some(|| eframe::storage_dir("ai.storyteller.cadcraft").map(|d| d.join("app.ron"))),
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |cc| {
        install_io();
        let mut app = CadApp::new(Session::empty(), services());
        let (workspace, workspace_error) = if startup.no_settings {
            (None, None)
        } else {
            let (workspace, restored, workspace_error) = workspace::Workspace::load();
            if let Some(ui) = restored {
                app.ui = ui;
            }
            if let Some(error) = &workspace_error {
                log::warn!("CADCraft workspace: {error}");
                app.set_status(error);
            }
            (Some(workspace), workspace_error)
        };
        app.system_languages = std::env::var("CADCRAFT_LOCALE").map(|s| vec![s]).unwrap_or_else(|_| sys_locale::get_locales().collect());
        // The user profile (Options): drafting settings, selection sizes, drawing-area colours.
        // (With `no_settings` the suite's store for CADCraft starts empty and is never written.)
        if let Some(profile) = cc.storage.and_then(|s| s.get_string(cadcraft_ui_egui::options::PROFILE_KEY)) {
            app.load_profile(&profile);
        }
        if let Some(prefs) = cc.storage.and_then(|s| s.get_string(cadcraft_ui_egui::PREFS_KEY)) {
            app.load_prefs(&prefs);
        }
        if let Some(prefs) = cc.storage.and_then(|s| s.get_string(cadcraft_ui_egui::autosave::PREFS_KEY)) {
            cadcraft_ui_egui::autosave::load_prefs(&prefs);
        }
        // Autosave files (SAVEFILEPATH) default to `<settings dir>/autosave`; with `no_settings`,
        // to a folder of this run's.
        let dir = if startup.no_settings { Some(no_settings_dir()) } else { config_dir() };
        if let Some(dir) = dir {
            app.enable_autosave(&dir.join("autosave"));
        }
        // No menu bar of its own on macOS in the suite: the in-window one.
        if cfg!(target_os = "macos") {
            app.ui.in_window_menu = true;
        }
        if let Some(rs) = &cc.wgpu_render_state {
            app.set_wgpu(rs);
        }
        for f in &startup.files {
            app.open_path(&f.to_string_lossy());
        }
        if app.session.docs.is_empty() {
            app.session.new_drawing(false);
        }
        let ctx = cc.egui_ctx.clone();
        let desktop_theme = desktop_theme::DesktopTheme::start(move || ctx.request_repaint());
        Box::new(App { desktop_theme, cad: app, spacemouse: spacemouse::SpaceMouse::start(cc.egui_ctx.clone()), workspace, workspace_error })
    })
}

/// main.rs's `App`, without the macOS menu bar.
struct App {
    cad: CadApp,
    spacemouse: spacemouse::SpaceMouse,
    /// The desktop's light/dark choice where winit reports none (Linux, the BSDs).
    desktop_theme: desktop_theme::DesktopTheme,
    /// `None` with `no_settings`: `workspace.json` is neither read nor written.
    workspace: Option<workspace::Workspace>,
    workspace_error: Option<String>,
}

impl App {
    fn persist_workspace(&mut self, final_attempt: bool) {
        let Some(workspace) = &mut self.workspace else { return };
        let result = if final_attempt { workspace.save_on_exit(&self.cad.ui) } else { workspace.save_if_changed(&self.cad.ui) };
        if let Err(error) = result {
            if self.workspace_error.as_ref() != Some(&error) {
                log::warn!("CADCraft workspace: {error}");
                self.cad.set_status(format!("Workspace could not be saved: {error}"));
                self.workspace_error = Some(error);
            }
        } else {
            self.workspace_error = None;
        }
    }
}

/// View ▸ Theme ▸ System resolves against `raw.system_theme`, which winit leaves empty on Linux
/// and the BSDs: the desktop's answer, where it gives one, stands in for it.
fn follow_desktop(raw: &mut egui::RawInput, desktop: Option<egui::Theme>) {
    if desktop.is_some() {
        raw.system_theme = desktop;
    }
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.cad.logic(ctx);
        self.spacemouse.poll(&mut self.cad, ctx);
        self.persist_workspace(false);
        if std::mem::take(&mut self.cad.quit_requested) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }

    fn raw_input_hook(&mut self, ctx: &egui::Context, raw: &mut egui::RawInput) {
        follow_desktop(raw, self.desktop_theme.current());
        self.cad.raw_input_hook(raw);
        cadcraft_ui_egui::cmdline::capture_tab(ctx, raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.cad.ui(ui);
        self.persist_workspace(false);
    }

    /// A normal exit: the workspace is saved, and this run's autosave files are not needed (a
    /// crash leaves them for recovery).
    fn on_exit(&mut self) {
        self.persist_workspace(true);
        self.cad.shutdown_autosave();
    }

    /// Preferences (the interface theme) survive restarts; window and egui state are not kept.
    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        storage.set_string(cadcraft_ui_egui::options::PROFILE_KEY, self.cad.profile_json());
        storage.set_string(cadcraft_ui_egui::PREFS_KEY, self.cad.prefs_json());
        storage.set_string(cadcraft_ui_egui::autosave::PREFS_KEY, cadcraft_ui_egui::autosave::prefs_json());
    }

    fn persist_egui_memory(&self) -> bool {
        false
    }
}

/// File format hooks for the engine (it stays I/O-agnostic). From main.rs.
fn install_io() {
    cadcraft_engine::cmd::file::set_io(cadcraft_engine::cmd::file::IoHooks {
        read: |b, name| cadcraft_io::read(b, name).map_err(|e| e.to_string()),
        write: |d, name| cadcraft_io::write(d, name).map_err(|e| e.to_string()),
        plot: Some(|d, space, opts| cadcraft_io::plotter::plot(d, space, opts).map_err(|e| e.to_string())),
    });
    cadcraft_engine::cmd::file::set_write_as(|d, name, o| {
        cadcraft_io::write_with(d, name, &cadcraft_io::SaveOptions { version: o.version, binary: o.binary }).map_err(|e| e.to_string())
    });
}

fn services() -> Services {
    Services {
        pick_open: Some(Box::new(|| {
            rfd::FileDialog::new()
                .add_filter(i18n::t("Drawings (DWG, DXF)"), &["dwg", "dxf", "dwt"])
                .add_filter(i18n::t("SVG drawings (SVG, SVGZ)"), &["svg", "svgz"])
                .add_filter(i18n::t("All files"), &["*"])
                .pick_file()
                .map(|p| p.to_string_lossy().to_string())
        })),
        pick_save: Some(Box::new(|name: &str| {
            filters_for_save(name)
                .iter()
                .fold(rfd::FileDialog::new().set_file_name(name), |d, (label, ext)| d.add_filter(i18n::t(label), &[*ext]))
                .save_file()
                .map(|p| p.to_string_lossy().to_string())
        })),
    }
}

/// File types for the Save dialog, the suggested name's type first: Windows adds the first
/// filter's extension, and macOS accepts only listed extensions, replacing any other with the
/// first one. DWG must be listed for a `.dwg` name to survive, and a drawing opened from DWG
/// then defaults to DWG; other names keep DXF first. From main.rs.
fn filters_for_save(name: &str) -> [(&'static str, &'static str); 6] {
    let mut filters = [("Drawing (DXF)", "dxf"), ("Drawing (DWG)", "dwg"), ("Drawing Template (DWT)", "dwt"), ("SVG", "svg"), ("PNG", "png"), ("PDF", "pdf")];
    let lower = name.to_ascii_lowercase();
    filters.sort_by_key(|(_, ext)| !lower.ends_with(&format!(".{ext}")));
    filters
}

/// The per-user settings directory (it holds `autosave/`): `CADCRAFT_CONFIG_DIR` if set, else
/// `$XDG_CONFIG_HOME/cadcraft` or `~/.config/cadcraft` on Linux and the BSDs,
/// `~/Library/Application Support/CADCraft` on macOS, `%APPDATA%\CADCraft` on Windows. From main.rs.
fn config_dir() -> Option<PathBuf> {
    let set = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if let Some(dir) = set("CADCRAFT_CONFIG_DIR") {
        return Some(dir);
    }
    if cfg!(target_os = "macos") {
        set("HOME").map(|h| h.join("Library/Application Support/CADCraft"))
    } else if cfg!(windows) {
        set("APPDATA").map(|a| a.join("CADCraft"))
    } else {
        // The XDG spec ignores a relative XDG_CONFIG_HOME.
        set("XDG_CONFIG_HOME").filter(|p| p.is_absolute()).or_else(|| set("HOME").map(|h| h.join(".config"))).map(|c| c.join("cadcraft"))
    }
}

/// The autosave folder's parent with `no_settings`: this run's own.
fn no_settings_dir() -> PathBuf {
    std::env::temp_dir().join(format!("craft-suite-cadcraft-{}", std::process::id()))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_drawings() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"dwg") && t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn cadcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }

    #[test]
    fn save_dialog_offers_the_drawing_format_first() {
        let first = |name: &str| super::filters_for_save(name)[0].1;
        assert_eq!(first("FLOORPLAN.DWG"), "dwg");
        assert_eq!(first("Drawing1"), "dxf");
        assert_eq!(first("office.dwt"), "dwt");
    }
}
