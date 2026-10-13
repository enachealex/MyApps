//! PdfCraft (reading, organizing and protecting PDFs) as a tab of the ArtCraft suite.
//!
//! Adapted from PdfCraft's `apps/pdfcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/pdfcraft), with its `motion`, `reopen`, `text_scale` and `updates`
//! modules used unchanged: the same app, services, crash recovery and update check. The suite
//! provides the window, the GPU device, the log and the title bar, so PdfCraft's own renderer
//! choice (wgpu, retried with OpenGL when it can't start), adapter selection and surface size
//! limits, logger, panic hook and window options are left out, as are its `--control` automation
//! channel and command-line view options, its single-instance hand-off (later launches passing
//! their files to the running window) and, on macOS, Finder file opens through Apple events and
//! the title bar drawn into its tab strip (one window of several apps has one title bar, the
//! suite's).
//!
//! PdfCraft keeps its preferences, recent files, signatures and digital IDs in eframe storage,
//! which in the suite is PdfCraft's own store in the suite's settings folder. It starts as a copy
//! of a standalone PdfCraft's `app.ron` (`Tool::standalone_storage`), and is the suite's from then on.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

#[cfg(target_os = "windows")]
#[path = "../../../vendor/pdfcraft/apps/pdfcraft/src/motion.rs"]
mod motion;
#[path = "../../../vendor/pdfcraft/apps/pdfcraft/src/reopen.rs"]
mod reopen;
#[path = "../../../vendor/pdfcraft/apps/pdfcraft/src/text_scale.rs"]
mod text_scale;
// Its tests unwrap, as PdfCraft's clippy.toml allows in tests.
#[cfg_attr(test, allow(clippy::unwrap_used))]
#[path = "../../../vendor/pdfcraft/apps/pdfcraft/src/updates.rs"]
mod updates;

use std::path::PathBuf;

use pdfcraft_ui_egui::PdfCraftApp;

/// The app was called PrintCraft before; settings saved then are under this key.
const LEGACY_STORAGE_KEY: &str = "printcraft";

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "pdfcraft",
        name: "PdfCraft",
        summary: "Reading, organizing and protecting PDFs",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/pdfcraft.png"),
        extensions: &["pdf"],
        prepare,
        // Its preferences, recent files, signatures and digital IDs live in its eframe storage.
        standalone_storage: Some(|| settings_dir().map(|d| d.join("app.ron"))),
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |cc| Box::new(start(cc, startup)))
}

