//! The window's title bar: one tab per app, and on Windows and Linux, where the window has no OS
//! decorations, the caption buttons, the drag area and the resize edges. macOS keeps its traffic
//! lights over the bar's left end.
//!
//! The bar takes its colours from the app on screen (its panel colour becomes the active tab's,
//! so tab and app read as one surface), and follows that app between light and dark.
//!
//! The caption buttons, the edge zones and the resize hand-off are adapted from PhotoCraft's
//! `crates/ui-egui/src/titlebar.rs` (Apache-2.0 OR MIT, https://github.com/storytold/photocraft).

use egui::{
    Color32, CornerRadius, CursorIcon, Id, LayerId, Order, PointerButton, Rect, ResizeDirection, Sense, Stroke, TextureId, Ui, ViewportCommand, pos2, vec2,
};

/// Windows and Linux: the window has no OS title bar; this bar is the title bar.
pub const CUSTOM: bool = !cfg!(target_os = "macos");
pub const HEIGHT: f32 = 36.0;
/// One caption button: as wide as the native Windows ones.
const BUTTON_WIDTH: f32 = 46.0;
const CAPTIONS_WIDTH: f32 = if CUSTOM { 3.0 * BUTTON_WIDTH } else { 0.0 };
/// Left of the suite's mark: room for the macOS traffic lights.
const LEFT_INSET: f32 = if CUSTOM { 10.0 } else { 78.0 };
/// Free bar kept left of the caption buttons, so there is always somewhere to drag the window.
const DRAG_GAP: f32 = 40.0;
const TAB_MAX: f32 = 180.0;
/// Narrower than this, a tab shows its icon only.
const TAB_LABEL_MIN: f32 = 84.0;
const TAB_MIN: f32 = 40.0;
const TAB_TOP: f32 = 6.0;
/// The Home tab's update count.
const BADGE: Color32 = Color32::from_rgb(0x4c, 0x8d, 0xff);
/// Resize zone thickness along an edge (thinner along the top, where the tabs are), and the side
/// of a corner zone.
const EDGE: f32 = 8.0;
const TOP_EDGE: f32 = 4.0;
const CORNER: f32 = 12.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TabState {
    NotStarted,
    Running,
    Failed,
}

pub struct TabView<'a> {
    pub name: &'a str,
    pub summary: &'a str,
    pub icon: Option<TextureId>,
    pub state: TabState,
    /// Running in the background: a dot under the icon, as in a dock.
    pub dot: bool,
    /// A count on the icon (the Home tab's updates); 0 for none.
    pub badge: usize,
}

pub struct Bar<'a> {
    pub suite: &'a str,
    pub icon: Option<TextureId>,
    pub tabs: &'a [TabView<'a>],
    pub active: usize,
}

struct Colors {
    bar: Color32,
    tab: Color32,
    hover: Color32,
    pressed: Color32,
    text: Color32,
    text_active: Color32,
    text_idle: Color32,
    border: Color32,
    failed: Color32,
}

impl Colors {
    fn of(v: &egui::Visuals, focused: bool) -> Self {
        let tab = v.panel_fill;
        let bar = if v.dark_mode { tab.lerp_to_gamma(Color32::BLACK, 0.42) } else { tab.lerp_to_gamma(Color32::BLACK, 0.085) };
        // Like an OS title bar: quieter while the window is in the background.
        let dim = |c: Color32| if focused { c } else { c.lerp_to_gamma(bar, 0.4) };
        Self {
            bar,
            tab,
            hover: v.text_color().gamma_multiply(0.09),
            pressed: v.text_color().gamma_multiply(0.16),
            text: dim(v.text_color()),
            text_active: dim(v.strong_text_color()),
            text_idle: dim(v.weak_text_color()),
            border: v.widgets.noninteractive.bg_stroke.color,
            failed: v.error_fg_color,
        }
    }
}

fn maximized(ctx: &egui::Context) -> bool {
    ctx.input(|i| i.viewport().maximized.unwrap_or(false))
}

fn fullscreen(ctx: &egui::Context) -> bool {
    ctx.input(|i| i.viewport().fullscreen.unwrap_or(false))
}

