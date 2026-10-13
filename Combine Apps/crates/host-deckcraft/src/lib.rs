//! DeckCraft (presentations) as a tab of the ArtCraft suite.
//!
//! Adapted from DeckCraft's `apps/deckcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/deckcraft): the same app, services, preferences and AutoRecover
//! folder, which it shares with a standalone DeckCraft. Its `audio` module (media playback through
//! cpal) is used unchanged. The suite provides the window, the GPU device, the log and the title
//! bar, so DeckCraft's Windows graphics set-up (`graphics.rs`), its logger (`logging.rs`) and, on
//! Linux, its choice of X11 over Wayland are left out, as are its `--control` automation server and
//! its `--sample` and `--show` start-up switches. DeckCraft's title row leaves no room for macOS
//! traffic lights: the suite's title bar is above it. A slide show still goes full screen and opens
//! its presenter view in a second window, as in DeckCraft.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use std::path::PathBuf;

use deckcraft_engine::Session;
use deckcraft_ui_egui::{Services, SlideApp};

// Under the lints of DeckCraft's workspace.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
#[cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#[path = "../../../vendor/deckcraft/apps/deckcraft/src/audio.rs"]
mod audio;

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "deckcraft",
        name: "DeckCraft",
        summary: "Presentations and slide shows",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/deckcraft.png"),
        extensions: &["deckcraft", "pptx", "potx", "ppsx", "slidecraft"],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |_cc| {
        let mut app = SlideApp::new(Session::new(), services());
        let prefs = prefs_enabled() && !startup.no_settings;
        if prefs {
            load_prefs(&mut app);
        }
        // AutoRecover: reopen what a previous run left unsaved, then keep it current.
        if std::env::var_os("DECKCRAFT_NO_RECOVERY").is_none() && !startup.no_settings {
            app.session.recovery_dir = deckcraft_engine::recovery::default_dir();
            if let Ok(v) = app.session.execute("file.recovery.open", &serde_json::json!({}))
                && let Some(n) = v.get("opened").and_then(|o| o.as_array()).map(Vec::len).filter(|n| *n > 0)
            {
                app.set_status(format!("Recovered {n} unsaved presentation{} from the last session", if n == 1 { "" } else { "s" }));
            }
        }
        app.integrated_titlebar = false;
        for f in &startup.files {
            let Some(path) = f.to_str() else {
                log::error!("{}: not a UTF-8 path", f.display());
                continue;
            };
            if let Err(e) = app.open_path(path) {
                log::error!("{path}: {e}");
            }
        }
        Box::new(App { app, prefs, quit_at: None })
    })
}

struct App {
    app: SlideApp,
    /// Read and save the user's preferences.
    prefs: bool,
    /// The frame in which the user confirmed quitting (DeckCraft's "save changes?" answered), which
    /// asked the window to close.
    quit_at: Option<u64>,
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Another app in the window kept it open after DeckCraft agreed to close: the quit is
        // cancelled, and DeckCraft asks about unsaved changes again next time. (A standalone
        // DeckCraft has quit by now.)
        if self.app.quit_confirmed && self.quit_at.is_some_and(|f| ctx.cumulative_frame_nr() > f + 1) && !ctx.input(|i| i.viewport().close_requested()) {
            self.app.quit_confirmed = false;
            self.quit_at = None;
        }
        self.app.logic(ctx);
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.app.ui(ui);
        if self.app.quit_confirmed && self.quit_at.is_none() {
            self.quit_at = Some(ui.ctx().cumulative_frame_nr());
        }
    }

    fn on_exit(&mut self) {
        if self.prefs {
            save_prefs(&self.app);
        }
    }
}

/// DeckCraft's settings folder, shared with a standalone DeckCraft: `ui.json` and `prefs.json`.
fn config_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/DeckCraft"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("DeckCraft"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|c| c.join("deckcraft"))
    }
}

fn prefs_path() -> Option<PathBuf> {
    config_dir().map(|b| b.join("ui.json"))
}

/// `DECKCRAFT_NO_PREFS` runs neither read nor write them, as in DeckCraft.
fn prefs_enabled() -> bool {
    std::env::var_os("DECKCRAFT_NO_PREFS").is_none()
}

fn load_prefs(app: &mut SlideApp) {
    if let Some(p) = prefs_path()
        && let Ok(bytes) = std::fs::read(&p)
        && let Ok(ui) = serde_json::from_slice::<deckcraft_ui_egui::UiState>(&bytes)
    {
        app.ui = ui;
    }
    if let Some(p) = prefs_path().map(|p| p.with_file_name("prefs.json"))
        && let Ok(bytes) = std::fs::read(&p)
        && let Ok(prefs) = serde_json::from_slice::<deckcraft_engine::Prefs>(&bytes)
    {
        app.session.prefs = prefs;
    }
}

fn save_prefs(app: &SlideApp) {
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

fn services() -> Services {
    Services {
        pick_open: Some(Box::new(|purpose: &str| {
            let d = rfd::FileDialog::new();
            let d = match purpose {
                "picture" => d.add_filter("Pictures", &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"]),
                "audio" => d.add_filter(
                    "Audio",
                    &["wav", "mp3", "m4a", "m4b", "aac", "flac", "ogg", "oga", "opus", "aif", "aiff", "aifc", "caf", "wma", "weba", "mka"],
                ),
                "video" => d.add_filter("Video", &["mp4", "m4v", "mov", "webm", "mkv", "wmv"]),
                _ => d
                    .add_filter("Presentations", &["deckcraft", "pptx", "potx", "ppsx"])
                    .add_filter("DeckCraft", &["deckcraft"])
                    .add_filter("PowerPoint", &["pptx", "potx", "ppsx"])
                    .add_filter("Outline", &["txt", "md"]),
            };
            d.pick_file().map(|p| p.to_string_lossy().to_string())
        })),
        pick_save: Some(Box::new(|name: &str| rfd::FileDialog::new().set_file_name(name).save_file().map(|p| p.to_string_lossy().to_string()))),
        read: Some(Box::new(|p: &str| std::fs::read(p).map_err(|e| e.to_string()))),
        write: Some(Box::new(|p: &str, b: &[u8]| std::fs::write(p, b).map_err(|e| e.to_string()))),
        clipboard_image: Some(Box::new(|| {
            let mut cb = arboard::Clipboard::new().ok()?;
            let img = cb.get_image().ok()?;
            let rgba = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())?;
            let mut out = Vec::new();
            rgba.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).ok()?;
            Some(out)
        })),
        // Media is mixed and clocked by the output device; `DECKCRAFT_NO_AUDIO` plays silently.
        audio_out: std::env::var_os("DECKCRAFT_NO_AUDIO").is_none().then(|| Box::new(audio::CpalOut::default()) as Box<dyn deckcraft_media::AudioOut>),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    #[test]
    fn the_tool_has_an_icon_and_opens_presentations() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"pptx") && t.extensions.contains(&"deckcraft"));
        assert!(t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn deckcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }
}
