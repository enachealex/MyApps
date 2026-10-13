//! EffectCraft (motion graphics and visual effects) as a tab of the ArtCraft suite.
//!
//! Adapted from EffectCraft's `apps/effectcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/effectcraft), with its `appearance`, `audio_out` and (macOS)
//! `sheet_dialogs` modules used unchanged: the same session, settings, shortcut presets, effect
//! plug-ins, crash recovery, audio preview and file dialogs, shared with a standalone EffectCraft.
//! The suite provides the window, the GPU device, the log and the title bar, so EffectCraft's own
//! window options, device limits and launch guard (which switches Window Graphics to OpenGL after
//! a launch that stopped as its window opened) are left out, as are its logger and panic hook
//! (Help ▸ Enable Logging writes through that logger, so it writes nothing here), its `--control`
//! automation server, on Linux the AppImage desktop entry that names the window's icon, and on
//! macOS its menu-bar menus, Finder file opens and App Nap opt-out (one window of several apps
//! can't hand the menu bar to one of them; EffectCraft's in-window menu bar shows instead).
//!
//! The numeric scrubbing that wraps the pointer at the monitor's edge needs the real window; it
//! gets it from the [`eframe::Frame`] each frame, so nothing is needed from the window at start.
//! EffectCraft's first frame maximizes a window that doesn't fit the screen (`fit_window`); it has
//! no switch, so the suite's window gets the same treatment when EffectCraft is first shown.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

// Their tests unwrap, as EffectCraft's clippy.toml allows in tests.
#[cfg_attr(test, allow(clippy::unwrap_used))]
#[path = "../../../vendor/effectcraft/apps/effectcraft/src/appearance.rs"]
mod appearance;
#[cfg_attr(test, allow(clippy::unwrap_used))]
#[path = "../../../vendor/effectcraft/apps/effectcraft/src/audio_out.rs"]
mod audio_out;
#[cfg(target_os = "macos")]
#[path = "../../../vendor/effectcraft/apps/effectcraft/src/sheet_dialogs.rs"]
mod sheet_dialogs;

use std::path::PathBuf;
use std::sync::Arc;

