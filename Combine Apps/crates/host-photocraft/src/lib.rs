//! PhotoCraft (image editing) as a tab of the ArtCraft suite.
//!
//! Adapted from PhotoCraft's `apps/photocraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/photocraft): the same app, services, preferences, brush presets and
//! crash recovery, which it shares with a standalone PhotoCraft (its settings folder, portable mode
//! included). PhotoCraft's helper modules for the settings folder, the pointer position of file
//! drops, Caps Lock, the screen colour picker, display profiles, pen tablets, the desktop theme and
//! Photoshop's shortcuts are used unchanged; `services.rs` is adapted (see there).
//!
//! The suite provides the window, the GPU device, the log and the title bar, so left out are:
//! PhotoCraft's crash-safe GPU start-up (`gpu_startup.rs`: backend plan, marker file, relaunch in
//! CPU mode, `--safe-gpu`), its logger and panic hook, the `--control` automation server, its own
//! title bar with caption buttons and the borderless-frame fix that goes with it
//! (`custom_titlebar`, `window_frame.rs`), the check of the saved window layout (`ui_state.rs`; the
//! suite keeps the layout), the choice of display server on Linux and, on macOS, the menu-bar menus,
//! Finder file opens and quitting through AppKit (one window of several apps can't hand the menu
//! bar to one of them, so the menus stay in the window).
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

mod services;

/// PhotoCraft's own helper modules, unchanged. Some of what they offer served only main.rs's
/// parts the suite leaves out (the panic hook, picking the display server, the start-up library
/// check on Linux), hence `dead_code`.
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[allow(dead_code)]
#[path = "../../../vendor/photocraft/apps/photocraft/src"]
mod upstream {
    pub mod app_dirs;
    pub mod appearance;
    pub mod caps_lock;
    pub mod crash_guard;
    pub mod cursor;
    pub mod file_dialog_probe;
    // As in main.rs: the pure logic is tested on every platform.
    #[cfg(any(target_os = "linux", test))]
    pub mod linux_libs;
    pub mod monitor_profile;
    pub mod photoshop_settings;
    pub mod screen_color;
    #[cfg(any(target_os = "macos", target_os = "linux", test))]
    pub mod tablet;
}
#[cfg(any(target_os = "linux", test))]
use upstream::linux_libs;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use upstream::tablet;
use upstream::{app_dirs, appearance, caps_lock, crash_guard, cursor, file_dialog_probe, monitor_profile, photoshop_settings, screen_color};

/// `app_dirs`' tests name the GPU start-up marker of `gpu_startup.rs`, which the suite leaves out.
#[cfg(test)]
mod gpu_startup {
    pub const MARKER_FILE: &str = "gpu-starting.json";
}

use photocraft_engine::Session;
use photocraft_engine::prefs::RenderingMode;
use photocraft_ui_egui::PhotocraftApp;

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "photocraft",
        name: "PhotoCraft",
        summary: "Image editing",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/photocraft.png"),
        // Its documents, Photoshop's and Affinity Photo's, flat images, and Photoshop brushes,
        // gradients, swatches and shortcut sets. Raw photos are LightCraft's, SVG VectorCraft's.
        extensions: &[
            "pcraft", "psd", "psb", "psdt", "pdn", "ora", "afphoto", "af", "png", "jpg", "jpeg", "tif", "tiff", "webp", "gif", "bmp", "tga", "ico", "qoi",
            "exr", "hdr", "pbm", "pgm", "ppm", "pam", "pfm", "fits", "fit", "fts", "abr", "grd", "aco", "kys",
        ],
        prepare,
        // Its window and panel layout (eframe persistence, `ui.ron` in its settings folder).
        standalone_storage: Some(|| services::config_dir().map(|d| d.join("ui.ron"))),
    }
}

/// The services that need the window itself, built while it opens.
struct WindowServices {
    /// Where file drags and drops are (winit 0.30 doesn't say).
    cursor_pos: Option<photocraft_ui_egui::CursorPosFn>,
    /// Caps Lock state (X11/Windows/macOS; `None` on native Wayland): the canvas shows the precise
    /// crosshair for painting tools while it is toggled on (#1758).
    caps_lock: Option<photocraft_ui_egui::CapsLockFn>,
    screen_pick: Option<photocraft_ui_egui::screen_picker::Service>,
    /// The window is connected directly to a Wayland compositor.
    is_wayland: bool,
    #[cfg(target_os = "linux")]
    display: Option<tablet::DisplayKind>,
}

