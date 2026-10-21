//! The Home tab: the window's apps, the version of each, and their updates ([`crate::update`]).
//!
//! It is the window's first tab, and an app like the others to the host, so it has its own look
//! and state and takes part in tab switching as they do. It asks the host for what only the host
//! can do (show another tab, restart the window) through [`Request`]s.

use std::sync::Arc;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use egui::{Align, Color32, CornerRadius, Frame, Layout, Margin, RichText, Stroke, Ui, vec2};

use crate::update::{Check, Job, Step, Target, Updates};

/// One app, as the Home page lists it.
pub struct Entry {
    /// Its tab in the window.
    pub tab: usize,
    pub id: &'static str,
    pub name: &'static str,
    pub summary: &'static str,
    pub icon: Option<egui::TextureId>,
}

/// What the Home page asks of the window.
#[derive(Debug, PartialEq)]
pub enum Request {
    Show(usize),
    /// Close the window (each app asked as on any close) and start the updated program.
    Restart,
}

pub fn launch(suite: &'static str, entries: Vec<Entry>, updates: Arc<Updates>, requests: Sender<Request>) -> crate::Launch {
    Box::new(move |cc| {
        cc.egui_ctx.set_visuals(egui::Visuals::dark());
        Box::new(HomeApp { suite, entries, updates, requests })
    })
}

const BG: Color32 = Color32::from_rgb(0x14, 0x16, 0x1b);
const CARD: Color32 = Color32::from_rgb(0x1e, 0x21, 0x28);
const BORDER: Color32 = Color32::from_rgb(0x2c, 0x30, 0x39);
const TEXT: Color32 = Color32::from_rgb(0xe8, 0xea, 0xee);
const DIM: Color32 = Color32::from_rgb(0x95, 0x9b, 0xa6);
const ACCENT: Color32 = Color32::from_rgb(0x4c, 0x8d, 0xff);
const GREEN: Color32 = Color32::from_rgb(0x3d, 0xdc, 0x91);
const AMBER: Color32 = Color32::from_rgb(0xf2, 0xb3, 0x4a);
const RED: Color32 = Color32::from_rgb(0xf2, 0x6d, 0x6d);
const CARD_WIDTH: f32 = 380.0;

struct HomeApp {
    suite: &'static str,
    entries: Vec<Entry>,
    updates: Arc<Updates>,
    requests: Sender<Request>,
}

impl eframe::App for HomeApp {
    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        let job = self.updates.job();
        // Elapsed times and "checked … ago" move on by themselves.
        ui.ctx().request_repaint_after(if matches!(job, Job::Running { .. }) { Duration::from_secs(1) } else { Duration::from_secs(30) });
        egui::CentralPanel::default().frame(Frame::new().fill(BG).inner_margin(Margin::symmetric(32, 26))).show(ui, |ui| {
            egui::ScrollArea::vertical().auto_shrink(false).show(ui, |ui| {
                ui.set_max_width(ui.available_width().min(3.0 * CARD_WIDTH + 2.0 * 16.0));
                self.header(ui, &job);
                self.job_panel(ui, &job);
                ui.add_space(14.0);
                self.cards(ui, &job);
            });
        });
    }

    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        BG.to_normalized_gamma_f32()
    }
}

impl HomeApp {
    fn header(&self, ui: &mut Ui, job: &Job) {
        ui.label(RichText::new(self.suite).size(26.0).strong().color(TEXT));
        ui.add_space(4.0);
        let checking = self.entries.iter().any(|e| self.updates.check_of(e.id) == Some(Check::Checking));
        let available = self.updates.available();
        ui.horizontal(|ui| {
            let apps = format!("{} apps", self.entries.len());
            if checking {
                ui.label(RichText::new(format!("{apps} · checking for updates")).color(DIM));
                ui.add(egui::Spinner::new().size(12.0));
            } else {
                let when = self.updates.checked_at().map(ago).unwrap_or_default();
                let status = match available {
                    0 => "all up to date".to_owned(),
                    1 => "1 update available".to_owned(),
                    n => format!("{n} updates available"),
                };
                ui.label(RichText::new(format!("{apps} · {status} · checked {when}")).color(DIM));
                if ui.add_enabled(!self.updates.busy(), egui::Button::new("Check again").small()).clicked() {
                    self.updates.check();
                }
            }
        });
        if let Some(why) = self.updates.blocked() {
            ui.add_space(6.0);
            ui.label(RichText::new(why).color(AMBER));
        } else if available >= 2 && !matches!(job, Job::Running { .. }) {
            ui.add_space(10.0);
            let pending: Vec<&str> =
                self.entries.iter().filter(|e| matches!(self.updates.check_of(e.id), Some(Check::Available { .. }))).map(|e| e.id).collect();
            let label = format!("Update all {}", pending.len());
            if primary(ui, &label).on_hover_text("One rebuild with every app's newest release").clicked() {
                self.updates.update(&pending);
            }
        }
    }

