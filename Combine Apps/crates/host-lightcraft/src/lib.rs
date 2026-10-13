//! LightCraft (photo library and raw development) as a tab of the ArtCraft suite.
//!
//! Adapted from LightCraft's `apps/lightcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/lightcraft): the same app, services, library and app settings
//! (`ui.json`), which it shares with a standalone LightCraft. Its `alloc_release`, `appearance`,
//! `dialog_filter` and (macOS) `screen_profile` modules are used unchanged, `editors` as a copy
//! (see there).
//!
//! The suite provides the window, the GPU device the window draws with, the log and the title
//! bar, so left out are: LightCraft's window renderer probing and fallback chain (`window_gpu.rs`:
//! renderer markers, relaunching with the next renderer, the glow fallback), its logger, panic hook
//! and start-up failure dialog, the `--control` automation server, running through XWayland on
//! Wayland (the suite's window decides), and on macOS the title-bar strip for the traffic lights
//! (`integrated_titlebar`) and the menu-bar menus (`native_menu.rs`; the menus stay in the window,
//! as with `LIGHTCRAFT_NO_NATIVE_MENU`). LightCraft's GPU compute device is its own, not the
//! window's, so its crash check (`gpu-init.marker`) is kept.
//!
//! `--no-settings` runs LightCraft's `--memory` session (an in-memory library with the demo
//! photos, nothing written), and goes further: `ui.json` isn't read either, nor are the model
//! folders in LightCraft's settings folder used.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

/// LightCraft's own helper modules, unchanged.
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/lightcraft/apps/lightcraft/src"]
mod upstream {
    pub mod alloc_release;
    pub mod appearance;
    pub mod dialog_filter;
    #[cfg(target_os = "macos")]
    pub mod screen_profile;
}
use upstream::dialog_filter::FileDialogExt as _;
#[cfg(target_os = "macos")]
use upstream::screen_profile;
use upstream::{alloc_release, appearance};

#[cfg_attr(test, allow(clippy::unwrap_used))]
mod editors;

use std::path::{Path, PathBuf};

use lightcraft_engine::Session;
use lightcraft_ui_egui::panels::library_problem::LibraryProblem;
use lightcraft_ui_egui::{LightcraftApp, Services, UiState};

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "lightcraft",
        name: "LightCraft",
        summary: "Photo library and raw development",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/lightcraft.png"),
        // Camera raw files, and JPEG XL, which only LightCraft reads. Other photos (JPEG, PNG,
        // TIFF, PSD…) are PhotoCraft's, and imported here with File ▸ Import Photos or a drop.
        extensions: &[
            "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "raf", "orf", "rw2", "rwl", "pef", "srw", "iiq", "mrw", "x3f", "kdc", "mos", "erf", "3fr", "fff",
            "jxl",
        ],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    // The file dialogs' parent window (see `DIALOG_PARENT`).
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    let _ = DIALOG_PARENT.set(rfd::FileDialog::new().set_parent(cc));
    #[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
    let _ = cc;
    Box::new(move |cc| Box::new(launch(cc, startup)))
}