fn start(cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> PdfCraftApp {
    let settings = !startup.no_settings;
    if settings {
        migrate_legacy_folders();
    }
    let mut app = PdfCraftApp::new();
    // First start (or settings from before Units existed): the region's unit.
    app.units = pdfcraft_ui_egui::units::Unit::system();
    #[cfg(target_os = "linux")]
    app.enable_desktop_theme();
    // The system's reopen-windows choice (macOS) starts the preference; a saved choice replaces it.
    app.reopen_last_session = reopen::system_default();
    if settings && let Some(json) = cc.storage.and_then(|s| s.get_string("pdfcraft").or_else(|| s.get_string(LEGACY_STORAGE_KEY))) {
        app.restore(&json);
    }
    app.integrated_titlebar = false;
    app.system_text_scale = text_scale::system();
    // Windows' Animation effects setting, which Preferences ▸ Animation effects follows unless
    // it is set to On or Off.
    #[cfg(target_os = "windows")]
    {
        app.motion.source = Some(motion::source());
    }
    app.update_source = Some(std::sync::Arc::new(updates::latest_release));
    app.printer_source = Some(pdfcraft_ui_egui::system_printers());
    app.os_key_store_ids = cfg!(any(target_os = "macos", target_os = "windows"));
    if settings {
        // Autosave unsaved changes; offer to recover documents a crashed session left behind.
        if let Some(dir) = pdfcraft_ui_egui::RecoveryStore::default_dir() {
            app.enable_recovery(pdfcraft_ui_egui::RecoveryStore::new(dir));
        }
        // A portable marker whose data folder can't be written (#157): say where settings went.
        if let Some(w) = &pdfcraft_ui_egui::portable::current().unwritable {
            app.notify_fmt(
                "Portable mode is off: {folder} can't be written ({error}). Settings are kept in your user folder instead.",
                &[("folder", &w.folder.display().to_string()), ("error", &w.error)],
            );
        }
    }
    if let Some(state) = &cc.wgpu_render_state {
        notify_software_renderer(&mut app, state.adapter.get_info().device_type);
    }
    let files: Vec<String> = startup
        .files
        .iter()
        .filter_map(|f| match f.to_str() {
            Some(f) => Some(path_from_arg(f.to_owned())),
            None => {
                log::warn!("{}: PdfCraft only opens files whose names are Unicode", f.display());
                None
            }
        })
        .collect();
    // With the preference on, last session's files come back first; files named on the command
    // line open after them, in front (#442).
    app.reopen_last_files(&files);
    for f in files {
        app.open_path(&f);
    }
    app
}

/// Tell the user when wgpu draws on the processor (WARP on Windows, llvmpipe on Linux) rather than
/// a GPU, which makes everything slower (#519). From `apps/pdfcraft/src/main.rs`.
fn notify_software_renderer(app: &mut PdfCraftApp, device_type: eframe::wgpu::DeviceType) {
    if device_type == eframe::wgpu::DeviceType::Cpu {
        app.notify_tr("PdfCraft is drawing without a graphics processor, so it may be slow. Updating the graphics driver may help.");
    }
}

/// PdfCraft's settings folder: `PdfCraftData` beside the executable in portable mode (#157),
/// otherwise eframe's folder for "PdfCraft". From `apps/pdfcraft/src/main.rs`.
fn settings_dir() -> Option<PathBuf> {
    if let Some(dir) = pdfcraft_ui_egui::portable::data_dir() {
        return Some(dir.to_path_buf());
    }
    eframe::storage_dir("PdfCraft")
}

/// Move the settings and crash-recovery folders of the app's former name, PrintCraft, to the new
/// name once, so an upgrade keeps recent files, preferences and unsaved work. Best effort: a
/// folder is left alone when the new one already exists or the move fails. A portable copy leaves
/// the per-user folders alone. From `apps/pdfcraft/src/main.rs`.
fn migrate_legacy_folders() {
    if pdfcraft_ui_egui::portable::data_dir().is_some() {
        return;
    }
    let mut moves = vec![(eframe::storage_dir("PrintCraft"), settings_dir())];
    // Recovery lives in the settings folder except on Windows, where it is under %LOCALAPPDATA%.
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").filter(|v| !v.is_empty()).map(PathBuf::from);
        moves.push((local.as_ref().map(|d| d.join("PrintCraft")), local.map(|d| d.join("PdfCraft"))));
    }
    for (old, new) in moves {
        let (Some(old), Some(new)) = (old, new) else { continue };
        if !old.is_dir() || new.exists() {
            continue;
        }
        if let Some(parent) = new.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::rename(&old, &new) {
            Ok(()) => log::info!("moved {} to {}", old.display(), new.display()),
            Err(e) => log::warn!("moving {} to {}: {e}", old.display(), new.display()),
        }
    }
}

/// Desktop launchers (GNOME Files, KDE Dolphin…) pass `file://` URIs (`%U`); decode a local one
/// (`file:///path` or `file://localhost/path`) to a plain path. Other schemes, URIs naming another
/// host, and plain paths pass through untouched. From `apps/pdfcraft/src/main.rs`.
fn path_from_arg(arg: String) -> String {
    let Some(rest) = arg.strip_prefix("file://") else { return arg };
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if !rest.starts_with('/') {
        return arg;
    }
    // `file:///C:/x.pdf` on Windows names `C:/x.pdf`. `rest` starts with the one-byte '/', so
    // byte 1 is a char boundary.
    let rest = if cfg!(windows) && rest.as_bytes().get(2) == Some(&b':') { &rest[1..] } else { rest };
    let mut out = Vec::with_capacity(rest.len());
    let mut bytes = rest.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hex = bytes.clone().take(2).collect::<Vec<u8>>();
            if let Some(byte) = std::str::from_utf8(&hex).ok().filter(|h| h.len() == 2).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                bytes.nth(1);
                continue;
            }
        }
        out.push(b);
    }
    String::from_utf8(out).unwrap_or(arg)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_pdfs() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"pdf") && t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn pdfcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }

    #[test]
    fn file_uris_from_launchers_become_paths() {
        assert_eq!(super::path_from_arg("file:///home/alice/my%20report.pdf".into()), "/home/alice/my report.pdf");
        assert_eq!(super::path_from_arg("file://localhost/tmp/a%C3%A9.pdf".into()), "/tmp/aé.pdf");
        assert_eq!(super::path_from_arg("report.pdf".into()), "report.pdf");
        assert_eq!(super::path_from_arg("file://server/share/a.pdf".into()), "file://server/share/a.pdf");
    }
}