fn prepare(cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    #[cfg(target_os = "linux")]
    let display = tablet::DisplayKind::of(cc);
    #[cfg(target_os = "linux")]
    let is_wayland = display == Some(tablet::DisplayKind::Wayland);
    #[cfg(not(target_os = "linux"))]
    let is_wayland = false;
    let window = WindowServices {
        cursor_pos: cursor::service(cc),
        caps_lock: caps_lock::service(cc),
        screen_pick: screen_color::service(cc, is_wayland),
        is_wayland,
        #[cfg(target_os = "linux")]
        display,
    };
    Box::new(move |cc| Box::new(launch(cc, startup, window)))
}

fn launch(cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup, window: WindowServices) -> App {
    // The system font scan can take seconds (minutes on some Macs): run it off the UI thread.
    photocraft_ui_egui::type_tool::warm_fonts();
    let config = if startup.no_settings { None } else { services::config_dir() };
    // Read the displays' ICC profiles while the app is built (colour-managed canvas; `None` where
    // the platform has no reader). On Linux, only for an X11 session (see `monitor_profile`).
    #[cfg(target_os = "linux")]
    let native_session = linux_libs::session_from_env(|name| std::env::var(name).ok());
    #[cfg(target_os = "linux")]
    let monitor = monitor_profile::detect_async_for_session(native_session);
    #[cfg(not(target_os = "linux"))]
    let monitor = monitor_profile::detect_async();
    let mut services = services::native(config.as_deref());
    // Brush presets load in the background; the app attaches them when they arrive.
    services.preset_store = config.as_deref().map(|dir| photocraft_engine::preset_store::open_dir_async(services::presets_dir(dir)));
    services.is_wayland = window.is_wayland;
    #[cfg(target_os = "linux")]
    {
        file_dialog_probe::start();
        if services.is_wayland {
            let var = |name| std::env::var(name).ok();
            let exe = std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned());
            services.xwayland_command =
                services::xwayland_command(var("FLATPAK_ID").as_deref(), var("APPIMAGE").as_deref(), exe.as_deref(), std::env::var_os("DISPLAY").is_some());
        }
    }
    let mut app = PhotocraftApp::new(Session::new(), services);
    // The suite draws the title bar: no caption buttons, brand gap or window styles of PhotoCraft's own.
    app.integrated_titlebar = false;
    app.custom_titlebar = false;
    // Long commands and file opens run as background jobs with progress and Cancel (#210).
    app.background_jobs = std::env::var_os("PHOTOCRAFT_INLINE_JOBS").is_none();
    // Displays and their profiles (#569): wait briefly so the first frames already use the right
    // profile; a slower reading is applied when it arrives, and the shell reads again when the
    // displays may have changed.
    if let Some(rx) = monitor {
        #[cfg(target_os = "linux")]
        {
            app.services.read_displays = Some(std::sync::Arc::new(move || monitor_profile::detect_async_for_session(native_session)));
        }
        #[cfg(not(target_os = "linux"))]
        {
            app.services.read_displays = Some(std::sync::Arc::new(monitor_profile::detect_async));
        }
        match rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(r) => photocraft_ui_egui::monitor_status::apply(&mut app, r),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => photocraft_ui_egui::monitor_status::pending(&mut app, rx),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                photocraft_ui_egui::monitor_status::apply(&mut app, Err("the display profile reader stopped without an answer".into()));
            }
        }
    }
    use_gpu(&mut app, cc.wgpu_render_state.clone());
    app.services.cursor_pos = window.cursor_pos;
    app.services.caps_lock = window.caps_lock;
    app.services.screen_pick = window.screen_pick;
    // Tablet pressure/tilt/eraser (winit drops them): the macOS monitor and the X11 reader write
    // into the stylus feed.
    #[cfg(target_os = "macos")]
    let tablet = tablet::install_macos(&app.stylus.feed);
    #[cfg(target_os = "linux")]
    tablet::spawn_x11(&app.stylus.feed, window.display);
    open_files(&mut app, &startup.files);
    // Portable marker found but its data folder isn't writable (#228): say where settings went.
    if !startup.no_settings
        && let Some(w) = &app_dirs::current().warning
    {
        photocraft_ui_egui::notices::post(&mut app, "Portable mode is off", vec![w.clone()], false, None);
    }
    // PhotoCraft maximizes its own window once if it is bigger than the monitor (`work_area`), with
    // no switch to turn that off; the suite's window is not PhotoCraft's to resize. This is the
    // flag it sets once it has looked.
    cc.egui_ctx.data_mut(|d| d.insert_temp(egui::Id::new("pc-window-fitted"), true));
    App {
        app,
        #[cfg(target_os = "macos")]
        _tablet: tablet,
    }
}