fn launch(cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> App {
    alloc_release::install();
    let no_settings = startup.no_settings;
    let mut args = Vec::new();
    let mut unreadable = Vec::new();
    for f in &startup.files {
        match f.to_str() {
            Some(s) => args.push(s.to_owned()),
            None => unreadable.push(format!("{} was not imported: its name is not valid Unicode.", f.display())),
        }
    }
    // what the files name, resolved now: an empty or relative one never becomes a drive root,
    // and a whole drive or home folder is not walked (issue #374)
    let (files, launch_notices) = launch_imports(&args);
    let (prefs, prefs_warning, keep_prefs_file) = if no_settings { (None, None, false) } else { load_prefs() };
    // the saved language from the start, so a failed start is reported in it too
    if let Some(ui) = &prefs {
        lightcraft_ui_egui::i18n::set_language(ui.language);
    }
    // the library last opened from Settings, else the default location
    let library_dir = prefs
        .as_ref()
        .map(|u| u.settings.library_path.clone())
        .filter(|p| !p.is_empty() && std::env::var_os("LIGHTCRAFT_LIBRARY").is_none())
        .map(PathBuf::from)
        .or_else(lightcraft_engine::library::default_dir);
    // GPU compute: off if the preference says so, or if the last launch died creating the device
    // (issue #136) — before anything can create it
    let gpu_crash = if no_settings { None } else { gpu_crash_check_at(gpu_marker_path(), false) };
    let gpu_on = prefs.as_ref().is_none_or(|u| u.settings.gpu) && gpu_crash.is_none();
    lightcraft_engine::gpu::set_enabled(gpu_on);
    let (session, problem) = open_session(no_settings, library_dir, files.is_empty());
    let mut app = LightcraftApp::new(session, services(&cc.egui_ctx));
    if let Some(ui) = prefs {
        app.ui = ui;
    }
    lightcraft_ui_egui::i18n::set_language(app.ui.language);
    // The suite's title bar is above the app: no room to leave for the macOS traffic lights.
    app.integrated_titlebar = false;
    app.notices.extend(prefs_warning);
    app.notices.extend(launch_notices);
    app.notices.extend(unreadable);
    // what's on disk now: only changes are written
    let writer = PrefsWriter {
        path: if no_settings { None } else { prefs_path() },
        written: serde_json::to_vec_pretty(&app.ui).unwrap_or_default(),
        library: app.ui.settings.library_path.clone(),
        keep_file: keep_prefs_file,
        ..Default::default()
    };
    // after the snapshot above, so the writer saves the switched-off preference
    if let Some(notice) = gpu_crash {
        app.ui.settings.gpu = false;
        app.notices.push(notice);
    }
    if let Some(mut p) = problem {
        // imported once the user has chosen where (into the library, or the temporary session)
        p.pending_import = files;
        app.library_problem = Some(p);
    } else if !files.is_empty() {
        // listed and read on the import worker once the tab shows (issue #374: never here, where a
        // large folder kept the window from appearing)
        if let Err(e) = lightcraft_ui_egui::import::start_paths(&mut app, files) {
            log::warn!("import at launch: {e}");
        }
        app.ui.view = lightcraft_ui_egui::state::ViewMode::PhotoGrid;
    }
    App { app, prefs: writer }
}

struct App {
    app: LightcraftApp,
    prefs: PrefsWriter,
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.app.logic(ctx);
        self.prefs.tick(&mut self.app, ctx);
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.app.ui(ui);
    }

    fn on_exit(&mut self) {
        if let Err(e) = self.prefs.save(&self.app) {
            log::error!("{e}");
        }
        if let Err(e) = self.app.session.close_library() {
            log::error!("saving the library failed: {e}");
        }
        // last, with everything saved: no render may be inside the GPU driver when the process ends
        if !self.app.shutdown(EXIT_WAIT) {
            log::warn!("quit: background work was still running after {EXIT_WAIT:?}");
        }
    }
}

/// How long quitting waits for renders that are running (issue #620). A GPU render takes well under
/// a second; anything slower gives way to quitting.
const EXIT_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

/// Written while the GPU compute device is created, removed once that returned
/// (`lightcraft_gpu::backend::set_init_marker`). Not with `LIGHTCRAFT_NO_PREFS` (tests, scripts).
fn gpu_marker_path() -> Option<PathBuf> {
    if std::env::var_os("LIGHTCRAFT_NO_PREFS").is_some() {
        return None;
    }
    config_dir().map(|d| d.join("gpu-init.marker"))
}

/// Arm the GPU crash sentinel; if the previous launch left it behind (it died inside the GPU
/// driver while creating the device), the notice to show — GPU rendering then starts off. With
/// `in_memory`, it is neither armed nor removed, only honoured.
fn gpu_crash_check_at(marker: Option<PathBuf>, in_memory: bool) -> Option<String> {
    use lightcraft_engine::gpu::backend;
    let left = if in_memory {
        marker.as_deref().and_then(backend::read_init_marker)
    } else {
        let left = marker.as_deref().and_then(backend::take_init_marker);
        backend::set_init_marker(marker);
        left
    };
    left.map(|what| gpu_crash_notice(&what))
}

fn gpu_crash_notice(what: &str) -> String {
    format!(
        "LightCraft closed unexpectedly while starting the GPU last time ({what}), so GPU rendering is now off and photos render on the CPU. \
         To try the GPU again, turn on Settings ▸ Performance ▸ Use the GPU for rendering; to try another graphics backend, start LightCraft with \
         LIGHTCRAFT_GPU_BACKEND=dx12, vulkan or off (see docs/gpu-pipeline.md → Troubleshooting)."
    )
}