pub fn tab_id(i: usize) -> Id {
    Id::new(("craft-suite-tab", i))
}

/// Draws the bar along the top of `ui`; returns the tab that was clicked.
pub fn show(ui: &mut Ui, bar: &Bar<'_>) -> Option<usize> {
    let ctx = ui.ctx().clone();
    let focused = ctx.input(|i| i.viewport().focused.unwrap_or(true));
    let c = Colors::of(ui.visuals(), focused);
    let mut clicked = None;
    egui::Panel::top("craft-suite-titlebar").exact_size(HEIGHT).resizable(false).show_separator_line(false).frame(egui::Frame::new().fill(c.bar)).show(
        ui,
        |ui| {
            let rect = ui.max_rect();
            // The whole bar drags the window; the tabs and buttons, added later, sit on top of it.
            let drag = ui.interact(rect, Id::new("craft-suite-drag"), Sense::click_and_drag());
            if !fullscreen(&ctx) {
                if drag.drag_started_by(PointerButton::Primary) {
                    ctx.send_viewport_cmd(ViewportCommand::StartDrag);
                }
                if drag.double_clicked() {
                    ctx.send_viewport_cmd(ViewportCommand::Maximized(!maximized(&ctx)));
                }
            }

            let mut x = rect.left() + LEFT_INSET;
            if let Some(icon) = bar.icon {
                let r = Rect::from_center_size(pos2(x + 9.0, rect.center().y + TAB_TOP / 2.0), vec2(18.0, 18.0));
                ui.painter().image(icon, r, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);
                ui.interact(r, Id::new("craft-suite-mark"), Sense::hover()).on_hover_text(bar.suite);
                x += 18.0 + 10.0;
            }

            let right = rect.right() - CAPTIONS_WIDTH - DRAG_GAP;
            let n = bar.tabs.len().max(1) as f32;
            let width = ((right - x) / n).clamp(TAB_MIN, TAB_MAX);
            let mut active_span = None;
            for (i, tab) in bar.tabs.iter().enumerate() {
                let r = Rect::from_min_size(pos2(x, rect.top() + TAB_TOP), vec2(width - 2.0, HEIGHT - TAB_TOP));
                x += width;
                if r.right() > right + DRAG_GAP {
                    break;
                }
                let active = i == bar.active;
                if active {
                    active_span = Some((r.left(), r.right()));
                }
                let resp = ui.interact(r, tab_id(i), Sense::click());
                paint_tab(ui, &c, tab, r, active, resp.hovered(), resp.is_pointer_button_down_on());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Button, true, active, tab.name));
                let tip = match tab.state {
                    TabState::NotStarted => format!("{}: {}\nClick to open", tab.name, tab.summary),
                    TabState::Running => format!("{}: {}", tab.name, tab.summary),
                    TabState::Failed => format!("{}: {}\nStopped after an error", tab.name, tab.summary),
                };
                if resp.on_hover_text(tip).clicked() {
                    clicked = Some(i);
                }
            }

            // The bar's bottom edge, open under the active tab so it joins the app below.
            let y = rect.bottom() - 0.5;
            let stroke = Stroke::new(1.0, c.border);
            match active_span {
                Some((l, r)) => {
                    ui.painter().hline(rect.left()..=l, y, stroke);
                    ui.painter().hline(r..=rect.right(), y, stroke);
                }
                None => {
                    ui.painter().hline(rect.x_range(), y, stroke);
                }
            }

            if CUSTOM {
                caption_buttons(ui, &c, rect);
            }
        },
    );
    clicked
}

