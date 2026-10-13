//! FilmCraft (video editing, color and sound) as a tab of the ArtCraft suite.
//!
//! Adapted from FilmCraft's `apps/filmcraft/src/main.rs` and `args.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/filmcraft): the same app, host hooks, audio output and input, and
//! data folder (preferences, auto-save, crash recovery, presets and workspaces, shared with a
//! standalone FilmCraft); its audio, appearance, App Nap and file-filter modules are used
//! unchanged. The suite provides the window, the GPU device, the log and the title bar, so these
//! are left out: FilmCraft's graphics start-up modes and their fallbacks and notice (`graphics.rs`,
//! `--graphics`), its logger and crash-log panic hook (`logging.rs`, `crash::install`), the
//! `--control` automation server with its focus-free window raising (`control_server.rs`,
//! `window_raise.rs`), the room kept for macOS's window buttons (`integrated_titlebar`), Linux's
//! development desktop entry (`dev_icon.rs`) and, on macOS, the menu-bar menus (`native_menu.rs`;
//! one window of several apps can't hand the menu bar to one of them). The command line's
//! `--demo`, `--empty`, `--recover` and `--data-dir` don't exist in the suite: it starts as
//! FilmCraft does without them.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

// FilmCraft's own modules, unchanged. Their tests unwrap and panic, as tests may.
#[path = "../../../vendor/filmcraft/apps/filmcraft/src/app_nap.rs"]
mod app_nap;
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/filmcraft/apps/filmcraft/src/appearance.rs"]
mod appearance;
// Newer clippy than FilmCraft's own flags one of its conditions as simplifiable.
#[allow(clippy::nonminimal_bool)]
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/filmcraft/apps/filmcraft/src/audio.rs"]
mod audio;
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/filmcraft/apps/filmcraft/src/audio_in.rs"]
mod audio_in;
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/filmcraft/apps/filmcraft/src/file_filters.rs"]
mod file_filters;

use chrono::TimeZone;
use filmcraft_engine::Session;
use filmcraft_engine::autosave::{AutosaveConfig, default_data_dir};
use filmcraft_ui_egui::FilmcraftApp;
use serde_json::json;

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "filmcraft",
        name: "FilmCraft",
        summary: "Video editing, color and sound",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/filmcraft.png"),
        // Its projects, the video it imports (stills and audio belong to PhotoCraft and SoundCraft),
        // edit decision lists and timelines from other editors, and subtitles.
        extensions: &[
            "fcproj", "mp4", "m4v", "mov", "mkv", "webm", "avi", "mxf", "mts", "m2ts", "m2t", "mpg", "mpeg", "vob", "m2v", "m1v", "3gp", "y4m", "apv", "edl",
            "fcpxml", "otio", "aaf", "omf", "srt", "vtt",
        ],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |cc| launch(cc, startup))
}