/// Where the system keeps monitor profiles, for the Choose Profile dialog to start in: the user's
/// own profiles first (Linux: colord / DisplayCAL; macOS: ColorSync), then the system's.
fn display_profile_dir() -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).filter(|h| !h.is_empty()).map(PathBuf::from);
    let user = |rel: &str| home.as_ref().map(|h| h.join(rel));
    let candidates: Vec<Option<PathBuf>> = if cfg!(target_os = "macos") {
        vec![user("Library/ColorSync/Profiles"), Some("/Library/ColorSync/Profiles".into())]
    } else if cfg!(windows) {
        let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| "C:\\Windows".into());
        vec![Some(root.join("System32").join("spool").join("drivers").join("color"))]
    } else {
        let data = std::env::var_os("XDG_DATA_HOME").filter(|d| !d.is_empty()).map(PathBuf::from).or_else(|| user(".local/share"));
        vec![data.map(|d| d.join("icc")), user(".color/icc"), Some("/usr/share/color/icc".into())]
    };
    candidates.into_iter().flatten().find(|d| d.is_dir())
}

/// LightCraft's settings folder, shared with a standalone LightCraft (`LIGHTCRAFT_CONFIG_DIR`, else
/// the platform's).
fn config_dir() -> Option<PathBuf> {
    lightcraft_engine::config::config_dir()
}

/// `<config>/ui.json`, the saved UI state and app settings — `None` when nothing is read or
/// written: `LIGHTCRAFT_NO_PREFS` (tests, scripts) or no home folder.
fn prefs_path() -> Option<PathBuf> {
    if std::env::var_os("LIGHTCRAFT_NO_PREFS").is_some() {
        return None;
    }
    config_dir().map(|d| d.join("ui.json"))
}

/// The saved UI state and app settings (`<config>/ui.json`), if any, and a warning for the user
/// when the file exists but can't be used (issue #103): a damaged file is kept as
/// `ui.json.corrupt-<unix time>` first, so the next save can't lose the library location in it;
/// one that can't be read at all is not written this session (`keep_file`).
fn load_prefs() -> (Option<UiState>, Option<String>, bool) {
    let Some(path) = prefs_path() else { return (None, None, false) };
    load_prefs_at(&path, true)
}

/// Compatibility recovery is limited to persisted docking, not runtime UiState commands.
fn decode_saved_ui(bytes: &[u8]) -> Result<(UiState, bool), String> {
    let mut saved: serde_json::Value = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    let fields = saved.as_object_mut().ok_or("settings must be an object")?;
    let recovered = fields.get("docking").is_some_and(|value| match serde_json::from_value::<Option<lightcraft_ui_egui::docking::Workspace>>(value.clone()) {
        Ok(Some(workspace)) => workspace.validate().is_err(),
        Ok(None) => false,
        Err(_) => true,
    });
    if recovered {
        fields.remove("docking");
    }
    let ui = serde_json::from_value(saved).map_err(|error| error.to_string())?;
    Ok((ui, recovered))
}

fn load_prefs_at(path: &Path, set_aside_damaged: bool) -> (Option<UiState>, Option<String>, bool) {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (None, None, false),
        Err(e) => {
            let msg = format!("The app settings ({}) couldn't be read: {e}. Defaults are used, and the file isn't overwritten.", path.display());
            return (None, Some(msg), true);
        }
    };
    match decode_saved_ui(&bytes) {
        Ok((ui, false)) => (Some(ui.sanitized()), None, false),
        Ok((ui, true)) => {
            let msg = format!(
                "The saved panel layout in {} couldn't be restored. Other settings were loaded; the original file is preserved and settings won't be saved this session.",
                path.display()
            );
            (Some(ui.sanitized()), Some(msg), true)
        }
        Err(e) if !set_aside_damaged => {
            let msg = format!("The app settings ({}) are damaged ({e}). Defaults are used; nothing is saved in this session.", path.display());
            (None, Some(msg), true)
        }
        Err(e) => {
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let keep = path.with_file_name(format!("ui.json.corrupt-{secs}"));
            let kept = std::fs::rename(path, &keep);
            let what = match &kept {
                Ok(()) => format!("it was kept as {}", keep.display()),
                Err(r) => format!("it couldn't be set aside ({r})"),
            };
            let msg = format!(
                "The app settings ({}) are damaged ({e}); {what}. Defaults are used — reopen your library with Settings → Open Library… if it isn't shown.",
                path.display()
            );
            (None, Some(msg), kept.is_err())
        }
    }
}

