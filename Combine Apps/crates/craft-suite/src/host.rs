//! The suite's eframe app, which hosts the tools' apps.
//!
//! **Separate state in one context.** egui keeps an app's look and interaction state in the
//! context's [`egui::Memory`] (style, zoom, panel sizes, window positions, focus, popups) and its
//! fonts beside it. Each tab owns a `Memory` and a font set: the shown tab's are in the context,
//! the others are parked in their [`Tab`]. A switch swaps them between frames
//! ([`SuiteApp::activate`]), so one app's theme, zoom or fonts never leak into another.
//!
//! **Only the shown app runs.** `logic`, `ui` and `raw_input_hook` go to the active app alone:
//! the apps style the context, read the keyboard and handle closing in them, so a hidden app
//! running them would act on what the user does in another. A hidden app is frozen, as eframe
//! leaves an app while its window is minimized, and picks up where it was.
//!
//! **Started when first shown.** A tab shows "Opening …" for one frame, then builds its app
//! ([`SuiteApp::launch`]) with a creation context carrying the shared GPU state and the app's
//! own storage ([`Store`]).
//!
//! **One app failing doesn't take the others down.** A panic in an app is caught; its tab shows
//! what happened and the other tabs carry on.
//!
//! **Closing asks every running app.** A close request goes to the shown app first; if it lets
//! the window close, the next running app is shown with the request, and so on. Any app may keep
//! the window open (its "save changes?" prompt), which ends the round ([`SuiteApp::continue_close`]).
//!
//! **The Home tab** ([`crate::home`]) comes first when the window can update its apps: an app of
//! the suite's own, which lists the others with their versions and updates. It sits out the close
//! round (it has nothing to save), and asks the host to show a tab or restart the window.

use std::any::Any;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender};
use std::time::Instant;

use egui::{ViewportCommand, ViewportId};

use crate::home::{self, Request};
use crate::shoot::Shoot;
use crate::store::Store;
use crate::titlebar::{self, TabState, TabView};
use crate::update::Updates;
use crate::window_frame::Guard;
use crate::{Args, Launch, Startup, Suite};

/// The shown tab, in the suite's eframe storage.
const ACTIVE_KEY: &str = "craft-suite.active";
/// Where eframe keeps egui's memory; each app's own store uses it the same way.
const EGUI_MEMORY_KEY: &str = "egui";
const MIN_SIZE: [f32; 2] = [760.0, 480.0];

struct Tab {
    id: &'static str,
    name: &'static str,
    summary: &'static str,
    extensions: &'static [&'static str],
    icon: Option<egui::TextureHandle>,
    /// Until the app is built.
    launch: Option<Launch>,
    app: Option<Box<dyn eframe::App>>,
    /// Why the app stopped (its panic message).
    failed: Option<String>,
    store: Store,
    /// The app's egui memory while another tab is shown.
    memory: Option<egui::Memory>,
    /// The app's fonts while another tab is shown.
    fonts: Option<egui::FontDefinitions>,
    /// The window title the app last asked for.
    title: Option<String>,
    /// Files dropped on the window for this app, until it runs.
    drops: Vec<egui::DroppedFileHandle>,
    /// "Opening …" has been on screen: build the app before the next frame.
    opening_shown: bool,
    started_in_ms: Option<f64>,
    /// The Home tab rather than an app of the suite.
    home: bool,
}

impl Tab {
    fn state(&self) -> TabState {
        match (&self.app, &self.failed) {
            (Some(_), _) => TabState::Running,
            (None, Some(_)) => TabState::Failed,
            (None, None) => TabState::NotStarted,
        }
    }

    /// The egui memory to show this tab with: its parked one, else what it saved last time. A
    /// saved zoom factor egui can't use (zero, NaN, absurd; from a damaged file) would fail an
    /// assertion in every frame; it goes back to 100 %.
    fn take_memory(&mut self) -> egui::Memory {
        if let Some(m) = self.memory.take() {
            return m;
        }
        let mut m: egui::Memory = eframe::get_value(&self.store, EGUI_MEMORY_KEY).unwrap_or_default();
        if !(0.1..=10.0).contains(&m.options.zoom_factor) {
            log::warn!("{}: saved zoom factor {} ignored", self.name, m.options.zoom_factor);
            m.options.zoom_factor = 1.0;
        }
        m
    }
}

pub(crate) struct SuiteApp {
    name: &'static str,
    ctx: egui::Context,
    icon: Option<egui::TextureHandle>,
    window_icon: Option<Arc<egui::IconData>>,
    tabs: Vec<Tab>,
    active: usize,
    /// A tab to show from the next frame on.
    switch_to: Option<usize>,
    integration_info: eframe::IntegrationInfo,
    wgpu: Option<eframe::egui_wgpu::RenderState>,
    /// Running apps still to be asked about closing the window, the one being asked first.
    closing: Vec<usize>,
    /// Hand the close request to the tab shown next frame.
    pass_close_on: bool,
    /// How many viewport commands were queued before the active app's turn this frame.
    commands_before: usize,
    frame_guard: Option<Guard>,
    shoot: Option<Shoot>,
    /// The apps' update checks and update builds, with the Home tab.
    updates: Option<Arc<Updates>>,
    /// What the Home tab asks of the window (the sender is the Home tab's; a copy is kept so
    /// the channel never closes).
    home_requests: Option<(Sender<Request>, Receiver<Request>)>,
    /// Start the updated program once the window has closed.
    restart: bool,
}