use effectcraft_ui_egui::EffectcraftApp;
use effectcraft_ui_egui::gpu_failure::GpuFailureBridge;
use serde_json::json;

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "effectcraft",
        name: "EffectCraft",
        summary: "Motion graphics and visual effects",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/effectcraft.png"),
        extensions: &["ecproj", "ecprojx"],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |cc| {
        // The font menus list the installed fonts: read their names in the background.
        effectcraft_engine::text::fonts::scan_system_in_background();
        match &cc.wgpu_render_state {
            Some(rs) => log::info!("EffectCraft graphics: {:?}", rs.adapter.get_info()),
            None => log::info!("EffectCraft graphics: no wgpu device"),
        }
        // EffectCraft's compositor reports the device's errors and loss through this bridge
        // (falling back to the CPU, or closing after a lost device). Installed before its
        // pipelines are built, as main.rs does.
        let gpu_failures = GpuFailureBridge::new(&cc.egui_ctx);
        if let Some(rs) = &cc.wgpu_render_state {
            let errors = gpu_failures.clone();
            rs.device.on_uncaptured_error(Arc::new(move |error| {
                let message = format!("uncaptured GPU error: {error}");
                if errors.report(&message, false) {
                    log::error!("{message}");
                }
            }));
            let lost = gpu_failures.clone();
            rs.device.set_device_lost_callback(move |reason, message| {
                lost.report(&format!("GPU device lost ({reason:?}): {message}"), true);
            });
        }
        let mut session = effectcraft_host::session();
        // Lazy open and non-blocking auto-save: footage is checked and auto-saves are written on
        // background threads.
        session.check_footage_on_open = true;
        session.autosave.background = true;
        // Settings, shortcut presets, workspaces, templates, scripts, plug-ins and the
        // crash-recovery sentinel live in the config directory. Without one the session keeps
        // them in memory only; installed Roto Brush models and auto-saves of untitled projects
        // live beside it, so they go too, and auto-saves go to a folder of this run's.
        let config_dir = if startup.no_settings {
            session.models_dir = None;
            session.autosave_folder_override = Some(no_settings_dir());
            None
        } else {
            effectcraft_host::config_dir()
        };
        if let Some(dir) = config_dir {
            // WebAssembly effect plug-ins in <config>/Plug-ins load before the menus are built.
            let plugins = dir.join("Plug-ins");
            if plugins.is_dir() {
                let _ = session.execute("effect.plugins.load", json!({"folder": plugins.to_string_lossy()}));
            }
            session.config = Some(Arc::new(effectcraft_engine::config::DirConfig::new(dir)));
        }
        session.load_settings();
        let recovery = session.begin_recovery();
        let files: Vec<String> = startup.files.iter().map(|f| f.to_string_lossy().into_owned()).collect();
        if let Some(p) = files.iter().find(|f| is_project_file(f))
            && let Err(e) = session.execute("file.open", json!({"path": p}))
        {
            log::warn!("EffectCraft: {e}");
        }
        let media: Vec<&String> = files.iter().filter(|f| !is_project_file(f)).collect();
        if !media.is_empty()
            && let Err(e) = session.execute("file.import", json!({"paths": media}))
        {
            log::warn!("EffectCraft: {e}");
        }
        let show_home = session.prefs.startup.show_home_on_launch && files.is_empty();
        // The ScriptUI panels open when the app last quit open again (a failing one is reported
        // in a toast and forgotten).
        let _ = session.execute("window.restoreScriptPanels", json!({}));
        let mut app = EffectcraftApp::new(session);
        app.set_gpu_failure_bridge(gpu_failures);
        app.ui.start_screen = show_home;
        if let Some(r) = recovery {
            app.offer_recovery(r);
        }
        #[cfg(target_os = "linux")]
        if let Some(note) = wayland_drop_notice(std::env::var_os("WAYLAND_DISPLAY").as_deref(), std::env::var_os("WINIT_UNIX_BACKEND").as_deref())
            && app.ui.status.is_empty()
        {
            app.ui.status = note.into();
        }
        install_hooks(&mut app, &cc.egui_ctx);
        Box::new(Desktop { app, drawn: false })
    })
}

/// The file dialogs, system appearance, audio output and lost-device notice, as main.rs sets them.
fn install_hooks(app: &mut EffectcraftApp, ctx: &egui::Context) {
    app.hooks.pick_files = Some(Box::new(|exts: &[&str]| {
        rfd::FileDialog::new().add_filter("Media", exts).pick_files().unwrap_or_default().into_iter().map(|p| p.to_string_lossy().to_string()).collect()
    }));
    app.hooks.pick_save = Some(Box::new(|name: &str| {
        rfd::FileDialog::new().add_filter("EffectCraft Project", &["ecproj"]).set_file_name(name).save_file().map(|p| p.to_string_lossy().to_string())
    }));
    // The window closes after a lost graphics device; say why.
    app.hooks.device_lost = Some(Box::new(|saved: Option<Result<String, String>>| {
        let saved = match saved {
            Some(Ok(path)) => format!("\n\nYour unsaved changes were saved to:\n{path}\n\nReopen EffectCraft to recover them."),
            Some(Err(e)) => format!("\n\nYour unsaved changes could not be saved ({e})."),
            None => String::new(),
        };
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("EffectCraft: graphics device lost")
            .set_description(format!("The graphics driver stopped responding, so EffectCraft has to close.{saved}"))
            .show();
    }));
    app.hooks.pick_open_project = Some(Box::new(|| {
        rfd::FileDialog::new().add_filter("EffectCraft Project", &["ecproj", "ecprojx"]).pick_file().map(|p| p.to_string_lossy().to_string())
    }));
    app.hooks.system_theme = appearance::service();
    app.hooks.audio_device = Some(Box::new(audio_out::open));
    app.hooks.audio_devices = Some(Box::new(audio_out::devices));
    app.hooks.pick_folder = Some(Box::new(|| rfd::FileDialog::new().pick_folder().map(|p| p.to_string_lossy().to_string())));
    app.hooks.pick_save_file = Some(Box::new(|name: &str, ext: &str| {
        // A default with a folder that exists opens the dialog there.
        let path = std::path::Path::new(name);
        // (No filter for a name without an extension, such as a folder to create.)
        let mut d = if ext.is_empty() { rfd::FileDialog::new() } else { rfd::FileDialog::new().add_filter(ext, &[ext]) };
        if let Some(dir) = path.parent().filter(|d| d.is_dir()) {
            d = d.set_directory(dir);
        }
        let file = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        d.set_file_name(file).save_file().map(|p| p.to_string_lossy().to_string())
    }));
    #[cfg(target_os = "macos")]
    {
        // The commands' file dialogs open as sheets instead of nested modal loops.
        let ctx = ctx.clone();
        app.hooks.file_dialog_async = Some(Box::new(move |dialog, done| sheet_dialogs::show(dialog, done, ctx.clone())));
        app.hooks.app_action = Some(Box::new(app_action));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = ctx;
}

/// Both native JSON projects and Save a Copy As XML projects are openable on launch (main.rs).
fn is_project_file(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("ecproj") || ext.eq_ignore_ascii_case("ecprojx"))
}