/// Write `bytes` to `path` atomically: a temp file, fsynced, renamed over it (a crash or a full
/// disk leaves the old file or the new one, never a truncated one).
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let written = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, path)?;
    if let Some(dir) = path.parent()
        && let Ok(d) = std::fs::File::open(dir)
    {
        let _ = d.sync_all();
    }
    Ok(())
}

/// Saves `ui.json` (app settings, incl. the library to open at launch): as soon as the library
/// changes, every few seconds when anything else changed (while the tab is shown), and at exit.
///
/// Nothing is written while the session is one that promises to save nothing: `--no-settings`
/// (`path` is `None`), or the one running because the library couldn't be opened — the
/// question window and Continue Without Saving (issue #100; `app.openLibrary` ends it, and the
/// library it opened is saved then).
#[derive(Default)]
struct PrefsWriter {
    /// Where to write; `None` writes nothing (`--no-settings`, `LIGHTCRAFT_NO_PREFS`, no home folder).
    path: Option<PathBuf>,
    written: Vec<u8>,
    library: String,
    checked: f64,
    /// The last write failed (reported once until a write works).
    failing: bool,
    /// `ui.json` couldn't be read at launch: never overwrite it this session.
    keep_file: bool,
}

impl PrefsWriter {
    fn save(&mut self, app: &LightcraftApp) -> Result<(), String> {
        self.save_ui(&app.ui, app.library_problem.is_some())
    }

    /// Write `ui` if it changed since the last write; `temporary` (the library couldn't be
    /// opened) saves nothing.
    fn save_ui(&mut self, ui: &UiState, temporary: bool) -> Result<(), String> {
        if self.keep_file || temporary {
            return Ok(());
        }
        let Some(path) = self.path.clone() else { return Ok(()) };
        if let Some(workspace) = &ui.docking {
            workspace.validate()?;
        }
        let bytes = serde_json::to_vec_pretty(ui).map_err(|e| e.to_string())?;
        if bytes == self.written {
            return Ok(());
        }
        path.parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| write_atomic(&path, &bytes))
            .map_err(|e| format!("saving the app settings failed: {e}"))?;
        self.written = bytes;
        self.library = ui.settings.library_path.clone();
        Ok(())
    }

    fn tick(&mut self, app: &mut LightcraftApp, ctx: &egui::Context) {
        let now = ctx.input(|i| i.time);
        let moved = app.ui.settings.library_path != self.library;
        if !moved && now - self.checked < 3.0 {
            return;
        }
        self.checked = now;
        match self.save(app) {
            Ok(()) => self.failing = false,
            Err(e) => {
                if !self.failing {
                    log::warn!("{e}");
                    app.notices.push(format!("{e}. LightCraft keeps trying."));
                }
                self.failing = true;
                // don't retry every frame
                self.library = app.ui.settings.library_path.clone();
            }
        }
    }
}

/// The Windows command that opens `url` in the default browser. `explorer <url>` opened File
/// Explorer instead for links with a query or fragment, like the Map button's OpenStreetMap link
/// (issue #234). The URL protocol handler hands the URL to the browser as is; no shell runs, so
/// `?`, `&` and `#` need no escaping.
fn windows_open_url_command(url: &str) -> std::process::Command {
    let mut c = std::process::Command::new("rundll32");
    c.args(["url.dll,FileProtocolHandler", url]);
    c
}