impl SuiteApp {
    pub fn new(cc: &eframe::CreationContext<'_>, suite: Suite, args: Args, data_dir: Option<PathBuf>) -> Self {
        let apps: Vec<&'static str> = suite.tools.iter().map(|t| t.id).collect();
        let updates = suite.package.map(|package| Updates::new(package, &apps, cc.egui_ctx.clone()));
        Self::with_updates(cc, suite, args, data_dir, updates)
    }

    /// With `updates` (`Some` for a window with a Home tab), which tests replace with one whose
    /// commands are stand-ins.
    fn with_updates(cc: &eframe::CreationContext<'_>, suite: Suite, args: Args, data_dir: Option<PathBuf>, updates: Option<Arc<Updates>>) -> Self {
        let ctx = cc.egui_ctx.clone();
        // wgpu's default for an error nothing catches is a panic, which in the renderer would take
        // every app down. Log it instead. Apps that watch the device themselves (PhotoCraft,
        // EffectCraft) put their own handler in place of this one when they start.
        if let Some(rs) = &cc.wgpu_render_state {
            rs.device.on_uncaptured_error(Arc::new(|e| log::error!("GPU error: {e}")));
        }
        let mut files: Vec<Vec<PathBuf>> = suite.tools.iter().map(|_| Vec::new()).collect();
        let mut first_file_tool = None;
        for f in args.files {
            match crate::tool_for(&suite.tools, &f) {
                Some(i) => {
                    first_file_tool.get_or_insert(suite.tools[i].id);
                    files[i].push(f);
                }
                None => log::warn!("{}: none of the apps in {} opens this kind of file", f.display(), suite.name),
            }
        }
        let shoot = args.screenshot_all.map(Shoot::new);

        let mut tabs: Vec<Tab> = suite
            .tools
            .into_iter()
            .zip(files)
            .map(|(tool, files)| {
                let startup = Startup { files, no_settings: args.no_settings };
                let (launch, failed) = match catch_unwind(AssertUnwindSafe(|| (tool.prepare)(cc, startup))) {
                    Ok(launch) => (Some(launch), None),
                    Err(p) => {
                        let msg = panic_message(p.as_ref());
                        log::error!("{} couldn't be prepared: {msg}", tool.name);
                        (None, Some(msg))
                    }
                };
                let mut store = Store::open(data_dir.as_ref().map(|d| d.join("apps").join(format!("{}.ron", tool.id))));
                if store.is_new()
                    && let Some(file) = tool.standalone_storage.and_then(|f| f())
                {
                    store.seed_from(&file);
                }
                Tab {
                    id: tool.id,
                    name: tool.name,
                    summary: tool.summary,
                    extensions: tool.extensions,
                    icon: texture(&ctx, &format!("craft-suite-icon-{}", tool.id), tool.icon_png),
                    launch,
                    app: None,
                    failed,
                    store,
                    memory: None,
                    fonts: None,
                    title: None,
                    drops: vec![],
                    opening_shown: false,
                    started_in_ms: None,
                    home: false,
                }
            })
            .collect();
        let icon = texture(&ctx, "craft-suite-icon", suite.icon_png);
        let mut home_requests = None;
        if let Some(u) = &updates {
            u.remove_old_exe();
            u.check();
            let (tx, rx) = std::sync::mpsc::channel();
            let tx_keep = tx.clone();
            let entries = tabs
                .iter()
                .enumerate()
                .map(|(i, t)| home::Entry { tab: i + 1, id: t.id, name: t.name, summary: t.summary, icon: t.icon.as_ref().map(|i| i.id()) })
                .collect();
            tabs.insert(
                0,
                Tab {
                    id: "home",
                    name: "Home",
                    summary: "Your apps, their versions and their updates",
                    extensions: &[],
                    icon: icon.clone(),
                    launch: Some(home::launch(suite.name, entries, u.clone(), tx)),
                    app: None,
                    failed: None,
                    store: Store::open(None),
                    memory: None,
                    fonts: None,
                    title: None,
                    drops: vec![],
                    // Nothing slow to start: no "Opening …" first.
                    opening_shown: true,
                    started_in_ms: None,
                    home: true,
                },
            );
            home_requests = Some((tx_keep, rx));
        }

        let find = |id: &str| tabs.iter().position(|t| t.id == id);
        let requested = args.tab.as_deref().and_then(|id| {
            let i = find(id);
            if i.is_none() {
                log::warn!("--tab {id}: no such tab (have: {})", tabs.iter().map(|t| t.id).collect::<Vec<_>>().join(", "));
            }
            i
        });
        let saved = cc.storage.and_then(|s| s.get_string(ACTIVE_KEY));
        let active = if shoot.is_some() { 0 } else { requested.or(first_file_tool.and_then(find)).or_else(|| saved.as_deref().and_then(find)).unwrap_or(0) };
        let mut app = Self {
            name: suite.name,
            icon,
            window_icon: icon_data(suite.icon_png).map(Arc::new),
            ctx,
            tabs,
            active,
            switch_to: None,
            integration_info: cc.integration_info.clone(),
            wgpu: cc.wgpu_render_state.clone(),
            closing: vec![],
            pass_close_on: false,
            commands_before: 0,
            frame_guard: Guard::new(cc, titlebar::CUSTOM),
            shoot,
            updates,
            home_requests,
            restart: false,
        };
        // The first tab's memory goes straight into the context.
        let memory = app.tabs[active].take_memory();
        app.ctx.memory_mut(|m| *m = memory);
        crate::handoff::register(app.tabs.iter().map(|t| t.id).collect(), app.ctx.clone());
        app
    }