    fn cards(&self, ui: &mut Ui, job: &Job) {
        let width = ui.available_width();
        let gap = 16.0;
        let per_row = (((width + gap) / (CARD_WIDTH + gap)).floor() as usize).max(1);
        let card_w = ((width - gap * (per_row - 1) as f32) / per_row as f32).max(240.0);
        for row in self.entries.chunks(per_row) {
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing.x = gap;
                for e in row {
                    // Top to bottom inside, though the row it sits in runs left to right.
                    ui.allocate_ui_with_layout(vec2(card_w, 0.0), Layout::top_down(Align::Min), |ui| self.card(ui, e, job, card_w));
                }
            });
            ui.add_space(gap);
        }
    }

    fn card(&self, ui: &mut Ui, e: &Entry, job: &Job, width: f32) {
        Frame::new().fill(CARD).stroke(Stroke::new(1.0, BORDER)).corner_radius(CornerRadius::same(12)).inner_margin(Margin::same(16)).show(ui, |ui| {
            // Less the margins and the border.
            ui.set_width(width - 34.0);
            ui.horizontal(|ui| {
                if let Some(icon) = e.icon {
                    ui.add(egui::Image::new((icon, vec2(40.0, 40.0))));
                }
                ui.vertical(|ui| {
                    ui.label(RichText::new(e.name).size(17.0).strong().color(TEXT));
                    ui.label(RichText::new(e.summary).size(12.5).color(DIM));
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.button("Open").on_hover_text(format!("Show {}", e.name)).clicked() {
                        let _ = self.requests.send(Request::Show(e.tab));
                    }
                });
            });
            ui.add_space(12.0);
            ui.horizontal(|ui| {
                if let Some(v) = self.updates.installed(e.id) {
                    let installed = ui.label(RichText::new(format!("Installed {v}")).size(12.5).color(DIM));
                    if let Some(release) = v.strip_suffix('+') {
                        installed.on_hover_text(format!("Built from changes made after the {release} release"));
                    }
                }
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| self.status(ui, e, job));
            });
        });
    }

    /// The app's update status, right-aligned: a button when there is something to do.
    fn status(&self, ui: &mut Ui, e: &Entry, job: &Job) {
        let in_job = |targets: &[Target]| targets.iter().find(|t| t.name == e.id).map(|t| t.version);
        match job {
            Job::Running { targets, .. } if in_job(targets).is_some() => {
                ui.label(RichText::new("Updating…").color(ACCENT));
                ui.add(egui::Spinner::new().size(14.0));
                return;
            }
            Job::Installed { targets } if in_job(targets).is_some() => {
                let v = in_job(targets).map(|v| v.to_string()).unwrap_or_default();
                ui.label(RichText::new(format!("{v} ready: restart to use it")).color(GREEN));
                check_mark(ui, GREEN);
                return;
            }
            _ => {}
        }
        match self.updates.check_of(e.id) {
            Some(Check::Checking) => {
                ui.add(egui::Spinner::new().size(14.0));
                ui.label(RichText::new("Checking…").color(DIM));
            }
            Some(Check::UpToDate) => {
                ui.label(RichText::new("Up to date").color(GREEN));
                check_mark(ui, GREEN);
            }
            Some(Check::Available { version, .. }) => {
                let blocked = self.updates.blocked();
                let busy = matches!(job, Job::Running { .. });
                let button = ui.add_enabled(blocked.is_none() && !busy, primary_button(&format!("Update to {version}")));
                let button = match (&blocked, busy) {
                    (Some(why), _) => button.on_disabled_hover_text(why),
                    (None, true) => button.on_disabled_hover_text("Another update is being built"),
                    (None, false) => button.on_hover_text(format!("Rebuild {} with its {version} release, in the background", e.name)),
                };
                if button.clicked() {
                    self.updates.update(&[e.id]);
                }
            }
            Some(Check::Failed(why)) => {
                ui.label(RichText::new("Couldn't check").color(AMBER)).on_hover_text(why);
            }
            None => {}
        }
    }
}