/// Explorer's `/select,<path>` switch (issue #272). Explorer parses its own command line and only
/// selects the file when the path after the comma is quoted (`/select,"C:\My Photos\a.jpg"`),
/// spelled with backslashes and free of the verbatim prefix (`\\?\`, `\\?\UNC\`) that
/// `canonicalize` adds; given anything else it opens Documents. Windows file names can't contain
/// `"`; a path that does anyway (a hostile catalog) has them dropped, so the raw command line
/// always holds exactly this one argument.
fn explorer_select_arg(path: &str) -> String {
    let path = path.replace('/', "\\").replace('"', "");
    let path = match path.strip_prefix(r"\\?\UNC\") {
        Some(unc) => format!(r"\\{unc}"),
        None => path.strip_prefix(r"\\?\").unwrap_or(path.as_str()).to_string(),
    };
    format!("/select,\"{path}\"")
}

/// `explorer /select,"<path>"`. Rust's own argument quoting wraps the whole switch in quotes
/// (`"/select,C:\My Photos\a.jpg"`) whenever the path has a space, which Explorer doesn't
/// recognise, so on Windows the switch goes on the command line exactly as built.
fn explorer_select_command(path: &str) -> std::process::Command {
    let mut c = std::process::Command::new("explorer");
    let arg = explorer_select_arg(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.raw_arg(arg);
    }
    #[cfg(not(windows))]
    {
        c.arg(arg);
    }
    c
}

/// The file dialogs' parent, set from the suite's window while it opens (`prepare`). A dialog
/// with a parent is a child of the app's window; without one, the xdg-desktop-portal picker on
/// Wayland is a stray top-level: a tiling compositor puts it beside the app, and a fullscreen
/// window hides it entirely. `FileDialog` is `Clone` and `Send`, so one parented template serves
/// every picker, including the one on its own thread (#191). Only set on Linux and FreeBSD: on
/// macOS a parented dialog becomes a sheet and on Windows a modal, a behaviour change LightCraft
/// does not make.
static DIALOG_PARENT: std::sync::OnceLock<rfd::FileDialog> = std::sync::OnceLock::new();

/// A file dialog owned by the window, or a plain one.
fn file_dialog() -> rfd::FileDialog {
    DIALOG_PARENT.get().cloned().unwrap_or_default()
}

/// The platform services; `ctx` repaints when a dialog closes. No log file for Help ▸ Open Log
/// Folder: the suite keeps the log.
fn services(ctx: &egui::Context) -> Services {
    let ctx = ctx.clone();
    Services {
        // Commands' file dialogs run on their own thread (#191): a dialog on the UI thread
        // stopped the window answering the compositor, which then reported the app as hung.
        picker: Some(Box::new(move |req: lightcraft_ui_egui::pick::PickRequest| {
            use lightcraft_ui_egui::pick::PickKind;
            let (tx, rx) = std::sync::mpsc::channel();
            let repaint = ctx.clone();
            std::thread::Builder::new()
                .name("file-dialog".into())
                .spawn(move || {
                    let mut d = file_dialog();
                    if let Some(t) = &req.title {
                        d = d.set_title(t);
                    }
                    if let Some((name, exts)) = &req.filter {
                        d = d.add_filter_nocase(name.clone(), exts);
                    }
                    if let Some(n) = &req.file_name {
                        d = d.set_file_name(n);
                    }
                    let s = |p: PathBuf| p.to_string_lossy().to_string();
                    let paths: Vec<String> = match req.kind {
                        PickKind::Files => d.pick_files().unwrap_or_default().into_iter().map(s).collect(),
                        PickKind::File => d.pick_file().map(s).into_iter().collect(),
                        PickKind::Folder => d.pick_folder().map(s).into_iter().collect(),
                        PickKind::Save => d.save_file().map(s).into_iter().collect(),
                    };
                    // the app may have quit meanwhile: nobody to tell
                    let _ = tx.send(paths);
                    repaint.request_repaint();
                })
                .map_err(|e| format!("could not start the file dialog: {e}"))?;
            Ok(rx)
        })),
        log_file: None,
        pick_lightroom_catalog: Some(Box::new(|| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Import Lightroom Catalog"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("Lightroom Classic Catalog"), &["lrcat"])
                .pick_file()
                .map(|p| p.to_string_lossy().to_string())
        })),
        pick_folder: Some(Box::new(|| {
            file_dialog().set_title(lightcraft_ui_egui::i18n::tr("Open Library")).pick_folder().map(|p| p.to_string_lossy().to_string())
        })),
        open_with: Some(Box::new(editors::open_with)),
        check_editor: Some(Box::new(editors::check)),
        open_url: Some(Box::new(|url: &str| {
            if !url.starts_with("https://") {
                return Err("only https links are opened".into());
            }
            let status = if cfg!(target_os = "macos") {
                std::process::Command::new("open").arg(url).status()
            } else if cfg!(target_os = "windows") {
                windows_open_url_command(url).status()
            } else {
                std::process::Command::new("xdg-open").arg(url).status()
            };
            status.map(|_| ()).map_err(|e| e.to_string())
        })),
        reveal: Some(Box::new(|path: &str| {
            let status = if cfg!(target_os = "macos") {
                std::process::Command::new("open").args(["-R", path]).status()
            } else if cfg!(target_os = "windows") {
                explorer_select_command(path).status()
            } else {
                let dir = Path::new(path).parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_else(|| ".".into());
                std::process::Command::new("xdg-open").arg(dir).status()
            };
            status.map_err(|e| e.to_string()).and_then(|s| if s.success() || cfg!(target_os = "windows") { Ok(()) } else { Err(format!("reveal failed: {s}")) })
        })),
        pick_files: Some(Box::new(|| {
            file_dialog()
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("Photos"), lightcraft_engine::import::EXTENSIONS)
                .pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })),
        pick_denoise_model: Some(Box::new(|| {
            file_dialog()
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("ONNX model"), &["onnx"])
                .pick_file()
                .map(|p| vec![p.to_string_lossy().into_owned()])
                .unwrap_or_default()
        })),
        pick_preset_files: Some(Box::new(|| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Import Presets"))
                .add_filter_nocase(
                    lightcraft_ui_egui::i18n::tr("Presets & Profiles"),
                    &["lcpreset", "xmp", "lrtemplate", "zip", "dng", "lmp", "mplumpack", "cube"],
                )
                .pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })),
        pick_model_file: Some(Box::new(|| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Add a Face Recognition Model"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("Face models (ONNX)"), &["onnx"])
                .pick_file()
                .map(|p| vec![p.to_string_lossy().to_string()])
                .unwrap_or_default()
        })),
        pick_tracklog: Some(Box::new(|| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Auto-Tag from Tracklog"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("GPS Track Log"), &["gpx"])
                .pick_file()
                .map(|p| vec![p.to_string_lossy().to_string()])
                .unwrap_or_default()
        })),
        // macOS doesn't colour-manage the window: previews follow the screen's profile (#787)
        #[cfg(target_os = "macos")]
        screen_profile: Some(Box::new(screen_profile::icc)),
        #[cfg(not(target_os = "macos"))]
        screen_profile: None,
        pick_display_profile: Some(Box::new(|| {
            let mut d = file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Choose Monitor Profile"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("ICC Profiles"), &["icc", "icm"]);
            if let Some(dir) = display_profile_dir() {
                d = d.set_directory(dir);
            }
            d.pick_file().map(|p| vec![p.to_string_lossy().to_string()]).unwrap_or_default()
        })),
        save_preset_file: Some(Box::new(|name: &str| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Export Presets"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("LightCraft Preset"), &["lcpreset"])
                .set_file_name(name)
                .save_file()
                .map(|p| p.to_string_lossy().to_string())
        })),
        pick_keyword_list: Some(Box::new(|| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Import Keywords"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("Keyword Lists"), &["txt", "utf8"])
                .pick_file()
                .map(|p| vec![p.to_string_lossy().to_string()])
                .unwrap_or_default()
        })),
        save_keyword_list: Some(Box::new(|name: &str| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Export Keywords"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("Keyword Lists"), &["txt"])
                .set_file_name(name)
                .save_file()
                .map(|p| p.to_string_lossy().to_string())
        })),
        pick_curve_preset_files: Some(Box::new(|| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Import Point Curve Presets"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("Point Curve Presets"), &["lccurve", "json"])
                .pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })),
        save_curve_preset_file: Some(Box::new(|name: &str| {
            file_dialog()
                .set_title(lightcraft_ui_egui::i18n::tr("Export Point Curve Presets"))
                .add_filter_nocase(lightcraft_ui_egui::i18n::tr("Point Curve Presets"), &["lccurve"])
                .set_file_name(name)
                .save_file()
                .map(|p| p.to_string_lossy().to_string())
        })),
        // atomic (temp file + sync + rename): a failed write never leaves a truncated file
        write_shared: Some(std::sync::Arc::new(lightcraft_engine::export::write_file)),
        write: Some(Box::new(lightcraft_engine::export::write_file)),
        png: Some(Box::new(|img: &lightcraft_raster::Rgba8| {
            lightcraft_codecs::encode_png(&lightcraft_codecs::EncodeImage::rgba8(img), &lightcraft_codecs::EncodeMeta::default()).unwrap_or_default()
        })),
        // the library is a folder on disk: backed up with the user's other files
        backup_library: None,
        restore_library: None,
        system_theme: appearance::service(),
    }
}

