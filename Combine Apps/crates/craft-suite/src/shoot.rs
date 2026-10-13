//! `--screenshot-all <dir>`: open every tab in turn, let its app settle, save a screenshot of the
//! window, then close the window the normal way (each app is asked about unsaved work). Writes
//! `<dir>/report.txt`, one line per app. A quick check that every app starts and draws inside the
//! suite.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How long an app gets to settle (load fonts, read settings) before its screenshot.
const SETTLE: Duration = Duration::from_secs(3);
const MIN_FRAMES: u32 = 30;

/// Marks our own screenshot requests, so the apps' are left to them.
#[derive(Clone, Copy, Debug)]
struct Tag(usize);

pub struct Shoot {
    dir: PathBuf,
    /// The tab being shot; past the last one, the run is over.
    pub pos: usize,
    ready_since: Option<Instant>,
    frames: u32,
    requested: bool,
    pub closing: bool,
    lines: Vec<String>,
}

impl Shoot {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, pos: 0, ready_since: None, frames: 0, requested: false, closing: false, lines: vec![] }
    }

    /// Before each pass: takes the replies to our screenshot requests out of the input. Returns
    /// the tab and image of one that arrived.
    pub fn collect(&mut self, raw: &mut egui::RawInput) -> Option<(usize, Arc<egui::ColorImage>)> {
        let mut got = None;
        raw.events.retain(|e| match e {
            egui::Event::Screenshot { user_data, image, .. } => match user_data.data.as_ref().and_then(|d| d.downcast_ref::<Tag>()) {
                Some(Tag(i)) => {
                    got = Some((*i, image.clone()));
                    false
                }
                None => true,
            },
            _ => true,
        });
        got
    }

    /// Each frame the tab being shot is on screen: `ready` once its app runs (or failed). Asks for
    /// the screenshot when it has settled.
    pub fn tick(&mut self, ctx: &egui::Context, ready: bool) {
        ctx.request_repaint();
        if !ready || self.requested {
            return;
        }
        let since = *self.ready_since.get_or_insert_with(Instant::now);
        self.frames += 1;
        if self.frames >= MIN_FRAMES && since.elapsed() >= SETTLE {
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(egui::UserData::new(Tag(self.pos))));
            self.requested = true;
        }
    }

    /// Saves the screenshot of tab `i` (`name` for the file) and moves on to the next tab.
    pub fn save(&mut self, i: usize, id: &str, image: &egui::ColorImage, status: String) {
        let file = self.dir.join(format!("{:02}-{id}.png", i + 1));
        let bytes: Vec<u8> = image.pixels.iter().flat_map(|c| c.to_array()).collect();
        let [w, h] = image.size;
        let saved = std::fs::create_dir_all(&self.dir)
            .map_err(|e| e.to_string())
            .and_then(|()| image::save_buffer(&file, &bytes, w as u32, h as u32, image::ExtendedColorType::Rgba8).map_err(|e| e.to_string()));
        let line = match saved {
            Ok(()) => format!("{id}: {status}; {}", file.display()),
            Err(e) => format!("{id}: {status}; screenshot not saved: {e}"),
        };
        log::info!("screenshot-all: {line}");
        self.lines.push(line);
        self.pos = i + 1;
        self.ready_since = None;
        self.frames = 0;
        self.requested = false;
    }

    pub fn finish(&mut self) {
        let report = self.dir.join("report.txt");
        let text = self.lines.join("\n") + "\n";
        if let Err(e) = std::fs::create_dir_all(&self.dir).and_then(|()| std::fs::write(&report, text)) {
            log::warn!("{}: {e}", report.display());
        }
        self.closing = true;
    }
}