fn launch(cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> Box<dyn eframe::App> {
    app_nap::disable();
    // OS hardware video decoders (VideoToolbox on macOS) in front of our own; Settings ▸ Playback ▸
    // Hardware decoding switches them off. Unsupported streams and failures use our decoders.
    register_hardware_decoders();
    // FilmCraft leaves this out only after its own window fell back to another graphics mode; the
    // suite's window has no such modes.
    register_gpu_frame_renderer();
    let mut session = Session::default();
    // `--no-settings` runs FilmCraft as it runs without a data folder: default preferences, no
    // auto-save or crash recovery, nothing saved.
    let data_dir = if startup.no_settings { None } else { default_data_dir() };
    if let Some(dir) = data_dir {
        let mut cfg = AutosaveConfig::new(dir);
        cfg.local_offset = local_offset;
        if let Err(e) = session.start_autosave(cfg) {
            log::warn!("auto-save and crash recovery unavailable: {e}");
        }
    }
    // voice-over recording reads the microphone through cpal
    session.voiceover.input = Some(Box::new(audio_in::CpalIn::new(&session.prefs.audio_hardware.device_class)));
    let files: Vec<String> = startup.files.iter().map(|f| f.to_string_lossy().into_owned()).collect();
    let (project, media) = project_and_media(&files);
    if let Some(p) = project {
        if let Err(e) = session.execute("file.open", json!({"path": p})) {
            log::error!("{e}");
        }
    } else {
        // Settings ▸ General ▸ At Startup: Open Most Recent, an empty project, or Show Home (the
        // demo project).
        match session.prefs.general.at_startup.as_str() {
            "openMostRecent" => {
                let recent = session.prefs.general.recent_projects.iter().find(|p| std::path::Path::new(p).exists()).cloned();
                match recent {
                    Some(p) => {
                        if let Err(e) = session.execute("file.open", json!({"path": p})) {
                            log::error!("{e}");
                        }
                    }
                    None => {
                        let _ = session.execute("file.openDemoProject", json!({}));
                    }
                }
            }
            "emptyProject" => {}
            _ => {
                let _ = session.execute("file.openDemoProject", json!({}));
            }
        }
    }
    if !media.is_empty() {
        let _ = session.execute("file.import", json!({"paths": media}));
    }
    let mut app = FilmcraftApp::new(session);
    // The suite's title bar is above the app: no room for macOS's window buttons in FilmCraft's.
    app.integrated_titlebar = false;
    if let Some(rs) = cc.wgpu_render_state.clone()
        && std::env::var_os("FILMCRAFT_CPU_COMPOSITE").is_none()
    {
        app.set_wgpu(rs);
    }
    // Keep device selection available even when the default device is unavailable.
    // Settings ▸ Audio Hardware is applied on the first frame (`apply_prefs`).
    app.audio = Some(Box::new(audio::CpalOut::new()));
    install_hooks(&mut app);
    Box::new(App(app))
}

/// FilmCraft, which is its own `eframe::App`.
struct App(FilmcraftApp);

impl eframe::App for App {
    fn raw_input_hook(&mut self, ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.0.raw_input_hook(ctx, raw);
    }

    fn logic(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.0.logic(ctx, frame);
        // Once Save / Don't Save was answered for a quit, FilmCraft lets the next close request
        // through without asking (`quit_confirmed`), and the window would close. In the suite
        // another app may still keep it open: then later changes must be asked about again.
        if self.0.quit_confirmed && ctx.input(|i| i.viewport().close_requested()) {
            self.0.quit_confirmed = false;
        }
    }

    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.0.ui(ui, frame);
    }

    /// Flushes the recovery journal and stops the auto-save worker.
    fn on_exit(&mut self) {
        self.0.on_exit();
    }

    /// As the standalone app, built without eframe's persistence.
    fn persist_egui_memory(&self) -> bool {
        false
    }
}