/// The app-side GPU set-up of main.rs, on the suite's device: the GPU canvas unless Preferences ›
/// Performance asks for the CPU or the window draws with a software adapter; what Help › System
/// Info reports about it; and, on the CPU path, wgpu errors recorded instead of panicking.
fn use_gpu(app: &mut PhotocraftApp, rs: Option<eframe::egui_wgpu::RenderState>) {
    let performance = &app.session.prefs().performance;
    let (backend, mode) = (performance.gpu_backend, performance.effective_rendering_mode());
    let info = &mut app.perf.gpu_info;
    info.preference = backend.name().to_string();
    // The suite chose the device (honouring `WGPU_BACKEND`, as PhotoCraft does), not the preference.
    info.selected = if mode == RenderingMode::Cpu {
        "cpu"
    } else if std::env::var_os("WGPU_BACKEND").is_some() {
        "env"
    } else {
        "auto"
    }
    .into();
    info.canvas = "cpu".into();
    if let Some(rs) = rs {
        let adapter = rs.adapter.get_info();
        app.perf.gpu_info.set_adapter(&adapter);
        let software_window = adapter.device_type == eframe::wgpu::DeviceType::Cpu;
        if software_window && mode != RenderingMode::Cpu {
            app.perf.gpu_info.fallback = Some("No compatible hardware graphics adapter; using software graphics.".into());
        }
        if !software_window && mode != RenderingMode::Cpu && std::env::var_os("PHOTOCRAFT_CPU_CANVAS").is_none() {
            app.set_wgpu(rs);
        } else {
            // The window still draws with wgpu: record its errors instead of panicking.
            let _ = photocraft_ui_egui::gpu_canvas::DeviceHealth::watch(&rs.device);
        }
    }
    if app.perf.gpu_info.canvas == "cpu"
        && mode != RenderingMode::Cpu
        && let Some(reason) = app.perf.gpu_info.fallback.clone()
    {
        photocraft_ui_egui::gpu_status::queue_fallback_notice(app, &reason);
    }
}

/// Files from the command line, as main.rs opens its arguments; paths that aren't valid Unicode
/// are named in a notice instead (#1108).
fn open_files(app: &mut PhotocraftApp, files: &[std::path::PathBuf]) {
    let (mut readable, mut unreadable) = (Vec::new(), Vec::new());
    for f in files {
        match f.to_str() {
            Some(s) => readable.push(s.to_owned()),
            None => unreadable.push(f.to_string_lossy().into_owned()),
        }
    }
    app.open_paths(&readable);
    if !unreadable.is_empty() {
        use photocraft_ui_egui::i18n;
        let line = i18n::t("{path}: the path is not valid Unicode; rename the file and open it again.");
        let lines = unreadable.iter().map(|p| i18n::fmt(line, &[("path", p.as_str())])).collect();
        photocraft_ui_egui::notices::post(app, i18n::t("Could not open"), lines, true, None);
    }
}

/// PhotoCraft, with what has to live as long as it does.
struct App {
    app: PhotocraftApp,
    /// The macOS pen tablet monitor; it stops when dropped.
    #[cfg(target_os = "macos")]
    _tablet: Option<photocraft_tablet::macos::Monitor>,
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        // Photos other apps of the window hand over (LightCraft's Edit In ▸ PhotoCraft) open as
        // documents, as they would when passed to a standalone PhotoCraft.
        let handed = craft_suite::take_open_requests("photocraft");
        if !handed.is_empty() {
            open_files(&mut self.app, &handed);
        }
        eframe::App::logic(&mut self.app, ctx, frame);
    }

    fn raw_input_hook(&mut self, ctx: &egui::Context, raw_input: &mut egui::RawInput) {
        eframe::App::raw_input_hook(&mut self.app, ctx, raw_input);
    }

    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        eframe::App::ui(&mut self.app, ui, frame);
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        eframe::App::save(&mut self.app, storage);
    }

    fn on_exit(&mut self) {
        eframe::App::on_exit(&mut self.app);
    }

    fn auto_save_interval(&self) -> std::time::Duration {
        eframe::App::auto_save_interval(&self.app)
    }

    fn clear_color(&self, visuals: &egui::Visuals) -> [f32; 4] {
        eframe::App::clear_color(&self.app, visuals)
    }

    fn persist_egui_memory(&self) -> bool {
        eframe::App::persist_egui_memory(&self.app)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_images() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"psd") && t.extensions.contains(&"pcraft"));
        assert!(t.extensions.iter().all(|e| *e == e.to_ascii_lowercase() && !e.starts_with('.')));
    }

    #[test]
    fn photocraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }
}