fn paint_tab(ui: &Ui, c: &Colors, tab: &TabView<'_>, r: Rect, active: bool, hovered: bool, pressed: bool) {
    let p = ui.painter();
    if active {
        p.rect_filled(r, CornerRadius { nw: 8, ne: 8, sw: 0, se: 0 }, c.tab);
    } else if hovered || pressed {
        p.rect_filled(r.shrink2(vec2(1.0, 3.0)).translate(vec2(0.0, -2.0)), 6.0, if pressed { c.pressed } else { c.hover });
    }
    let icon_rect = Rect::from_min_size(pos2(r.left() + 10.0, r.center().y - 8.0), vec2(16.0, 16.0));
    let labelled = r.width() >= TAB_LABEL_MIN;
    let icon_rect = if labelled { icon_rect } else { Rect::from_center_size(r.center(), vec2(16.0, 16.0)) };
    if let Some(icon) = tab.icon {
        let tint = if tab.state == TabState::NotStarted && !active { Color32::from_white_alpha(170) } else { Color32::WHITE };
        p.image(icon, icon_rect, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), tint);
    }
    if tab.dot && !active {
        p.circle_filled(pos2(icon_rect.center().x, r.bottom() - 3.0), 1.75, c.text_idle);
    }
    if tab.state == TabState::Failed {
        p.circle_filled(icon_rect.right_top() + vec2(-1.0, 1.0), 3.5, c.failed);
    }
    if tab.badge > 0 {
        let text = if tab.badge > 9 { "9+".to_owned() } else { tab.badge.to_string() };
        let font = egui::FontId::proportional(9.5);
        let galley = p.layout_no_wrap(text, font, Color32::WHITE);
        let size = vec2((galley.size().x + 6.0).max(14.0), 14.0);
        let badge = Rect::from_center_size(icon_rect.right_top() + vec2(1.0, 1.0), size);
        p.rect_filled(badge, 7.0, BADGE);
        p.galley(badge.center() - galley.size() / 2.0, galley, Color32::WHITE);
    }
    if !labelled {
        return;
    }
    let color = match (active, tab.state) {
        (true, _) => c.text_active,
        (false, TabState::NotStarted) => c.text_idle,
        _ => c.text,
    };
    let left = icon_rect.right() + 8.0;
    let max_width = (r.right() - 10.0 - left).max(0.0);
    let mut job = egui::text::LayoutJob::single_section(tab.name.to_owned(), egui::TextFormat::simple(egui::TextStyle::Body.resolve(ui.style()), color));
    job.wrap = egui::text::TextWrapping { max_width, max_rows: 1, break_anywhere: true, overflow_character: Some('…') };
    let galley = p.layout_job(job);
    p.galley(pos2(left, r.center().y - galley.size().y / 2.0), galley, color);
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Caption {
    Minimize,
    Maximize,
    Close,
}

const CAPTIONS: [Caption; 3] = [Caption::Minimize, Caption::Maximize, Caption::Close];

/// Minimize, Maximize/Restore and Close, full bar height, flush with the window's right edge so a
/// maximized window's corner hits Close. Close asks the window to close: each running app gets
/// its say about unsaved work first (`host::SuiteApp::continue_close`).
fn caption_buttons(ui: &mut Ui, c: &Colors, bar: Rect) {
    let ctx = ui.ctx().clone();
    let max = maximized(&ctx);
    let right = bar.right().min(ctx.content_rect().right());
    for (i, cap) in CAPTIONS.into_iter().enumerate() {
        let r = Rect::from_min_size(pos2(right - CAPTIONS_WIDTH + i as f32 * BUTTON_WIDTH, bar.top()), vec2(BUTTON_WIDTH, bar.height() - 1.0));
        let resp = ui.interact(r, Id::new(("craft-suite-caption", i)), Sense::click());
        let close = cap == Caption::Close;
        let red = Color32::from_rgb(0xc4, 0x2b, 0x1c);
        let fill = match (resp.is_pointer_button_down_on(), resp.hovered()) {
            (true, _) if close => red.gamma_multiply(0.8),
            (_, true) if close => red,
            (true, _) => c.pressed,
            (_, true) => c.hover,
            _ => Color32::TRANSPARENT,
        };
        ui.painter().rect_filled(r, 0.0, fill);
        let ink = if close && resp.hovered() { Color32::WHITE } else { c.text };
        paint_glyph(ui, cap, max, r.center(), Stroke::new(1.0, ink));
        let tip = match cap {
            Caption::Minimize => "Minimize",
            Caption::Maximize if max => "Restore",
            Caption::Maximize => "Maximize",
            Caption::Close => "Close",
        };
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, tip));
        if resp.on_hover_text(tip).clicked() {
            ctx.send_viewport_cmd(match cap {
                Caption::Minimize => ViewportCommand::Minimized(true),
                Caption::Maximize => ViewportCommand::Maximized(!max),
                Caption::Close => ViewportCommand::Close,
            });
        }
    }
}