/// File dialogs, links, the clipboard and the system's language and appearance.
fn install_hooks(app: &mut FilmcraftApp) {
    app.hooks.pick_files = Some(Box::new(|exts: &[&str]| {
        rfd::FileDialog::new()
            .add_filter(filmcraft_ui_egui::i18n::t("Media"), &file_filters::extensions(exts))
            .pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    }));
    // Link Media ▸ Locate…, Attach Proxies, Reconnect Full Resolution: one path, not imported.
    app.hooks.pick_file_for_relink = Some(Box::new(|exts: &[&str], _hint| {
        rfd::FileDialog::new()
            .add_filter(filmcraft_ui_egui::i18n::t("Media"), &file_filters::extensions(exts))
            .pick_file()
            .map(|p| p.to_string_lossy().to_string())
    }));
    app.hooks.pick_save = Some(Box::new(|name: &str| {
        rfd::FileDialog::new()
            .add_filter(filmcraft_ui_egui::i18n::t("FilmCraft Project"), &file_filters::extensions(&["fcproj"]))
            .set_file_name(name)
            .save_file()
            .map(|p| p.to_string_lossy().to_string())
    }));
    app.hooks.pick_save_as = Some(Box::new(|filter: &str, exts: &[&str], name: &str| {
        // a full path (Quick Export, Export mode) opens the dialog in its folder
        let path = std::path::Path::new(name);
        let mut dialog = rfd::FileDialog::new()
            .add_filter(filmcraft_ui_egui::i18n::t(filter), &file_filters::extensions(exts))
            .set_file_name(path.file_name().map_or(name.into(), |n| n.to_string_lossy()));
        if let Some(dir) = path.parent().filter(|d| d.is_dir()) {
            dialog = dialog.set_directory(dir);
        }
        dialog.save_file().map(|p| p.to_string_lossy().to_string())
    }));
    app.hooks.pick_folder = Some(Box::new(|| rfd::FileDialog::new().pick_folder().map(|p| p.to_string_lossy().to_string())));
    app.hooks.pick_folder_at = Some(Box::new(|dir: &str| rfd::FileDialog::new().set_directory(dir).pick_folder().map(|p| p.to_string_lossy().into_owned())));
    // Linux: the XDG portal call blocks until the user chooses, which would stop the frame
    // loop (GNOME offers to force-quit the window after about five seconds, #260). Show the
    // dialog on its own thread instead; the app keeps running and acts on the answer.
    #[cfg(target_os = "linux")]
    {
        app.hooks.run_dialog = Some(Box::new(run_dialog_off_thread));
    }
    app.hooks.open_path = Some(Box::new(open_path));
    // Help menu, About and Discord links (#642): eframe is built without its `links`
    // feature, so `ctx.open_url` does nothing on the desktop. Detached, so a launcher
    // that waits for the browser never freezes the UI.
    app.hooks.open_url = Some(Box::new(|url: &str| open::that_detached(url).map_err(|e| e.to_string())));
    app.hooks.clipboard_media = Some(Box::new(clipboard_media));
    // Where files dragged in from the OS land (Windows reports no pointer during the drag).
    app.hooks.cursor_screen_position = Some(Box::new(filmcraft_platform::cursor::cursor_screen_position));
    // Settings ▸ General ▸ Interface Language ▸ System Language (#218).
    app.hooks.system_languages = Some(Box::new(|| sys_locale::get_locales().collect()));
    // Settings ▸ Appearance ▸ Appearance Mode ▸ Sync with system on Linux desktops whose
    // compositor reports no theme to winit (no polling: see appearance.rs).
    app.hooks.system_theme = appearance::service();
    app.hooks.pick_open_file = Some(Box::new(|filter: &str, exts: &[&str]| {
        rfd::FileDialog::new()
            .add_filter(filmcraft_ui_egui::i18n::t(filter), &file_filters::extensions(exts))
            .pick_file()
            .map(|p| p.to_string_lossy().to_string())
    }));
    app.hooks.pick_open_project = Some(Box::new(|| {
        rfd::FileDialog::new()
            .add_filter(filmcraft_ui_egui::i18n::t("FilmCraft Project"), &file_filters::extensions(&["fcproj"]))
            .pick_file()
            .map(|p| p.to_string_lossy().to_string())
    }));
}

/// Whether a launch file is a FilmCraft project (`args.rs`). The extension's case does not matter:
/// Windows file associations and the Linux MIME glob start the app for `CUT.FCPROJ` too (#850).
fn is_project(path: &str) -> bool {
    std::path::Path::new(path).extension().is_some_and(|e| e.eq_ignore_ascii_case("fcproj"))
}

/// `path` made absolute against the working directory (`args.rs`), so a file named relative to a
/// terminal's folder is still found once the app runs from another one (Recent Projects, the media
/// paths saved in the project). A path it cannot resolve is kept as given.
fn absolute(path: &str) -> String {
    std::path::absolute(path).ok().and_then(|p| p.into_os_string().into_string().ok()).unwrap_or_else(|| path.to_string())
}