    /// Show tab `new` from this frame on: park the shown tab's egui memory and fonts, and bring
    /// back `new`'s. Between frames only (`raw_input_hook`).
    fn activate(&mut self, ctx: &egui::Context, new: usize) {
        if new == self.active || new >= self.tabs.len() {
            return;
        }
        let old = self.active;
        // No fonts exist before the first pass.
        self.tabs[old].fonts = (ctx.cumulative_pass_nr() > 0).then(|| ctx.fonts(|f| f.definitions().clone()));
        let incoming = self.tabs[new].take_memory();
        let outgoing = ctx.memory_mut(|m| std::mem::replace(m, incoming));
        self.tabs[old].memory = Some(outgoing);
        // The app's fonts (egui's own for an app not started yet). egui compares them with the
        // ones in use and rebuilds only when they differ, at the next pass. (Fonts an app asks
        // for in the very frame its tab is left are lost to this: the request sits in the parked
        // memory and these replace it on return. The apps set fonts at start-up and on a language
        // change, so a click has to land in that one frame for it to matter.)
        ctx.set_fonts(self.tabs[new].fonts.take().unwrap_or_default());
        self.active = new;
        let tab = &self.tabs[new];
        log::debug!("showing {}", tab.name);
        let title = tab.title.clone().unwrap_or_else(|| format!("{} - {}", tab.name, self.name));
        ctx.send_viewport_cmd(ViewportCommand::Title(title));
        ctx.request_repaint();
    }

    /// Build tab `i`'s app. The creation context has no window handle (only eframe's start-up
    /// one does; see [`crate::Tool::prepare`]).
    fn launch(&mut self, ctx: &egui::Context, i: usize) {
        let tab = &mut self.tabs[i];
        let Some(launch) = tab.launch.take() else { return };
        let started = Instant::now();
        let result = {
            let mut cc = eframe::CreationContext::_new_kittest(ctx.clone());
            cc.integration_info = self.integration_info.clone();
            cc.wgpu_render_state = self.wgpu.clone();
            cc.storage = Some(&tab.store);
            catch_unwind(AssertUnwindSafe(|| launch(&cc)))
        };
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        match result {
            Ok(app) => {
                log::info!("{} started in {ms:.0} ms", tab.name);
                tab.app = Some(app);
                tab.started_in_ms = Some(ms);
            }
            Err(p) => {
                let msg = panic_message(p.as_ref());
                log::error!("{} couldn't start: {msg}", tab.name);
                tab.failed = Some(msg);
            }
        }
        ctx.request_repaint();
    }

    /// Tab `i`'s app panicked: it is set aside (not dropped, which could panic or hang in turn)
    /// and its tab says what happened.
    fn fail(&mut self, i: usize, payload: &(dyn Any + Send)) {
        let tab = &mut self.tabs[i];
        let msg = panic_message(payload);
        log::error!("{} stopped: {msg}", tab.name);
        if let Some(app) = tab.app.take() {
            std::mem::forget(app);
        }
        tab.failed = Some(msg);
        self.closing.retain(|&j| j != i);
    }

    /// Runs `f` on the active app, catching a panic.
    fn with_active_app(&mut self, f: impl FnOnce(&mut dyn eframe::App)) {
        let i = self.active;
        let Some(app) = self.tabs[i].app.as_deref_mut() else { return };
        if let Err(p) = catch_unwind(AssertUnwindSafe(|| f(app))) {
            self.fail(i, p.as_ref());
        }
    }

    /// Files dropped on the window go to the app that opens them, unless the shown app does; the
    /// window then shows that app. The rest stay with the shown app (if the drop moves the window
    /// to another app, they wait until the shown one is back).
    fn route_drops(&mut self, raw: &mut egui::RawInput) {
        if raw.dropped_files.is_empty() {
            return;
        }
        let shown = self.tabs[self.active].extensions;
        let mut keep = vec![];
        let mut moved = false;
        for f in std::mem::take(&mut raw.dropped_files) {
            let ext = extension(f.path());
            let target = ext
                .filter(|e| !shown.contains(&e.as_str()))
                .and_then(|e| self.tabs.iter().position(|t| t.failed.is_none() && t.extensions.contains(&e.as_str())));
            match target {
                Some(i) => {
                    self.tabs[i].drops.push(f);
                    self.switch_to = Some(i);
                    moved = true;
                }
                None => keep.push(f),
            }
        }
        if moved {
            self.tabs[self.active].drops.append(&mut keep);
        } else {
            raw.dropped_files = keep;
        }
    }

    /// A close request arrived: ask the running apps, the shown one first.
    fn begin_close(&mut self) {
        let mut queue: Vec<usize> = (0..self.tabs.len()).filter(|&i| self.tabs[i].app.is_some() && !self.tabs[i].home).collect();
        queue.sort_by_key(|&i| i != self.active);
        self.closing = queue;
    }

    /// After the shown app's turn in a frame with a close request: did it keep the window open?
    /// If not, keep the window open ourselves while the next running app is asked.
    fn continue_close(&mut self, ctx: &egui::Context, close_requested: bool) {
        if !close_requested || self.closing.is_empty() {
            return;
        }
        if self.closing.first() == Some(&self.active) {
            if ctx.viewport(|v| v.commands.contains(&ViewportCommand::CancelClose)) {
                log::info!("{} kept the window open", self.tabs[self.active].name);
                self.closing.clear();
                self.restart = false;
                return;
            }
            self.closing.remove(0);
        }
        if let Some(&next) = self.closing.first() {
            ctx.send_viewport_cmd(ViewportCommand::CancelClose);
            self.switch_to = Some(next);
            self.pass_close_on = true;
            ctx.request_repaint();
        }
        // Otherwise every running app agreed: the window closes after this frame.
    }

