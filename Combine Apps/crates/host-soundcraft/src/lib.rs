//! SoundCraft (recording, editing and mixing audio) as a tab of the ArtCraft suite.
//!
//! Adapted from SoundCraft's `apps/soundcraft/src/main.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/soundcraft), with its `config` module used unchanged: the same
//! engine, audio device, preferences (`ui.json`), autosave and plugin-preset folders, file dialogs
//! and close handling, shared with a standalone SoundCraft. The suite provides the window, the GPU
//! device, the log and the title bar, so SoundCraft's own window options (including the window
//! size and maximized state it restores from `ui.json`, left there untouched, and its first-frame
//! fit to the screen), Windows graphics set-up (`graphics.rs`) and logger are left out, as are its
//! `--control` automation server, its `--demo` and `--no-audio` options and, on macOS, its
//! menu-bar menus (one window of several apps can't hand the menu bar to one of them; SoundCraft's
//! in-window menu bar shows instead, and the title carries no Edit/Mix or unsaved mark).
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

// Its tests unwrap, as SoundCraft's clippy.toml allows in tests.
#[cfg_attr(test, allow(clippy::unwrap_used))]
#[path = "../../../vendor/soundcraft/apps/soundcraft/src/config.rs"]
mod config;

use std::path::PathBuf;
use std::sync::Arc;

use soundcraft_engine::Engine;
use soundcraft_ui_egui::{Services, SoundApp, UiState, dialogs};

pub fn tool() -> craft_suite::Tool {
    craft_suite::Tool {
        id: "soundcraft",
        name: "SoundCraft",
        summary: "Recording, editing and mixing audio",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icons/soundcraft.png"),
        // Sessions, the audio files of its Import dialog (video containers belong to FilmCraft)
        // and MIDI.
        extensions: &["scraft", "wav", "wave", "bwf", "aif", "aiff", "aifc", "flac", "mp3", "ogg", "oga", "m4a", "aac", "caf", "mid", "midi", "smf"],
        prepare,
        standalone_storage: None,
    }
}

fn prepare(_cc: &eframe::CreationContext<'_>, startup: craft_suite::Startup) -> craft_suite::Launch {
    Box::new(move |_cc| {
        let prefs_enabled = prefs_enabled() && !startup.no_settings;
        let engine = Engine::default();
        let prefs = if prefs_enabled { load_prefs() } else { None }.unwrap_or_default();
        // The audio output device opens now, as SoundCraft's window opens.
        let player = Some(soundcraft_playback::Player::new(Arc::new(engine.session().clone())));
        let mut app = SoundApp::new(engine, player, services());
        let dir = if startup.no_settings { Some(no_settings_dir()) } else { config::config_dir() };
        app.autosave_dir = dir.as_ref().map(|d| d.join("Autosave"));
        app.preset_dir = dir.map(|d| d.join("Presets"));
        app.extra.ui_scale = prefs.ui_scale;
        app.ui = prefs;
        for f in &startup.files {
            open_path(&mut app, &f.to_string_lossy());
        }
        Box::new(App { app, prefs: prefs_enabled, frame: 0 })
    })
}

/// main.rs's `App`, without what the suite owns (logger, menu bar, window size).
struct App {
    app: SoundApp,
    /// Read and save `ui.json`.
    prefs: bool,
    /// The frame `logic` last ran in.
    frame: u64,
}

/// Sends the title only when it changes, remembered here as X11 and Wayland can't read it back.
fn set_title(ctx: &egui::Context, title: String) {
    let id = egui::Id::new("window_title");
    if ctx.data(|d| d.get_temp::<String>(id)).as_deref() != Some(title.as_str()) {
        ctx.data_mut(|d| d.insert_temp(id, title.clone()));
        ctx.send_viewport_cmd(egui::ViewportCommand::Title(title));
    }
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // craft-suite: Quit closes the window, and SoundCraft keeps asking to close it until it
        // does. In the suite another app can keep it open (its "save changes?" prompt, cancelled),
        // and SoundCraft is hidden meanwhile: shown again with no close under way, it forgets the
        // Quit, or the window would start closing again every time SoundCraft is shown.
        let frame = ctx.cumulative_frame_nr();
        let was_hidden = frame > self.frame.saturating_add(1);
        self.frame = frame;
        if was_hidden && self.app.quit_requested && !ctx.input(|i| i.viewport().close_requested()) {
            self.app.quit_requested = false;
        }
        self.app.logic(ctx);
        // Files dropped on the window: sessions open, audio/MIDI import.
        let dropped: Vec<String> =
            ctx.input(|i| i.raw.dropped_files.iter().map(|f| f.path().to_string_lossy().into_owned()).filter(|s| !s.is_empty()).collect());
        for p in dropped {
            open_path(&mut self.app, &p);
        }
        if self.app.quit_requested {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        } else if ctx.input(|i| i.viewport().close_requested()) && dialogs::ask_to_save(&mut self.app, "app.quit", &serde_json::json!({})) {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
        }
        self.app.ui.ui_scale = self.app.extra.ui_scale;
        set_title(ctx, format!("{} — SoundCraft", self.app.engine.session().name));
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.app.ui(ui);
    }

    fn on_exit(&mut self) {
        if self.prefs {
            save_prefs(&self.app.ui);
        }
        // Release the player's plugin instances and shut plugin hosting down.
        self.app.player = None;
        soundcraft_engine::shutdown_plugin_hosts();
    }

    /// SoundCraft's eframe keeps no state between runs (it has no persistence): `ui.json` does.
    fn persist_egui_memory(&self) -> bool {
        false
    }
}