/// The launch files as the project to open (the first one, see [`is_project`]) and the media files
/// to import (every file that is not a project), all made [`absolute`] (`args.rs`).
fn project_and_media(files: &[String]) -> (Option<String>, Vec<String>) {
    let project = files.iter().find(|f| is_project(f)).map(|f| absolute(f));
    let media = files.iter().filter(|f| !is_project(f)).map(|f| absolute(f)).collect();
    (project, media)
}

/// Files copied in the file manager, else an image, on the system clipboard (Paste, #611).
fn clipboard_media() -> Option<filmcraft_ui_egui::ClipboardMedia> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    if let Ok(files) = clipboard.get().file_list()
        && !files.is_empty()
    {
        return Some(filmcraft_ui_egui::ClipboardMedia::Files(files.iter().map(|p| p.to_string_lossy().into_owned()).collect()));
    }
    let image = clipboard.get_image().ok()?;
    Some(filmcraft_ui_egui::ClipboardMedia::Image { width: image.width, height: image.height, rgba: image.bytes.into_owned() })
}

/// Open a file in its default application, or reveal it in the file manager (Edit Original,
/// Reveal Log Files).
fn open_path(path: &str, reveal: bool) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        if reveal {
            c.arg("-R");
        }
        c.arg(path);
        c
    } else if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("explorer");
        if reveal {
            c.arg(format!("/select,{path}"));
        } else {
            c.arg(path);
        }
        c
    } else {
        // Linux file managers have no select-file flag: open the parent folder instead.
        let mut c = std::process::Command::new("xdg-open");
        let p = std::path::Path::new(path);
        c.arg(if reveal { p.parent().unwrap_or(p) } else { p });
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("can't open {path}: {e}"))
}

/// The GPU export frame renderer (filmcraft-gpu's off-screen compositor behind filmcraft-export's
/// frame-renderer hook): exports with GPU rendering Auto composite on the GPU and fall back to the
/// CPU reference renderer wherever it cannot.
struct GpuFrameRenderer(filmcraft_gpu::ExportRenderer);

impl filmcraft_export::FrameRenderer for GpuFrameRenderer {
    fn render(
        &mut self,
        project: &filmcraft_project::Project,
        seq: filmcraft_project::ItemId,
        t: filmcraft_time::Tick,
        opts: filmcraft_render::RenderOptions,
        sources: &dyn filmcraft_render::SourceProvider,
    ) -> Option<filmcraft_render::Image> {
        self.0.render(project, seq, t, opts, sources)
    }
}

fn register_gpu_frame_renderer() {
    filmcraft_export::register_frame_renderer(|| {
        filmcraft_gpu::ExportRenderer::new().map(|r| Box::new(GpuFrameRenderer(r)) as Box<dyn filmcraft_export::FrameRenderer>)
    });
}

/// Put the OS hardware video decoders in front of our own. Registered in a statement of its own:
/// a log macro does not evaluate its arguments while no logger takes its level.
fn register_hardware_decoders() -> filmcraft_platform::Availability {
    let hardware = filmcraft_platform::register();
    log::info!("hardware decoding: {hardware:?}");
    hardware
}

/// Local UTC offset at a unix time (auto-save file names and recovery times use local time).
fn local_offset(unix: i64) -> i32 {
    chrono::Local.timestamp_opt(unix, 0).single().map(|d| d.offset().local_minus_utc()).unwrap_or(0)
}