/// winit 0.30 cannot deliver native Wayland file drops. XWayland can. (main.rs)
#[cfg(target_os = "linux")]
fn wayland_drop_notice(wayland_display: Option<&std::ffi::OsStr>, backend: Option<&std::ffi::OsStr>) -> Option<&'static str> {
    (wayland_display.is_some_and(|v| !v.is_empty()) && backend != Some(std::ffi::OsStr::new("x11")))
        .then_some("Native Wayland file drops are unavailable. Use File ▸ Import ▸ File… or run via XWayland (see README, Linux).")
}

/// macOS application actions for app ▸ Hide EffectCraft / Hide Others / Show All (from
/// `native_menu.rs`, whose menu bar is left out).
#[cfg(target_os = "macos")]
fn app_action(id: &str) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    let Some(mtm) = MainThreadMarker::new() else { return false };
    let app = NSApplication::sharedApplication(mtm);
    match id {
        "app.hide" => app.hide(None),
        "app.hideOthers" => app.hideOtherApplications(None),
        "app.showAll" => app.unhideAllApplications(None),
        _ => return false,
    }
    true
}

/// Where this run's auto-saves go with `no_settings`.
fn no_settings_dir() -> PathBuf {
    std::env::temp_dir().join(format!("craft-suite-effectcraft-{}", std::process::id()))
}

/// main.rs's `Desktop`, without what the suite owns (menu bar, Apple events, launch guard).
struct Desktop {
    app: EffectcraftApp,
    /// The first frame was drawn (logged once).
    drawn: bool,
}

impl eframe::App for Desktop {
    fn logic(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.app.logic(ctx, frame);
    }

    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.app.ui(ui, frame);
        if !self.drawn {
            self.drawn = true;
            log::info!("EffectCraft: first frame drawn");
        }
    }

    fn on_exit(&mut self) {
        self.app.on_exit();
    }

    fn raw_input_hook(&mut self, ctx: &egui::Context, raw_input: &mut egui::RawInput) {
        self.app.raw_input_hook(ctx, raw_input);
    }

    /// EffectCraft's eframe keeps no state between runs (it has no persistence): its own settings
    /// and workspaces restore it.
    fn persist_egui_memory(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_projects() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"ecproj") && t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn effectcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }

    #[test]
    fn projects_open_and_everything_else_imports() {
        for path in ["Copy.ecprojx", "/tmp/Scene.ecproj", "C:\\work\\Shot.ECPROJX"] {
            assert!(super::is_project_file(path), "{path}");
        }
        for path in ["scene.ecprojx.png", "scene.mp4", "scene", "copy.ecprojx.bak"] {
            assert!(!super::is_project_file(path), "{path}");
        }
    }
}