/// The 10 pt line glyphs of the caption buttons.
fn paint_glyph(ui: &Ui, c: Caption, maximized: bool, at: egui::Pos2, s: Stroke) {
    let p = ui.painter();
    let g = Rect::from_center_size(at, vec2(10.0, 10.0));
    match c {
        Caption::Minimize => {
            p.line_segment([g.left_center(), g.right_center()], s);
        }
        // Restore: a front square with the corner of the one behind it.
        Caption::Maximize if maximized => {
            let front = Rect::from_min_max(g.min + vec2(0.0, 2.0), g.max - vec2(2.0, 0.0));
            p.rect_stroke(front, 0.0, s, egui::StrokeKind::Middle);
            p.line(vec![g.min + vec2(2.0, 2.0), g.min + vec2(2.0, 0.0), g.right_top(), g.max - vec2(0.0, 2.0), g.max - vec2(2.0, 2.0)], s);
        }
        Caption::Maximize => {
            p.rect_stroke(g, 0.0, s, egui::StrokeKind::Middle);
        }
        Caption::Close => {
            p.line_segment([g.left_top(), g.right_bottom()], s);
            p.line_segment([g.right_top(), g.left_bottom()], s);
        }
    }
}

/// The edge and corner zones of a window with content rect `w`; corners come last so they win
/// where they overlap the edges.
fn zones(w: Rect) -> [(Rect, ResizeDirection, CursorIcon); 8] {
    use ResizeDirection::*;
    let (e, t, c) = (EDGE, TOP_EDGE, CORNER);
    [
        (Rect::from_min_max(w.left_top(), pos2(w.right(), w.top() + t)), North, CursorIcon::ResizeNorth),
        (Rect::from_min_max(pos2(w.left(), w.bottom() - e), w.right_bottom()), South, CursorIcon::ResizeSouth),
        (Rect::from_min_max(w.left_top(), pos2(w.left() + e, w.bottom())), West, CursorIcon::ResizeWest),
        (Rect::from_min_max(pos2(w.right() - e, w.top()), w.right_bottom()), East, CursorIcon::ResizeEast),
        (Rect::from_min_size(w.left_top(), vec2(c, c)), NorthWest, CursorIcon::ResizeNwSe),
        (Rect::from_min_size(w.right_top() - vec2(c, 0.0), vec2(c, c)), NorthEast, CursorIcon::ResizeNeSw),
        (Rect::from_min_size(w.left_bottom() - vec2(0.0, c), vec2(c, c)), SouthWest, CursorIcon::ResizeNeSw),
        (Rect::from_min_size(w.right_bottom() - vec2(c, c), vec2(c, c)), SouthEast, CursorIcon::ResizeNwSe),
    ]
}

fn resize_handed_off_id() -> Id {
    Id::new("craft-suite-resize-handed-off")
}

/// An OS resize started at `pass`; `released` is the pass whose input ended the press.
#[derive(Clone, Copy, Debug)]
struct HandOff {
    pass: u64,
    released: Option<u64>,
}

/// Some compositors (KDE Wayland) keep the button release of an OS resize, so egui kept the edge
/// pressed. End the press ourselves on the input after the hand-off, only while egui still has it
/// down and the input brings no release of its own. Call from `raw_input_hook`.
pub fn release_after_os_resize(ctx: &egui::Context, raw: &mut egui::RawInput) {
    let Some(h) = ctx.data(|d| d.get_temp::<HandOff>(resize_handed_off_id())) else { return };
    if h.released.is_some() || h.pass >= ctx.cumulative_pass_nr() {
        return;
    }
    let os_released = raw.events.iter().any(|e| matches!(e, egui::Event::PointerButton { button: PointerButton::Primary, pressed: false, .. }));
    if let Some(pos) = ctx.input(|i| i.pointer.latest_pos()).filter(|_| !os_released && ctx.input(|i| i.pointer.primary_down())) {
        raw.events.push(egui::Event::PointerButton { pos, button: PointerButton::Primary, pressed: false, modifiers: ctx.input(|i| i.modifiers) });
    }
    let pass = ctx.cumulative_pass_nr();
    ctx.data_mut(|d| d.insert_temp(resize_handed_off_id(), HandOff { released: Some(pass), ..h }));
}