/// The library session. With `--no-settings`, an in-memory one, as LightCraft's `--memory`
/// session is (the demo photos unless files are given), without the model folders in the
/// settings folder either: AI masks, AI denoise and face recognition then have no models to use
/// or download. Otherwise the library at `dir`, with face models, denoise models and the SAM 3
/// model for AI masks in their shared folders.
fn open_session(no_settings: bool, dir: Option<PathBuf>, seed_demo: bool) -> (Session, Option<LibraryProblem>) {
    let (mut s, problem) = if no_settings {
        ((if seed_demo { Session::with_demo() } else { Session::new() }).with_fs().with_system_clock(), None)
    } else {
        let (mut s, problem) = open_library_session(dir, seed_demo);
        s.face_models_dir = lightcraft_engine::config::default_face_models_dir();
        (s.with_default_sam3_model(), problem)
    };
    // Control requests are answered on the UI thread: Add to Apple Photos must not wait there
    s.apple_photos_background = true;
    (s, problem)
}

/// The persistent library session.
///
/// If the library can't be opened the session is empty and in memory — never seeded with the
/// demo photos, never written anywhere — and the problem is returned: the tab then says so and
/// offers Try Again / Choose Another Library… / Continue Without Saving / Quit (issue #100).
fn open_library_session(dir: Option<PathBuf>, seed_demo: bool) -> (Session, Option<LibraryProblem>) {
    let unopened = || Session::new().with_fs().with_default_denoise_models().with_system_clock();
    let Some(dir) = dir else {
        log::warn!("no library location (set LIGHTCRAFT_LIBRARY)");
        return (unopened(), Some(LibraryProblem::new("", "There is no home folder to keep the library in. Choose a folder for it.")));
    };
    let t0 = std::time::Instant::now();
    let mut s = Session::new().with_fs().with_default_denoise_models().with_system_clock();
    match s.open_library(&dir, seed_demo) {
        Ok(r) => {
            let (replayed, torn) = (r.replayed, r.torn_bytes);
            log::info!(
                "library {}: {} photos, {replayed} log records replayed{} ({:.1} ms)",
                dir.display(),
                s.catalog.len(),
                if torn > 0 { ", torn tail repaired" } else { "" },
                t0.elapsed().as_secs_f64() * 1000.0
            );
            (s, None)
        }
        Err(e) => {
            log::error!("can't open library {}: {e}", dir.display());
            (unopened(), Some(LibraryProblem::new(dir.to_string_lossy(), e.to_string())))
        }
    }
}