fn open_path(app: &mut SoundApp, p: &str) {
    let lower = p.to_ascii_lowercase();
    let r = if lower.ends_with(".scraft") {
        dialogs::run_or_ask(app, "session.open", serde_json::json!({"path": p}))
    } else if lower.ends_with(".mid") || lower.ends_with(".midi") || lower.ends_with(".smf") {
        app.run("file.import_midi", serde_json::json!({"path": p}))
    } else {
        let at = app.engine.session().edit.selection.start;
        app.run("file.import_audio", serde_json::json!({"path": p, "at": at}))
    };
    if let Err(e) = r {
        log::warn!("{p}: {e}");
    }
}

fn prefs_path() -> Option<PathBuf> {
    config::config_dir().map(|b| b.join("ui.json"))
}

/// Runs without preferences (`SOUNDCRAFT_NO_PREFS`) neither read nor write them.
fn prefs_enabled() -> bool {
    std::env::var_os("SOUNDCRAFT_NO_PREFS").is_none()
}

fn load_prefs() -> Option<UiState> {
    let path = prefs_path()?;
    match config::load_ui(&path) {
        Ok(state) => state,
        Err(error) => {
            log::warn!("{error}");
            None
        }
    }
}

fn save_prefs(ui: &UiState) {
    if let Some(path) = prefs_path()
        && let Err(error) = config::save_ui(&path, ui)
    {
        log::warn!("{error}");
    }
}

/// The autosave and preset folders with `no_settings`: this run's own.
fn no_settings_dir() -> PathBuf {
    std::env::temp_dir().join(format!("craft-suite-soundcraft-{}", std::process::id()))
}

fn services() -> Services {
    Services {
        pick_open: Some(Box::new(|purpose: &str, _exts: &[&str]| {
            let d = rfd::FileDialog::new();
            let d = match purpose {
                "session.open" => d.add_filter("SoundCraft Session", &["scraft"]),
                "file.import_midi" => d.add_filter("MIDI", &["mid", "midi", "smf"]),
                _ => d.add_filter(
                    "Audio",
                    &["wav", "wave", "bwf", "aif", "aiff", "aifc", "flac", "mp3", "ogg", "oga", "m4a", "aac", "mp4", "caf", "mkv", "webm"],
                ),
            };
            d.pick_file().map(|p| p.to_string_lossy().into_owned())
        })),
        pick_save: Some(Box::new(|_purpose: &str, default: &str| {
            let path = std::path::Path::new(default);
            let mut d = rfd::FileDialog::new().add_filter("SoundCraft Session", &["scraft"]);
            if let Some(n) = path.file_name().and_then(|n| n.to_str()) {
                d = d.set_file_name(n);
            }
            d.save_file().map(|p| p.to_string_lossy().into_owned())
        })),
        pick_folder: Some(Box::new(|start: &str| rfd::FileDialog::new().set_directory(start).pick_folder().map(|p| p.to_string_lossy().into_owned()))),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use soundcraft_engine::Engine;
    use soundcraft_ui_egui::{Services, SoundApp};

    #[test]
    fn the_tool_has_an_icon_and_opens_sessions_and_audio() {
        let t = super::tool();
        assert!(t.icon_png.starts_with(b"\x89PNG"));
        assert!(t.extensions.contains(&"scraft") && t.extensions.contains(&"wav"));
        assert!(t.extensions.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn soundcraft_starts_and_draws_in_the_suite() {
        craft_suite::smoke_test(&super::tool(), 30).unwrap();
    }

    /// Quit asks to close the window until it closes; once another app has kept the window open
    /// (SoundCraft hidden meanwhile), showing SoundCraft again doesn't start closing it again.
    #[test]
    fn a_quit_the_window_outlived_is_forgotten() {
        use eframe::App as _;
        use egui::ViewportCommand::{CancelClose, Close};
        let ctx = egui::Context::default();
        let mut frame = eframe::Frame::_new_kittest();
        let mut app = super::App { app: SoundApp::new(Engine::default(), None, Services::default()), prefs: false, frame: 0 };
        let mut run = |app: &mut super::App, shown: bool, close: bool| {
            let mut input = egui::RawInput::default();
            if close {
                input.viewports.entry(egui::ViewportId::ROOT).or_default().events.push(egui::ViewportEvent::Close);
            }
            let mut out = ctx.run_ui(input, |ui| {
                if shown {
                    app.logic(ui.ctx(), &mut frame);
                }
            });
            out.textures_delta.clear();
            out.viewport_output.remove(&egui::ViewportId::ROOT).map(|v| v.commands).unwrap_or_default()
        };
        run(&mut app, true, false);
        app.app.quit_requested = true;
        assert!(run(&mut app, true, false).contains(&Close));
        // The close request: SoundCraft lets the window close.
        let commands = run(&mut app, true, true);
        assert!(commands.contains(&Close) && !commands.contains(&CancelClose));
        // Another app is asked and keeps the window open; SoundCraft is shown again later.
        run(&mut app, false, false);
        run(&mut app, false, false);
        assert!(!run(&mut app, true, false).contains(&Close));
        assert!(!app.app.quit_requested);
        // Shown again for a close under way, a pending Quit still lets the window close.
        app.app.quit_requested = true;
        assert!(run(&mut app, true, false).contains(&Close));
        run(&mut app, false, false);
        assert!(run(&mut app, true, true).contains(&Close));
        assert!(app.app.quit_requested);
    }
}