    /// After the shown app's turn: note the title it asked for, and undo what would break the
    /// suite's window (its own decorations, icon or minimum size).
    fn after_app(&mut self, ctx: &egui::Context) {
        let before = self.commands_before;
        let (title, decorations, icon, min_size) = ctx.viewport(|v| {
            let new = v.commands.get(before..).unwrap_or_default();
            let title = new.iter().rev().find_map(|c| if let ViewportCommand::Title(t) = c { Some(t.clone()) } else { None });
            let decorations = new.iter().any(|c| matches!(c, ViewportCommand::Decorations(d) if *d == titlebar::CUSTOM));
            let icon = new.iter().any(|c| matches!(c, ViewportCommand::Icon(_)));
            let min_size = new.iter().any(|c| matches!(c, ViewportCommand::MinInnerSize(_)));
            (title, decorations, icon, min_size)
        });
        if let Some(t) = title {
            self.tabs[self.active].title = Some(t);
        }
        if decorations {
            ctx.send_viewport_cmd(ViewportCommand::Decorations(!titlebar::CUSTOM));
        }
        if icon {
            ctx.send_viewport_cmd(ViewportCommand::Icon(self.window_icon.clone()));
        }
        if min_size {
            ctx.send_viewport_cmd(ViewportCommand::MinInnerSize(MIN_SIZE.into()));
        }
    }

    fn shoot_frame(&mut self, ctx: &egui::Context) {
        let Some(shoot) = &mut self.shoot else { return };
        if shoot.closing {
            return;
        }
        if shoot.pos >= self.tabs.len() {
            shoot.finish();
            ctx.send_viewport_cmd(ViewportCommand::Close);
            return;
        }
        if self.active != shoot.pos {
            self.switch_to = Some(shoot.pos);
            ctx.request_repaint();
            return;
        }
        let ready = self.tabs[shoot.pos].launch.is_none();
        shoot.tick(ctx, ready);
    }
}

impl eframe::App for SuiteApp {
    fn raw_input_hook(&mut self, ctx: &egui::Context, raw: &mut egui::RawInput) {
        if let Some((i, image)) = self.shoot.as_mut().and_then(|s| s.collect(raw)) {
            let tab = &self.tabs[i];
            let status = match (&tab.failed, tab.started_in_ms) {
                (Some(msg), _) => format!("FAILED: {msg}"),
                (None, Some(ms)) => format!("started in {ms:.0} ms"),
                (None, None) => "not started".to_owned(),
            };
            let id = tab.id;
            if let Some(s) = self.shoot.as_mut() {
                s.save(i, id, &image, status);
            }
        }
        if titlebar::CUSTOM {
            titlebar::release_after_os_resize(ctx, raw);
        }
        // A close request during a round belongs to it (apps that are quitting ask again every
        // frame until the window closes); only one outside a round starts one.
        if self.closing.is_empty() && raw.viewports.get(&ViewportId::ROOT).is_some_and(|v| v.close_requested()) {
            self.begin_close();
        }
        self.route_drops(raw);
        let requests: Vec<Request> = self.home_requests.as_ref().map(|(_, rx)| rx.try_iter().collect()).unwrap_or_default();
        for r in requests {
            match r {
                Request::Show(i) if self.closing.is_empty() => self.switch_to = Some(i),
                Request::Show(_) => {}
                Request::Restart => {
                    log::info!("restarting to finish an update");
                    self.restart = true;
                    ctx.send_viewport_cmd(ViewportCommand::Close);
                }
            }
        }
        // Another app handed this one files (`crate::open_in`): show it; it takes them itself.
        if self.closing.is_empty()
            && let Some(i) = crate::handoff::take_show(&self.tabs.iter().map(|t| t.id).collect::<Vec<_>>())
        {
            self.switch_to = Some(i);
        }
        if let Some(next) = self.switch_to.take() {
            self.activate(ctx, next);
        }
        if std::mem::take(&mut self.pass_close_on) {
            raw.viewports.entry(ViewportId::ROOT).or_default().events.push(egui::ViewportEvent::Close);
        }
        let i = self.active;
        if self.tabs[i].launch.is_some() && self.tabs[i].opening_shown {
            self.launch(ctx, i);
        }
        let tab = &mut self.tabs[i];
        if tab.app.is_some() && !tab.drops.is_empty() {
            raw.dropped_files.append(&mut tab.drops);
        }
        self.with_active_app(|app| app.raw_input_hook(ctx, raw));
    }

    fn logic(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.commands_before = ctx.viewport(|v| v.commands.len());
        self.with_active_app(|app| app.logic(ctx, frame));
    }

    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        if let Some(guard) = &self.frame_guard {
            guard.reapply();
        }
        let updates_available = self.updates.as_ref().map_or(0, |u| u.available());
        let views: Vec<TabView<'_>> = self
            .tabs
            .iter()
            .map(|t| TabView {
                name: t.name,
                summary: t.summary,
                icon: t.icon.as_ref().map(|i| i.id()),
                state: t.state(),
                dot: t.state() == TabState::Running && !t.home,
                badge: if t.home { updates_available } else { 0 },
            })
            .collect();
        // With a Home tab, the suite's mark is on it rather than beside the tabs.
        let mark = if self.updates.is_some() { None } else { self.icon.as_ref().map(|i| i.id()) };
        let bar = titlebar::Bar { suite: self.name, icon: mark, tabs: &views, active: self.active };
        if let Some(i) = titlebar::show(ui, &bar)
            && i != self.active
            && self.shoot.is_none()
        {
            self.switch_to = Some(i);
            ctx.request_repaint();
        }