/// After an OS resize the compositor may leave its own cursor up; show the default one for a
/// frame on the first motion afterwards, so the right one is sent again.
fn reshow_cursor_after_os_resize(ctx: &egui::Context) {
    let Some(HandOff { released: Some(pass), .. }) = ctx.data(|d| d.get_temp::<HandOff>(resize_handed_off_id())) else { return };
    if pass < ctx.cumulative_pass_nr() && ctx.input(|i| i.events.iter().any(|e| matches!(e, egui::Event::PointerMoved(_)))) {
        ctx.data_mut(|d| d.remove::<HandOff>(resize_handed_off_id()));
        ctx.set_cursor_icon(CursorIcon::Default);
        ctx.request_repaint();
    }
}

/// Invisible resize zones along the window's edges, above everything else; a press in one starts
/// an OS resize. None while the window is maximized or full screen.
pub fn resize_zones(ui: &mut Ui) {
    let ctx = ui.ctx().clone();
    if maximized(&ctx) || fullscreen(&ctx) {
        reshow_cursor_after_os_resize(&ctx);
        return;
    }
    let w = ctx.content_rect();
    let layer = LayerId::new(Order::Foreground, Id::new("craft-suite-resize"));
    let zui = ui.new_child(egui::UiBuilder::new().layer_id(layer).max_rect(w));
    for (i, (r, dir, cursor)) in zones(w).into_iter().enumerate() {
        let resp = zui.interact(r, Id::new(("craft-suite-resize", i)), Sense::drag()).on_hover_cursor(cursor);
        if resp.drag_started_by(PointerButton::Primary) {
            ctx.send_viewport_cmd(ViewportCommand::BeginResize(dir));
            let pass = ctx.cumulative_pass_nr();
            ctx.data_mut(|d| d.insert_temp(resize_handed_off_id(), HandOff { pass, released: None }));
        }
    }
    reshow_cursor_after_os_resize(&ctx);
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui::{Event, Pos2, RawInput, ViewportId};

    const NAMES: [&str; 3] = ["PhotoCraft", "FilmCraft", "SoundCraft"];

    struct Win {
        ctx: egui::Context,
        width: f32,
        time: f64,
        maximized: bool,
        active: usize,
    }

    impl Win {
        fn new(width: f32) -> Self {
            Self { ctx: egui::Context::default(), width, time: 0.0, maximized: false, active: 0 }
        }

        /// One frame with `events`: the clicked tab and the viewport commands sent.
        fn frame(&mut self, events: Vec<Event>) -> (Option<usize>, Vec<ViewportCommand>) {
            self.time += 0.05;
            let mut input =
                RawInput { screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(self.width, 600.0))), time: Some(self.time), events, ..Default::default() };
            if let Some(v) = input.viewports.get_mut(&ViewportId::ROOT) {
                v.maximized = Some(self.maximized);
            }
            release_after_os_resize(&self.ctx, &mut input);
            let mut clicked = None;
            let active = self.active;
            let mut out = self.ctx.run_ui(input, |ui| {
                let tabs: Vec<TabView<'_>> =
                    NAMES.iter().map(|n| TabView { name: n, summary: "", icon: None, state: TabState::Running, dot: true, badge: 0 }).collect();
                clicked = show(ui, &Bar { suite: "Suite", icon: None, tabs: &tabs, active });
                if CUSTOM {
                    resize_zones(ui);
                }
            });
            out.textures_delta.clear();
            (clicked, out.viewport_output.remove(&ViewportId::ROOT).map(|v| v.commands).unwrap_or_default())
        }

        /// Press at `path[0]`, move along `path`, release: what the frames returned.
        fn gesture(&mut self, path: &[Pos2]) -> (Option<usize>, Vec<ViewportCommand>) {
            let mut frames = vec![vec![Event::PointerMoved(path[0])], vec![button(path[0], true)]];
            frames.extend(path[1..].iter().map(|p| vec![Event::PointerMoved(*p)]));
            frames.push(vec![button(*path.last().unwrap_or(&path[0]), false)]);
            let mut clicked = None;
            let mut cmds = vec![];
            for f in frames {
                let (c, mut v) = self.frame(f);
                clicked = clicked.or(c);
                cmds.append(&mut v);
            }
            (clicked, cmds)
        }

        fn rect(&self, id: Id) -> Rect {
            self.ctx.read_response(id).map(|r| r.rect).unwrap_or(Rect::NOTHING)
        }
    }

    fn button(p: Pos2, pressed: bool) -> Event {
        Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers: Default::default() }
    }

    #[test]
    fn clicking_a_tab_picks_it_and_tabs_stay_clear_of_the_caption_buttons() {
        for width in [760.0, 1440.0] {
            let mut w = Win::new(width);
            w.frame(vec![]);
            let second = w.rect(tab_id(1));
            assert!(second.width() > 40.0, "{second:?}");
            let (clicked, cmds) = w.gesture(&[second.center()]);
            assert_eq!(clicked, Some(1));
            assert!(!cmds.iter().any(|c| matches!(c, ViewportCommand::StartDrag)), "a tab click doesn't move the window: {cmds:?}");
            let last = w.rect(tab_id(NAMES.len() - 1));
            assert!(last.right() <= width - CAPTIONS_WIDTH - DRAG_GAP, "{last:?} at {width}");
        }
    }

    #[test]
    fn the_free_bar_drags_and_a_double_click_maximizes() {
        let mut w = Win::new(1440.0);
        w.frame(vec![]);
        let free = pos2(1440.0 - CAPTIONS_WIDTH - 20.0, HEIGHT / 2.0);
        let (_, cmds) = w.gesture(&[free, free + vec2(12.0, 4.0), free + vec2(30.0, 8.0)]);
        assert_eq!(cmds.iter().filter(|c| matches!(c, ViewportCommand::StartDrag)).count(), 1, "{cmds:?}");
        let (_, mut cmds) = w.gesture(&[free]);
        cmds.extend(w.gesture(&[free]).1);
        assert!(cmds.contains(&ViewportCommand::Maximized(true)), "{cmds:?}");
    }

    #[test]
    fn caption_buttons_minimize_maximize_and_close() {
        if !CUSTOM {
            return;
        }
        let mut w = Win::new(1100.0);
        w.frame(vec![]);
        let at = |i: usize| pos2(1100.0 - CAPTIONS_WIDTH + (i as f32 + 0.5) * BUTTON_WIDTH, HEIGHT / 2.0);
        assert!(w.gesture(&[at(0)]).1.contains(&ViewportCommand::Minimized(true)));
        assert!(w.gesture(&[at(1)]).1.contains(&ViewportCommand::Maximized(true)));
        w.maximized = true;
        assert!(w.gesture(&[at(1)]).1.contains(&ViewportCommand::Maximized(false)), "Restore");
        assert!(w.gesture(&[at(2)]).1.contains(&ViewportCommand::Close));
        // Maximized, the window's very corner is Close.
        assert!(w.gesture(&[pos2(1099.5, 0.5)]).1.contains(&ViewportCommand::Close));
    }

    #[test]
    fn edges_resize_unless_maximized() {
        if !CUSTOM {
            return;
        }
        use ResizeDirection::*;
        let mut w = Win::new(1000.0);
        w.frame(vec![]);
        for (p, dir) in
            [(pos2(1.0, 300.0), West), (pos2(998.0, 300.0), East), (pos2(500.0, 598.0), South), (pos2(500.0, 1.0), North), (pos2(998.0, 598.0), SouthEast)]
        {
            let (_, cmds) = w.gesture(&[p, p + vec2(6.0, 6.0)]);
            assert_eq!(cmds, vec![ViewportCommand::BeginResize(dir)], "at {p:?}");
        }
        w.maximized = true;
        let (_, cmds) = w.gesture(&[pos2(1.0, 300.0), pos2(8.0, 300.0)]);
        assert!(!cmds.iter().any(|c| matches!(c, ViewportCommand::BeginResize(_))), "{cmds:?}");
    }
}