/// The files and folders to import (absolute), and a notice for each one that is not imported
/// (see [`lightcraft_engine::import::launch_path`]; issue #374).
fn launch_imports(args: &[String]) -> (Vec<String>, Vec<String>) {
    let cwd = std::env::current_dir().ok();
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).filter(|h| !h.is_empty()).map(PathBuf::from);
    launch_imports_in(args, cwd.as_deref(), home.as_deref())
}

fn launch_imports_in(args: &[String], cwd: Option<&Path>, home: Option<&Path>) -> (Vec<String>, Vec<String>) {
    use lightcraft_engine::import::{LaunchPath, launch_path};
    let (mut files, mut notices) = (Vec::new(), Vec::new());
    for a in args {
        match launch_path(a, cwd, home, lightcraft_engine::devices::dcim_in) {
            Some(LaunchPath::Import(p)) => files.push(p),
            Some(LaunchPath::Refused { path, why }) => {
                log::warn!("not importing {path} given at launch: {why}");
                notices.push(format!("{path} was not imported: it is {why}. To import from it, choose a folder inside it with File ▸ Import Photos…"));
            }
            None => {}
        }
    }
    (files, notices)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("host-lightcraft-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_tool_has_an_icon_and_opens_raw_photos() {
        let t = tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"dng") && t.extensions.contains(&"cr3"));
        assert!(t.extensions.iter().all(|e| *e == e.to_ascii_lowercase() && !e.starts_with('.')));
        // everything listed is something LightCraft imports
        assert!(t.extensions.iter().all(|e| lightcraft_engine::import::EXTENSIONS.contains(e)));
    }

    #[test]
    fn lightcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&tool(), 30).unwrap();
    }

    /// `--no-settings`: an in-memory library with the demo photos, and no model folders.
    #[test]
    fn a_no_settings_session_is_in_memory() {
        let never = std::env::temp_dir().join(format!("host-lightcraft-never-opened-{}", std::process::id()));
        let (s, problem) = open_session(true, Some(never.clone()), true);
        assert!(problem.is_none() && s.apple_photos_background);
        assert_ne!(s.catalog.len(), 0, "the demo photos");
        assert!(s.face_models_dir.is_none());
        assert!(!never.exists(), "no library folder");
    }

    /// Issue #374: launch arguments that would walk a whole drive or home folder are reported,
    /// not imported; empty ones are ignored; the rest are imported as absolute paths.
    #[test]
    fn launch_arguments_never_walk_a_drive_or_the_home_folder() {
        let home = dir("launch");
        std::fs::create_dir_all(home.join("Trip")).unwrap();
        let args: Vec<String> = ["", "  ", ".", "Trip", &home.to_string_lossy()].iter().map(|s| s.to_string()).collect();
        let (files, notices) = launch_imports_in(&args, Some(&home), Some(&home));
        assert_eq!(files, [home.join("Trip").to_string_lossy().to_string()]);
        assert_eq!(notices.len(), 2, "{notices:?}");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Issue #103: a damaged ui.json (which holds the library location) is kept aside and
    /// reported, not silently replaced by the defaults.
    #[test]
    fn damaged_ui_json_is_kept_and_reported() {
        let d = dir("damaged");
        let path = d.join("ui.json");
        std::fs::write(&path, br#"{"settings": {"library_path": "/Volumes/Photos/Lib"#).unwrap();
        let (ui, warning, keep) = load_prefs_at(&path, true);
        assert!(ui.is_none() && !keep);
        let warning = warning.unwrap();
        assert!(warning.contains("damaged") && warning.contains("ui.json.corrupt-"), "{warning}");
        assert!(!path.exists());
        assert_eq!(load_prefs_at(&path, true).1, None, "a missing file is just no settings yet");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// The writer saves changed settings to its file, and nothing at all without one
    /// (`--no-settings`) or while the session is the temporary one offered when the library can't open.
    #[test]
    fn prefs_writer_writes_nothing_without_a_file_or_in_a_temporary_session() {
        let d = dir("writer");
        let path = d.join("sub").join("ui.json");
        let mut ui = UiState::default();
        let mut w = PrefsWriter { path: Some(path.clone()), ..Default::default() };
        ui.thumb_size += 50.0;
        w.save_ui(&ui, false).unwrap();
        let saved = std::fs::read(&path).unwrap();
        ui.thumb_size += 50.0;
        w.save_ui(&ui, true).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), saved);
        let mut w = PrefsWriter { path: None, ..Default::default() };
        w.save_ui(&ui, false).unwrap();
        assert!(w.written.is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Issues #234 and #272: links open in the browser, and Explorer gets the file to select
    /// quoted after `/select,`, with backslashes and without the verbatim prefix.
    #[test]
    fn windows_links_and_reveal_commands() {
        let url = "https://www.openstreetmap.org/?mlat=48.856600&mlon=2.352200#map=15/48.856600/2.352200";
        let c = windows_open_url_command(url);
        assert_eq!(c.get_program(), "rundll32");
        assert_eq!(c.get_args().collect::<Vec<_>>(), ["url.dll,FileProtocolHandler", url]);
        assert_eq!(explorer_select_arg(r"C:\Users\Me\My Photos\IMG 1.jpg"), r#"/select,"C:\Users\Me\My Photos\IMG 1.jpg""#);
        assert_eq!(explorer_select_arg(r"\\?\UNC\server\share\a.jpg"), r#"/select,"\\server\share\a.jpg""#);
        assert_eq!(explorer_select_arg(r#"C:\a" "C:\b.jpg"#), r#"/select,"C:\a C:\b.jpg""#);
        assert_eq!(explorer_select_command(r"C:\My Photos\a.jpg").get_args().collect::<Vec<_>>(), [r#"/select,"C:\My Photos\a.jpg""#]);
    }
}