        // The app gets the window below the title bar as a `Ui` of its own: some apps lay out by
        // their `ui.max_rect()` (FilmCraft) rather than by panels, and would draw over the bar.
        let body = ui.available_rect_before_wrap();
        let mut app_ui = ui.new_child(egui::UiBuilder::new().id_salt("craft-suite-app").max_rect(body).layout(egui::Layout::top_down(egui::Align::Min)));
        app_ui.set_clip_rect(body);
        let close_requested = ctx.input(|i| i.viewport().close_requested());
        let i = self.active;
        if self.tabs[i].app.is_some() {
            self.with_active_app(|app| app.ui(&mut app_ui, frame));
            if self.tabs[i].app.is_some() {
                self.after_app(&ctx);
            }
        } else if let Some(msg) = &self.tabs[i].failed {
            failed_page(&mut app_ui, self.tabs[i].name, msg);
        } else {
            opening_page(&mut app_ui, &self.tabs[i]);
            self.tabs[i].opening_shown = true;
            ctx.request_repaint();
        }
        self.continue_close(&ctx, close_requested);
        if titlebar::CUSTOM {
            titlebar::resize_zones(ui);
        }
        self.shoot_frame(&ctx);
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        if self.shoot.is_none() {
            storage.set_string(ACTIVE_KEY, self.tabs[self.active].id.to_owned());
        }
        for (i, tab) in self.tabs.iter_mut().enumerate() {
            let Tab { app: Some(app), store, memory, name, .. } = tab else { continue };
            if catch_unwind(AssertUnwindSafe(|| app.save(&mut *store))).is_err() {
                log::error!("{name} failed to save its state");
                continue;
            }
            if app.persist_egui_memory() {
                if i == self.active {
                    self.ctx.memory(|m| eframe::set_value(&mut *store, EGUI_MEMORY_KEY, m));
                } else if let Some(m) = memory {
                    eframe::set_value(&mut *store, EGUI_MEMORY_KEY, m);
                }
            }
            eframe::Storage::flush(&mut *store);
        }
    }

    fn on_exit(&mut self) {
        for tab in &mut self.tabs {
            if let Some(app) = tab.app.as_deref_mut()
                && catch_unwind(AssertUnwindSafe(|| app.on_exit())).is_err()
            {
                log::error!("{} failed while shutting down", tab.name);
            }
        }
        if self.restart
            && let Some(u) = &self.updates
        {
            let exe = Some(u.installed_exe()).filter(|e| e.exists()).or_else(|| std::env::current_exe().ok());
            match exe.map(|e| std::process::Command::new(&e).current_dir(e.parent().unwrap_or(Path::new("."))).spawn()) {
                Some(Ok(_)) => log::info!("started the updated {}", self.name),
                Some(Err(e)) => log::error!("couldn't start the updated {}: {e}", self.name),
                None => log::error!("couldn't find the updated {}", self.name),
            }
        }
        log::info!("{} closed", self.name);
        log::logger().flush();
    }

    fn clear_color(&self, visuals: &egui::Visuals) -> [f32; 4] {
        match &self.tabs[self.active].app {
            Some(app) => app.clear_color(visuals),
            None => visuals.panel_fill.to_normalized_gamma_f32(),
        }
    }

    /// Each app's memory is saved in its own store (`save`), not the suite's.
    fn persist_egui_memory(&self) -> bool {
        false
    }
}

fn opening_page(ui: &mut egui::Ui, tab: &Tab) {
    egui::CentralPanel::default().show(ui, |ui| {
        ui.vertical_centered(|ui| {
            ui.add_space((ui.available_height() * 0.36 - 60.0).max(0.0));
            if let Some(icon) = &tab.icon {
                ui.add(egui::Image::new((icon.id(), egui::vec2(64.0, 64.0))));
            }
            ui.add_space(14.0);
            ui.label(egui::RichText::new(format!("Opening {}…", tab.name)).size(18.0));
            ui.add_space(10.0);
            ui.add(egui::Spinner::new());
        });
    });
}

fn failed_page(ui: &mut egui::Ui, name: &str, msg: &str) {
    egui::CentralPanel::default().show(ui, |ui| {
        ui.vertical_centered(|ui| {
            ui.add_space((ui.available_height() * 0.3 - 60.0).max(0.0));
            ui.label(egui::RichText::new(format!("{name} stopped")).size(20.0).strong());
            ui.add_space(8.0);
            ui.label(format!("Something went wrong inside {name}. The other apps in this window are not affected."));
            ui.label(format!("Close and reopen the window to use {name} again."));
            ui.add_space(12.0);
            ui.collapsing("Details", |ui| {
                ui.add(egui::Label::new(egui::RichText::new(msg).monospace()).selectable(true));
                if ui.button("Copy details").clicked() {
                    ui.ctx().copy_text(format!("{name}: {msg}"));
                }
            });
        });
    });
}