impl HomeApp {
    /// "PhotoCraft v0.10.0, GridCraft v0.8.0".
    fn names(&self, targets: &[Target]) -> String {
        let name = |id: &str| self.entries.iter().find(|e| e.id == id).map_or(id.to_owned(), |e| e.name.to_owned());
        targets.iter().map(|t| format!("{} {}", name(&t.name), t.version)).collect::<Vec<_>>().join(", ")
    }

    /// What the update being built, or just built, is doing.
    fn job_panel(&self, ui: &mut Ui, job: &Job) {
        let names = |targets: &[Target]| self.names(targets);
        let (suite, requests, updates) = (self.suite, &self.requests, &self.updates);
        match job {
            Job::Idle => {}
            Job::Running { targets, step, detail, started, tail } => panel(ui, ACCENT, |ui| {
                ui.horizontal(|ui| {
                    ui.add(egui::Spinner::new().size(16.0));
                    ui.label(RichText::new(format!("Updating to {}", names(targets))).size(16.0).strong().color(TEXT));
                });
                ui.add_space(8.0);
                ui.horizontal_wrapped(|ui| {
                    let at = Step::ALL.iter().position(|s| s == step).unwrap_or(0);
                    for (i, s) in Step::ALL.iter().enumerate() {
                        let color = if i < at {
                            check_mark(ui, GREEN);
                            GREEN
                        } else if i == at {
                            ui.label(RichText::new("•").color(ACCENT));
                            ACCENT
                        } else {
                            ui.label(RichText::new("○").color(DIM));
                            DIM
                        };
                        ui.label(RichText::new(s.label()).color(color));
                        if i + 1 < Step::ALL.len() {
                            ui.label(RichText::new("›").color(DIM));
                        }
                    }
                });
                let elapsed = started.elapsed().as_secs();
                let line = if detail.is_empty() { String::new() } else { format!("{detail} · ") };
                ui.label(RichText::new(format!("{line}{}:{:02} so far", elapsed / 60, elapsed % 60)).size(12.5).color(DIM));
                ui.label(RichText::new("Keep working: the apps carry on, and the update takes effect when you restart.").size(12.5).color(DIM));
                output(ui, tail);
            }),
            Job::Installed { targets } => panel(ui, GREEN, |ui| {
                ui.horizontal(|ui| {
                    check_mark(ui, GREEN);
                    ui.label(RichText::new(format!("Updated to {}", names(targets))).size(16.0).strong().color(TEXT));
                });
                ui.label(RichText::new(format!("Restart {suite} to use it. Each app asks about unsaved work first.")).color(DIM));
                ui.add_space(8.0);
                if primary(ui, "Restart now").clicked() {
                    let _ = requests.send(Request::Restart);
                }
            }),
            Job::Failed { targets, message, tail } => panel(ui, RED, |ui| {
                ui.label(RichText::new(format!("Couldn't update to {}", names(targets))).size(16.0).strong().color(TEXT));
                ui.label(RichText::new(message).color(DIM));
                ui.label(RichText::new("Nothing changed: the apps stay on the versions you have.").color(DIM));
                output(ui, tail);
                if ui.button("Dismiss").clicked() {
                    updates.dismiss();
                }
            }),
        }
    }
}

/// A check mark, drawn: egui's fonts have none.
fn check_mark(ui: &mut Ui, color: Color32) {
    let (r, _) = ui.allocate_exact_size(vec2(12.0, 12.0), egui::Sense::hover());
    let at = |x: f32, y: f32| egui::pos2(r.left() + x * r.width(), r.top() + y * r.height());
    ui.painter().line(vec![at(0.1, 0.55), at(0.4, 0.82), at(0.92, 0.2)], Stroke::new(1.8, color));
}

fn panel(ui: &mut Ui, edge: Color32, add: impl FnOnce(&mut Ui)) {
    ui.add_space(14.0);
    Frame::new().fill(CARD).stroke(Stroke::new(1.0, edge)).corner_radius(CornerRadius::same(12)).inner_margin(Margin::same(16)).show(ui, |ui| {
        ui.set_width(ui.available_width());
        add(ui);
    });
}

