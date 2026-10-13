//! GridCraft (spreadsheets) as a tab of the ArtCraft suite.
//!
//! Adapted from GridCraft's `apps/gridcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/gridcraft): the same app, services and preferences, which it
//! shares with a standalone GridCraft. The suite provides the window, the GPU device, the log and
//! the title bar, so GridCraft's own start-up GPU probe and logger are left out, as are its
//! `--control` automation server and, on macOS, its menu-bar menus and Finder file opens (one
//! window of several apps can't hand the menu bar to one of them).
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use gridcraft_engine::Session;
use gridcraft_ui_egui::{Services, SheetApp};

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "gridcraft",
        name: "GridCraft",
        summary: "Spreadsheets and data",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/gridcraft.png"),
        extensions: &["xlsx", "xlsm", "xls", "xlsb", "ods", "csv", "tsv"],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |cc| {
        let mut session = Session::new();
        if session.documents().is_empty() {
            session.new_workbook();
        }
        let mut app = SheetApp::new(session, services());
        app.watch_desktop_theme();
        app.after_engine();
        let prefs = prefs_enabled() && !startup.no_settings;
        if prefs {
            load_prefs(&mut app);
        }
        // As File › Open opens them: a password-protected one asks for its password, and each
        // replaces the untouched blank Book1.
        for f in startup.files.iter().filter_map(|f| f.to_str()) {
            app.open_path(f);
        }
        SheetApp::setup_context_for_language(&cc.egui_ctx, app.ui.dark, app.ui.language);
        Box::new(App { app, prefs })
    })
}

struct App {
    app: SheetApp,
    /// Read and save the user's preferences.
    prefs: bool,
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.app.logic(ctx);
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
        // Files dropped on the window open as workbooks.
        for f in std::mem::take(&mut raw.dropped_files) {
            if let Some(p) = f.path().to_str().filter(|p| !p.is_empty()) {
                self.app.open_path(p);
            }
        }
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

/// GridCraft's settings folder, shared with a standalone GridCraft.
fn config_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/GridCraft"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("GridCraft"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|c| c.join("gridcraft"))
    }
}

/// `GRIDCRAFT_NO_PREFS` runs neither read nor write them, as in GridCraft.
fn prefs_enabled() -> bool {
    std::env::var_os("GRIDCRAFT_NO_PREFS").is_none()
}

fn load_prefs(app: &mut SheetApp) {
    // First run (or a ui.json without a usable language): follow the desktop's language, and its
    // light or dark appearance until a theme is chosen.
    app.ui.language = gridcraft_ui_egui::i18n::Language::system();
    app.ui.system_theme = true;
    let Some(dir) = config_dir() else { return };
    if let Ok(b) = std::fs::read(dir.join("ui.json"))
        && let Ok(ui) = serde_json::from_slice::<gridcraft_ui_egui::UiState>(&b)
    {
        let saved = serde_json::from_slice(&b).ok().and_then(|v| gridcraft_ui_egui::i18n::saved_language(&v));
        let language = saved.unwrap_or(app.ui.language);
        app.ui = ui;
        app.ui.language = language;
    }
    if let Ok(b) = std::fs::read(dir.join("prefs.json"))
        && let Ok(p) = serde_json::from_slice(&b)
    {
        app.session.prefs = p;
    }
}

fn save_prefs(app: &SheetApp) {
    let Some(dir) = config_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(b) = serde_json::to_vec_pretty(&app.ui) {
        let _ = std::fs::write(dir.join("ui.json"), b);
    }
    if let Ok(b) = serde_json::to_vec_pretty(&app.session.prefs) {
        let _ = std::fs::write(dir.join("prefs.json"), b);
    }
}