/// The PNG `bytes` as a texture, at most 128 px wide (tab icons draw it at 16 pt, "Opening …" at
/// 64 pt), with mipmaps so it stays smooth when drawn small.
fn texture(ctx: &egui::Context, name: &str, png: &[u8]) -> Option<egui::TextureHandle> {
    let img = decode(png, 128)?;
    let size = [img.width() as usize, img.height() as usize];
    let options = egui::TextureOptions::LINEAR.with_mipmap_mode(Some(egui::TextureFilter::Linear));
    Some(ctx.load_texture(name, egui::ColorImage::from_rgba_unmultiplied(size, img.as_raw()), options))
}

/// The window icon from PNG `bytes`, at most 256 px.
pub(crate) fn icon_data(png: &[u8]) -> Option<egui::IconData> {
    let img = decode(png, 256)?;
    Some(egui::IconData { width: img.width(), height: img.height(), rgba: img.into_raw() })
}

fn decode(png: &[u8], max: u32) -> Option<image::RgbaImage> {
    if png.is_empty() {
        return None;
    }
    let img = match image::load_from_memory_with_format(png, image::ImageFormat::Png) {
        Ok(img) => img,
        Err(e) => {
            log::warn!("icon: {e}");
            return None;
        }
    };
    let img = if img.width() > max || img.height() > max { img.resize(max, max, image::imageops::FilterType::Lanczos3) } else { img };
    Some(img.into_rgba8())
}

fn extension(p: &Path) -> Option<String> {
    Some(p.extension()?.to_str()?.to_ascii_lowercase())
}