/// Show `dialog` with rfd on a worker thread and answer on the returned channel (#260). Filter
/// names are translated here, on the UI thread (the interface language is per thread). A dialog
/// thread that can't start or panics drops the sender: the app takes that as cancelled.
#[cfg(target_os = "linux")]
fn run_dialog_off_thread(dialog: filmcraft_ui_egui::native_dialogs::FileDialog) -> std::sync::mpsc::Receiver<Vec<String>> {
    use filmcraft_ui_egui::native_dialogs::FileDialog;
    let t = |s: &str| filmcraft_ui_egui::i18n::t(s).to_string();
    let media = t("Media");
    let project = t("FilmCraft Project");
    let dialog = match dialog {
        FileDialog::OpenFile { filter, exts } => FileDialog::OpenFile { filter: t(&filter), exts },
        FileDialog::SaveAs { filter, exts, name } => FileDialog::SaveAs { filter: t(&filter), exts, name },
        other => other,
    };
    let (tx, rx) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("file-dialog".into()).spawn(move || {
        let shown = std::panic::catch_unwind(move || {
            let path = |p: std::path::PathBuf| p.to_string_lossy().into_owned();
            match dialog {
                FileDialog::OpenFiles { exts } => {
                    rfd::FileDialog::new().add_filter(&media, &exts).pick_files().unwrap_or_default().into_iter().map(path).collect()
                }
                FileDialog::OpenFile { filter, exts } => rfd::FileDialog::new().add_filter(&filter, &exts).pick_file().map(path).into_iter().collect(),
                FileDialog::Relink { exts, .. } => rfd::FileDialog::new().add_filter(&media, &exts).pick_file().map(path).into_iter().collect(),
                FileDialog::OpenProject => rfd::FileDialog::new().add_filter(&project, &["fcproj"]).pick_file().map(path).into_iter().collect(),
                FileDialog::SaveProject { name } => {
                    rfd::FileDialog::new().add_filter(&project, &["fcproj"]).set_file_name(name).save_file().map(path).into_iter().collect()
                }
                FileDialog::SaveAs { filter, exts, name } => {
                    rfd::FileDialog::new().add_filter(&filter, &exts).set_file_name(name).save_file().map(path).into_iter().collect()
                }
                FileDialog::Folder { at } => {
                    let d = rfd::FileDialog::new();
                    let d = match at {
                        Some(dir) if !dir.is_empty() => d.set_directory(dir),
                        _ => d,
                    };
                    d.pick_folder().map(path).into_iter().collect::<Vec<_>>()
                }
            }
        });
        match shown {
            Ok(paths) => {
                let _ = tx.send(paths);
            }
            Err(_) => log::warn!("the file dialog thread panicked; taken as cancelled"),
        }
    });
    if let Err(e) = spawned {
        log::warn!("could not start the file dialog thread: {e}");
    }
    rx
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn the_tool_has_an_icon_and_opens_projects_and_video() {
        let t = tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"fcproj") && t.extensions.contains(&"mp4"));
        assert!(t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn filmcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&tool(), 30).unwrap();
    }

    /// From FilmCraft's `args.rs`, with the code it tests (#850).
    #[test]
    fn launch_files_are_made_absolute_and_split_case_insensitively() {
        let cwd = std::env::current_dir().unwrap();
        let nested = std::path::Path::new("clips").join("a.mp4");
        let already = cwd.join("b.wav").to_string_lossy().into_owned();
        let files = ["Cut.FCPROJ".to_string(), nested.to_string_lossy().into_owned(), "other.fcproj".to_string(), already.clone()];
        let (project, media) = project_and_media(&files);
        assert_eq!(project, Some(cwd.join("Cut.FCPROJ").to_string_lossy().into_owned()));
        assert_eq!(media, [cwd.join(&nested).to_string_lossy().into_owned(), already]);
        for p in media.iter().chain(&project) {
            assert!(std::path::Path::new(p).is_absolute() && !p.starts_with(r"\\?\"), "{p}");
        }
        assert_eq!(project_and_media(&[]), (None, vec![]));
        assert_eq!(absolute(""), "");
        for p in ["cut.fcproj", "CUT.FCPROJ", "Cut.FcProj", r"C:\Edits\CUT.FCPROJ"] {
            assert!(is_project(p), "{p}");
        }
        for p in ["cut.mp4", "fcproj", ".fcproj", "a.fcproj.mov", "a.fcprojx", ""] {
            assert!(!is_project(p), "{p}");
        }
    }
}