fn services() -> Services {
    // Keep the owner alive: X11/Wayland serve clipboard data from this handle.
    let clipboard: Rc<RefCell<Option<arboard::Clipboard>>> = Rc::default();
    let paste_clipboard = clipboard.clone();
    Services {
        copy_html: Some(Box::new(move |html, text| {
            let mut clipboard = clipboard.borrow_mut();
            if clipboard.is_none() {
                *clipboard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
            }
            clipboard.as_mut().ok_or("clipboard unavailable")?.set_html(html, Some(text)).map_err(|e| e.to_string())
        })),
        paste_html: Some(Box::new(move || {
            let mut clipboard = paste_clipboard.try_borrow_mut().ok()?;
            if clipboard.is_none() {
                *clipboard = arboard::Clipboard::new().ok();
            }
            clipboard.as_mut()?.get().html().ok()
        })),
        pick_open: Some(Box::new(|| {
            rfd::FileDialog::new()
                .add_filter("Spreadsheets", &["xlsx", "xlsm", "xls", "xlsb", "ods", "csv", "tsv", "txt", "json"])
                .add_filter("Excel Workbook", &["xlsx", "xlsm"])
                .add_filter("Excel 97-2003 Workbook (import)", &["xls"])
                .add_filter("Excel Binary Workbook (data import)", &["xlsb"])
                .add_filter("OpenDocument Spreadsheet (data import)", &["ods"])
                .add_filter("CSV", &["csv"])
                .pick_file()
                .and_then(|p| p.to_str().map(str::to_string))
        })),
        pick_picture: Some(Box::new(|| {
            rfd::FileDialog::new().add_filter("Pictures (PNG, JPEG)", &["png", "jpg", "jpeg"]).pick_file().and_then(|p| p.to_str().map(str::to_string))
        })),
        pick_save: Some(Box::new(|suggested: &str| {
            let path = Path::new(suggested);
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Book1").to_string();
            // The suggested name's type (an export asks for .pdf, .csv or .html) comes first.
            const TYPES: [(&str, &str); 4] =
                [("Excel Workbook (.xlsx)", "xlsx"), ("CSV UTF-8 (.csv)", "csv"), ("Web Page (.html)", "html"), ("PDF (.pdf)", "pdf")];
            let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).filter(|e| TYPES.iter().any(|(_, x)| x == e));
            let ext = ext.unwrap_or_else(|| "xlsx".to_string());
            let mut dialog = rfd::FileDialog::new().set_file_name(format!("{stem}.{ext}"));
            for (label, x) in TYPES.iter().filter(|(_, x)| *x == ext).chain(TYPES.iter().filter(|(_, x)| *x != ext)) {
                dialog = dialog.add_filter(*label, &[*x]);
            }
            dialog.save_file().and_then(|p| p.to_str().map(str::to_string))
        })),
        open_url: Some(Box::new(|url: &str| open_with_system(url))),
        // File › Print: the print PDF opens in the system's PDF viewer, whose Print command
        // reaches the printer dialog.
        print: Some(Box::new(|bytes: &[u8]| match write_print_pdf(&std::env::temp_dir(), bytes) {
            Ok(path) => open_with_system(&path.to_string_lossy()),
            Err(e) => log::warn!("print: {e}"),
        })),
        ..Default::default()
    }
}

/// Opens a URL or file with the system's default application.
fn open_with_system(target: &str) {
    let cmd = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    if let Err(e) = std::process::Command::new(cmd).arg(target).spawn() {
        log::warn!("{cmd} {target}: {e}");
    }
}

/// Writes a print PDF into `dir` under a fresh name (an earlier print may still be open in the
/// viewer), created exclusively so an existing file or planted symlink is never followed.
fn write_print_pdf(dir: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    use std::io::Write;
    static PRINTS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    for _ in 0..64 {
        let n = PRINTS.fetch_add(1, std::sync::atomic::Ordering::Relaxed).wrapping_add(1);
        let path = dir.join(format!("GridCraft print {}-{n}.pdf", std::process::id()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        match options.open(&path) {
            Ok(mut file) => {
                file.write_all(bytes)?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "no free print file name"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_spreadsheets() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"xlsx") && t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn gridcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }

    #[test]
    fn print_pdfs_get_fresh_names() {
        let dir = std::env::temp_dir().join(format!("host-gridcraft-print-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = super::write_print_pdf(&dir, b"%PDF-1.4 a").unwrap();
        let b = super::write_print_pdf(&dir, b"%PDF-1.4 b").unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read(&b).unwrap(), b"%PDF-1.4 b");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