pub(crate) fn panic_message(p: &(dyn Any + Send)) -> String {
    p.downcast_ref::<&str>().map(|s| (*s).to_owned()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "unknown panic".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Tool;
    use std::cell::RefCell;

    thread_local! {
        /// What the probe apps did, in order.
        static EVENTS: RefCell<Vec<String>> = RefCell::default();
        /// Probe apps that keep the window open when asked to close.
        static KEEP_OPEN: RefCell<Vec<&'static str>> = RefCell::default();
        /// Probe apps that ask the window to close every frame.
        static QUITTING: RefCell<Vec<&'static str>> = RefCell::default();
        /// The `Ui` a probe app was last given: its max rect and clip rect.
        static UI_RECTS: std::cell::Cell<Option<(egui::Rect, egui::Rect)>> = const { std::cell::Cell::new(None) };
    }

    fn note(s: String) {
        EVENTS.with(|e| e.borrow_mut().push(s));
    }

    fn events() -> Vec<String> {
        EVENTS.with(|e| std::mem::take(&mut *e.borrow_mut()))
    }

    /// An app that records what happens to it, at its own zoom factor; "crash" panics in `ui`.
    struct Probe(&'static str);

    impl eframe::App for Probe {
        fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
            for f in raw.dropped_files.drain(..) {
                note(format!("{} got {}", self.0, f.path().display()));
            }
        }

        fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
            if ctx.input(|i| i.viewport().close_requested()) {
                note(format!("{} asked to close", self.0));
                if KEEP_OPEN.with(|k| k.borrow().contains(&self.0)) {
                    ctx.send_viewport_cmd(ViewportCommand::CancelClose);
                }
            }
            // Like apps whose Quit asks the window to close every frame until it does.
            if QUITTING.with(|q| q.borrow().contains(&self.0)) {
                ctx.send_viewport_cmd(ViewportCommand::Close);
            }
        }

        fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
            note(format!("{} at zoom {}", self.0, ui.ctx().zoom_factor()));
            UI_RECTS.with(|r| r.set(Some((ui.max_rect(), ui.clip_rect()))));
            egui::CentralPanel::default().show(ui, |ui| ui.label(self.0));
            assert_ne!(self.0, "crash", "the crash probe crashed");
        }

        fn on_exit(&mut self) {
            note(format!("{} exited", self.0));
        }
    }

    fn launch(id: &'static str, zoom: f32) -> Launch {
        Box::new(move |cc| {
            note(format!("{id} started"));
            cc.egui_ctx.set_zoom_factor(zoom);
            Box::new(Probe(id))
        })
    }

    fn tool(id: &'static str, extensions: &'static [&'static str], prepare: fn(&eframe::CreationContext<'_>, Startup) -> Launch) -> Tool {
        Tool { id, name: id, summary: "", icon_png: &[], extensions, prepare, standalone_storage: None }
    }

    fn tools() -> Vec<Tool> {
        vec![
            tool("a", &["aaa"], |_, _| launch("a", 1.25)),
            tool("b", &["bbb"], |_, _| launch("b", 2.0)),
            tool("c", &["ccc"], |_, _| launch("c", 1.0)),
            tool("crash", &[], |_, _| launch("crash", 1.0)),
        ]
    }

    #[derive(Debug)]
    struct File(PathBuf);

    impl egui::DroppedFile for File {
        fn path(&self) -> &Path {
            &self.0
        }

        fn bytes(&self) -> Result<Vec<u8>, String> {
            Ok(vec![])
        }
    }

    /// The suite without a window, driven frame by frame as eframe drives it.
    struct Harness {
        suite: SuiteApp,
        ctx: egui::Context,
        frame: eframe::Frame,
        time: f64,
        /// A `Close` was sent last frame: eframe turns it into a close request for the next one.
        close_sent: bool,
    }

    impl Harness {
        fn new() -> Self {
            let ctx = egui::Context::default();
            let cc = eframe::CreationContext::_new_kittest(ctx.clone());
            let suite = SuiteApp::new(&cc, Suite { name: "Test", app_id: "test", icon_png: &[], tools: tools(), package: None }, Args::default(), None);
            events();
            Self { suite, ctx, frame: eframe::Frame::_new_kittest(), time: 0.0, close_sent: false }
        }

        /// One frame, with a close request from the OS when `close`, and `drops`: the commands sent.
        fn frame_with(&mut self, close: bool, drops: Vec<egui::DroppedFileHandle>) -> Vec<ViewportCommand> {
            self.time += 1.0 / 60.0;
            let mut raw = egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1280.0, 800.0))),
                time: Some(self.time),
                dropped_files: drops,
                ..Default::default()
            };
            if close || std::mem::take(&mut self.close_sent) {
                raw.viewports.entry(ViewportId::ROOT).or_default().events.push(egui::ViewportEvent::Close);
            }
            let Self { suite, ctx, frame, .. } = self;
            eframe::App::raw_input_hook(suite, ctx, &mut raw);
            let mut out = ctx.run_ui(raw, |ui| {
                eframe::App::logic(suite, ui.ctx(), frame);
                eframe::App::ui(suite, ui, frame);
            });
            out.textures_delta.clear();
            let commands = out.viewport_output.remove(&ViewportId::ROOT).map(|v| v.commands).unwrap_or_default();
            self.close_sent = commands.contains(&ViewportCommand::Close);
            commands
        }

        fn frame(&mut self) -> Vec<ViewportCommand> {
            self.frame_with(false, vec![])
        }

        /// Shows tab `i` (as a click on it does) and runs frames until its app has drawn.
        fn show(&mut self, i: usize) {
            self.suite.switch_to = Some(i);
            for _ in 0..3 {
                self.frame();
            }
        }
    }

    /// A window with a Home tab, whose update checks ask a stand-in for git: `a` has a newer
    /// release, `b` is up to date.
    fn harness_with_home() -> Harness {
        let ctx = egui::Context::default();
        let cc = eframe::CreationContext::_new_kittest(ctx.clone());
        let root = std::env::temp_dir().join(format!("craft-suite-home-{}-{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&root).unwrap();
        let lock = "a  1111  v1.0.0  https://example.com/a\nb  2222  v1.0.0  https://example.com/b\n";
        let exec: Box<crate::update::Exec> = Box::new(|cmd, on_line| {
            if cmd.args.first().map(String::as_str) == Some("ls-remote") {
                on_line(if cmd.args.iter().any(|a| a.ends_with("/a")) { "3333\trefs/tags/v1.1.0" } else { "2222\trefs/tags/v1.0.0" });
            }
            Ok(())
        });
        let updates = Updates::with("craft-test", &["a", "b", "c", "crash"], lock, root, exec, Box::new(|| {}));
        let suite = Suite { name: "Test", app_id: "test", icon_png: &[], tools: tools(), package: Some("craft-test") };
        let suite = SuiteApp::with_updates(&cc, suite, Args::default(), None, Some(updates));
        events();
        Harness { suite, ctx, frame: eframe::Frame::_new_kittest(), time: 0.0, close_sent: false }
    }

    fn send(h: &Harness, request: Request) {
        h.suite.home_requests.as_ref().unwrap().0.send(request).unwrap();
    }

    #[test]
    fn the_home_tab_comes_first_opens_at_once_and_counts_updates() {
        let mut h = harness_with_home();
        assert_eq!((h.suite.tabs[0].id, h.suite.tabs[1].id), ("home", "a"));
        assert_eq!(h.suite.active, 0, "a window opens on Home");
        h.frame();
        assert!(h.suite.tabs[0].app.is_some(), "Home needs no \"Opening …\" frame");
        let u = h.suite.updates.clone().unwrap();
        let start = Instant::now();
        while u.checked_at().is_none() && start.elapsed().as_secs() < 5 {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        h.frame();
        assert_eq!(u.available(), 1, "the badge's count");
        assert!(matches!(u.check_of("a"), Some(crate::update::Check::Available { .. })));
        assert_eq!(u.check_of("b"), Some(crate::update::Check::UpToDate));
    }

    #[test]
    fn home_shows_apps_and_restarts_through_the_close_round() {
        let mut h = harness_with_home();
        h.frame();
        send(&h, Request::Show(2));
        for _ in 0..3 {
            h.frame();
        }
        assert_eq!(h.suite.active, 2);
        assert!(h.suite.tabs[2].app.is_some(), "b runs");
        events();
        // Restarting closes the window the usual way: every running app but Home is asked, and
        // one keeping it open (unsaved work) calls the restart off.
        KEEP_OPEN.with(|k| *k.borrow_mut() = vec!["b"]);
        send(&h, Request::Restart);
        assert!(h.frame().contains(&ViewportCommand::Close));
        assert!(h.suite.restart);
        h.frame();
        assert!(!h.suite.restart, "b kept the window open");
        let asked: Vec<_> = events().into_iter().filter(|e| e.ends_with("asked to close")).collect();
        assert_eq!(asked, ["b asked to close"]);
        KEEP_OPEN.with(|k| k.borrow_mut().clear());
    }

    #[test]
    fn apps_start_when_first_shown_and_keep_their_own_state() {
        let mut h = Harness::new();
        h.frame();
        assert_eq!(events(), Vec::<String>::new(), "the first frame only says it's opening");
        h.frame();
        assert_eq!(events(), ["a started", "a at zoom 1.25"]);
        h.show(1);
        let e = events();
        assert!(e.starts_with(&["b started".into(), "b at zoom 2".into()]), "{e:?}");
        assert!(e.iter().all(|e| !e.starts_with("a ")), "a hidden app gets no calls: {e:?}");
        h.show(0);
        let e = events();
        assert!(e.iter().all(|e| e == "a at zoom 1.25"), "a comes back as it was, not started again: {e:?}");
        assert!(h.suite.tabs[2].app.is_none(), "c was never shown, so never started");
    }

    #[test]
    fn closing_asks_each_running_app_and_any_of_them_can_keep_the_window_open() {
        let mut h = Harness::new();
        h.show(0);
        h.show(1);
        h.show(0);
        events();
        KEEP_OPEN.with(|k| *k.borrow_mut() = vec!["b"]);
        let cmds = h.frame_with(true, vec![]);
        assert!(cmds.contains(&ViewportCommand::CancelClose), "a agreed, so the suite holds the window for b: {cmds:?}");
        let cmds = h.frame();
        assert!(cmds.contains(&ViewportCommand::CancelClose), "b keeps it open: {cmds:?}");
        assert_eq!(h.suite.active, 1, "b is shown, with its own prompt");
        assert!(h.suite.closing.is_empty());
        assert!(!h.frame().contains(&ViewportCommand::CancelClose), "the round is over");

        KEEP_OPEN.with(|k| k.borrow_mut().clear());
        events();
        assert!(h.frame_with(true, vec![]).contains(&ViewportCommand::CancelClose), "b agrees; a is asked next");
        let cmds = h.frame();
        assert!(!cmds.contains(&ViewportCommand::CancelClose), "everyone agreed: the window closes: {cmds:?}");
        let e = events();
        assert_eq!(e.iter().filter(|e| e.ends_with("asked to close")).collect::<Vec<_>>(), ["b asked to close", "a asked to close"]);
        eframe::App::on_exit(&mut h.suite);
        let mut exited = events();
        exited.sort();
        assert_eq!(exited, ["a exited", "b exited"], "c never ran");
    }

    /// An app quitting from its own menu asks the window to close every frame; that is one round,
    /// not a new one each frame (which would hand the window back and forth between two apps).
    #[test]
    fn an_app_that_keeps_asking_to_close_gets_one_round() {
        let mut h = Harness::new();
        h.show(0);
        h.show(1);
        events();
        QUITTING.with(|q| *q.borrow_mut() = vec!["b"]);
        KEEP_OPEN.with(|k| *k.borrow_mut() = vec!["a"]);
        h.frame(); // b asks to close.
        assert!(h.frame().contains(&ViewportCommand::CancelClose), "b agrees; the suite holds the window for a");
        h.frame(); // a is asked, while b's requests keep coming, and keeps the window open.
        assert_eq!(h.suite.active, 0);
        assert!(h.suite.closing.is_empty(), "the round is over");
        for _ in 0..3 {
            h.frame();
        }
        assert_eq!(h.suite.active, 0, "a stays shown: b, hidden, asks nothing more");
        let asked: Vec<_> = events().into_iter().filter(|e| e.ends_with("asked to close")).collect();
        assert_eq!(asked, ["b asked to close", "a asked to close"]);
        QUITTING.with(|q| q.borrow_mut().clear());
        KEEP_OPEN.with(|k| k.borrow_mut().clear());
    }

    /// Apps that lay out by `ui.max_rect()` (FilmCraft) get the window below the title bar, and
    /// can't paint over it.
    #[test]
    fn the_app_gets_the_window_below_the_title_bar() {
        let mut h = Harness::new();
        h.show(0);
        let (max, clip) = UI_RECTS.with(|r| r.get()).unwrap();
        assert_eq!(max.top(), titlebar::HEIGHT, "{max:?}");
        assert_eq!(clip.top(), titlebar::HEIGHT, "{clip:?}");
        assert_eq!(max.bottom(), h.ctx.content_rect().bottom());
    }

    #[test]
    fn a_crashing_app_is_set_aside_and_the_others_keep_working() {
        let mut h = Harness::new();
        h.show(3);
        assert!(h.suite.tabs[3].failed.as_deref().is_some_and(|m| m.contains("the crash probe crashed")));
        assert_eq!(h.suite.tabs[3].state(), TabState::Failed);
        h.frame();
        h.show(0);
        assert!(events().contains(&"a at zoom 1.25".to_string()));
        // Its failed tab still shows (the failure page) without running anything.
        h.show(3);
        h.frame();
    }

    #[test]
    fn dropped_files_go_to_the_app_that_opens_them() {
        let mut h = Harness::new();
        h.show(0);
        events();
        let drop = |p: &str| -> egui::DroppedFileHandle { Arc::new(File(PathBuf::from(p))) };
        h.frame_with(false, vec![drop("x.bbb"), drop("y.aaa"), drop("z.unknown")]);
        assert_eq!(h.suite.active, 1, "the window moves to the app that opens .bbb");
        h.frame();
        h.frame();
        let got = |e: Vec<String>| e.into_iter().filter(|e| e.contains(" got ")).collect::<Vec<_>>();
        assert_eq!(got(events()), ["b got x.bbb"]);
        // What a opens, and what nobody claims, waited for a.
        h.show(0);
        assert_eq!(got(events()), ["a got y.aaa", "a got z.unknown"]);
    }

    #[test]
    fn panic_messages_read_both_kinds_of_payload() {
        let p = catch_unwind(|| panic!("plain")).unwrap_err();
        assert_eq!(panic_message(p.as_ref()), "plain");
        let n = 3;
        let p = catch_unwind(|| panic!("formatted {n}")).unwrap_err();
        assert_eq!(panic_message(p.as_ref()), "formatted 3");
    }
}