fn output(ui: &mut Ui, tail: &std::collections::VecDeque<String>) {
    if tail.is_empty() {
        return;
    }
    ui.add_space(6.0);
    egui::CollapsingHeader::new(RichText::new("Build output").size(12.5).color(DIM)).show(ui, |ui| {
        let text: Vec<&str> = tail.iter().map(String::as_str).collect();
        ui.add(egui::Label::new(RichText::new(text.join("\n")).monospace().size(11.5).color(DIM)).wrap());
    });
}

fn primary_button(label: &str) -> egui::Button<'static> {
    egui::Button::new(RichText::new(label.to_owned()).color(Color32::WHITE).strong()).fill(ACCENT).corner_radius(CornerRadius::same(8))
}

fn primary(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add(primary_button(label))
}

/// How long ago `t` was, in words.
fn ago(t: Instant) -> String {
    match t.elapsed().as_secs() {
        0..60 => "just now".into(),
        s @ 60..3600 => format!("{} min ago", s / 60),
        s => format!("{} h ago", s / 3600),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::{Cmd, Exec};

    /// The Home page of a seven-app window, all with updates, drawn at `width` × 800: the rects of
    /// its widgets, and the page's own.
    fn draw(width: f32) -> (Vec<egui::Rect>, egui::Rect) {
        let ids = ["photocraft", "lightcraft", "vectorcraft", "filmcraft", "effectcraft", "soundcraft", "cadcraft"];
        let lock: String = ids.iter().map(|id| format!("{id}  1111  v0.1.0+  https://example.com/{id}\n")).collect();
        let exec: Box<Exec> = Box::new(|cmd: &Cmd, on_line: &mut dyn FnMut(&str)| {
            if cmd.args.first().map(String::as_str) == Some("ls-remote") {
                on_line("2222\trefs/tags/v0.10.0");
            }
            Ok(())
        });
        let updates = Updates::with("craft-test", &ids, &lock, std::env::temp_dir(), exec, Box::new(|| {}));
        updates.check();
        let start = Instant::now();
        while updates.checked_at().is_none() && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(5));
        }
        let entries =
            ids.iter().enumerate().map(|(i, id)| Entry { tab: i + 1, id, name: id, summary: "What the app is for, in a few words", icon: None }).collect();
        let (tx, _rx) = std::sync::mpsc::channel();
        let mut app = HomeApp { suite: "ArtCraft Studio", entries, updates, requests: tx };
        let ctx = egui::Context::default();
        let mut frame = eframe::Frame::_new_kittest();
        let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, vec2(width, 800.0));
        for _ in 0..3 {
            let input = egui::RawInput { screen_rect: Some(screen), ..Default::default() };
            let mut out = ctx.run_ui(input, |ui| eframe::App::ui(&mut app, ui, &mut frame));
            out.textures_delta.clear();
        }
        let rects = ctx.viewport(|v| v.prev_pass.widgets.layers().flat_map(|(_, ws)| ws.iter()).filter(|w| w.sense.senses_click()).map(|w| w.rect).collect());
        (rects, screen)
    }

    /// The page draws with egui's own fonts: a symbol they lack shows as an empty box (they have
    /// no check mark, U+2713 or U+2714, hence [`check_mark`]).
    #[test]
    fn every_symbol_on_the_page_is_in_the_default_fonts() {
        let ctx = egui::Context::default();
        let mut out = ctx.run_ui(egui::RawInput::default(), |_| {});
        out.textures_delta.clear();
        let font = egui::FontId::proportional(14.0);
        for symbol in ["•", "○", "›", "…", "·"] {
            assert!(ctx.fonts_mut(|f| f.has_glyphs(&font, symbol)), "{symbol:?} isn't in egui's fonts");
        }
    }

    #[test]
    fn every_button_fits_the_window_at_any_width() {
        for width in [760.0, 1100.0, 1440.0, 1920.0] {
            let (rects, screen) = draw(width);
            assert!(rects.len() >= 7 * 2, "an Open and an Update button per app at {width}: {}", rects.len());
            for r in &rects {
                assert!(r.right() <= screen.right() && r.left() >= screen.left(), "{r:?} sticks out of a {width} pt window");
            }
        }
    }
}
