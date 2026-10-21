//! Runs several ArtCraft apps in one window, each behind a tab in the window's title bar.
//!
//! The apps are ordinary eframe apps. They share the window, its GPU device and its egui context,
//! and each keeps its own egui state (style, zoom, fonts, panel sizes, popups), which the suite
//! swaps in when that app's tab is shown ([`host`]). Only the app on screen runs; the others wait,
//! untouched, as eframe leaves an app while its window is minimized.
//!
//! An app joins through a [`Tool`]: its name and icon, the files it opens, and a `prepare`
//! function the suite calls once at start-up with the window's real [`eframe::CreationContext`]
//! (window handle, GPU). `prepare` returns the [`Launch`] that builds the app the first time its
//! tab is shown, so apps nobody opens cost nothing.

mod gpu;
mod handoff;
mod home;
mod host;
mod logging;
mod shoot;
mod store;
mod titlebar;
mod update;
mod window_frame;

use std::path::{Path, PathBuf};

pub use handoff::{has_tool, open_in, take_open_requests};

/// One app of the suite.
pub struct Tool {
    /// Stable identifier: names the app's saved state, and `--tab <id>` on the command line.
    pub id: &'static str,
    /// The tab's label, e.g. "PhotoCraft".
    pub name: &'static str,
    /// What the app is for, shown when hovering its tab.
    pub summary: &'static str,
    /// The tab's icon, PNG.
    pub icon_png: &'static [u8],
    /// File extensions the app opens (lowercase, no dot). Files on the command line, or dropped
    /// on the window, go to the first app that lists their extension.
    pub extensions: &'static [&'static str],
    /// Called once while the window opens. Must be quick: anything slow belongs in the returned
    /// [`Launch`], which runs only when the app is first shown.
    pub prepare: fn(&eframe::CreationContext<'_>, Startup) -> Launch,
    /// Where the standalone app keeps its eframe storage (`app.ron`, or its `persistence_path`),
    /// for apps that keep settings there. The app's own store in the suite starts as a copy of it,
    /// so the app comes up with the user's settings the first time it runs in the suite.
    pub standalone_storage: Option<fn() -> Option<PathBuf>>,
}

/// What a [`Tool`] is started with.
#[derive(Debug, Default)]
pub struct Startup {
    /// Files from the command line that this app opens.
    pub files: Vec<PathBuf>,
    /// Neither read nor write the user's settings, recent files or other saved state for this
    /// run (`--no-settings`, tests): the app starts as on a fresh install and leaves no trace.
    pub no_settings: bool,
}

/// Builds the app, the first time its tab is shown. The [`eframe::CreationContext`] carries the
/// shared egui context and GPU state, and the app's own storage; it has no window handle (eframe
/// only lends that during start-up), so anything that needs one belongs in [`Tool::prepare`].
pub type Launch = Box<dyn FnOnce(&eframe::CreationContext<'_>) -> Box<dyn eframe::App>>;

/// A window of apps.
pub struct Suite {
    /// The window's name, e.g. "ArtCraft Media".
    pub name: &'static str,
    /// Identifies the suite to the OS (Wayland app id) and names its settings folder.
    pub app_id: &'static str,
    /// The window icon, PNG.
    pub icon_png: &'static [u8],
    /// The tabs, left to right.
    pub tools: Vec<Tool>,
    /// The cargo package that builds this window (`craft-studio`). With it, the window opens with
    /// a Home tab that checks every app for a newer release and rebuilds the window with it
    /// ([`update`]); `None`: no Home tab.
    pub package: Option<&'static str>,
}

/// The command line: `[--tab <id>] [--no-settings] [--screenshot-all <dir>] [--update <app>|all]
/// [files…]`.
#[derive(Debug, Default)]
struct Args {
    tab: Option<String>,
    no_settings: bool,
    screenshot_all: Option<PathBuf>,
    /// Build updates for these apps (comma-separated, or `all`) instead of opening the window.
    update: Option<String>,
    files: Vec<PathBuf>,
}

impl Args {
    fn parse(args: impl IntoIterator<Item = std::ffi::OsString>) -> Result<Self, String> {
        let mut out = Self::default();
        let mut args = args.into_iter();
        while let Some(a) = args.next() {
            match a.to_str() {
                Some("--tab") => out.tab = Some(args.next().and_then(|v| v.into_string().ok()).ok_or("--tab needs an app id")?),
                Some("--no-settings") => out.no_settings = true,
                Some("--screenshot-all") => out.screenshot_all = Some(args.next().map(PathBuf::from).ok_or("--screenshot-all needs a folder")?),
                Some("--update") => out.update = Some(args.next().and_then(|v| v.into_string().ok()).ok_or("--update needs app ids, or all")?),
                Some(s) if s.starts_with("--") => return Err(format!("unknown option {s}")),
                // Old macOS passes a process serial number when launched from Finder.
                Some(s) if s.starts_with("-psn_") => {}
                _ => out.files.push(PathBuf::from(a)),
            }
        }
        Ok(out)
    }
}

/// The tool that opens `path`, by its extension.
fn tool_for(tools: &[Tool], path: &Path) -> Option<usize> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    tools.iter().position(|t| t.extensions.contains(&ext.as_str()))
}

/// Opens the window and runs the suite until it closes.
pub fn run(suite: Suite) -> eframe::Result {
    let args = match Args::parse(std::env::args_os().skip(1)) {
        Ok(args) => args,
        Err(e) => {
            eprintln!("{}: {e}", suite.app_id);
            eprintln!(
                "usage: {} [--tab <{}>] [--no-settings] [--screenshot-all <dir>] [--update <app,…>|all] [files…]",
                suite.app_id,
                suite.tools.iter().map(|t| t.id).collect::<Vec<_>>().join("|")
            );
            std::process::exit(2);
        }
    };
    // `--no-settings`: no window state, app stores or log file either.
    let data_dir = if args.no_settings { None } else { eframe::storage_dir(suite.app_id) };
    logging::install(suite.app_id, data_dir.as_deref());
    log::info!("{} {} starting with {} apps", suite.name, env!("CARGO_PKG_VERSION"), suite.tools.len());
    if let Some(wanted) = &args.update {
        let Some(package) = suite.package else {
            eprintln!("{}: this window can't update its apps", suite.app_id);
            std::process::exit(2);
        };
        let apps: Vec<&str> = suite.tools.iter().map(|t| t.id).collect();
        std::process::exit(update::Updates::run_cli(package, &apps, wanted));
    }

    let mut viewport = egui::ViewportBuilder::default()
        .with_title(suite.name)
        .with_app_id(suite.app_id)
        .with_inner_size([1440.0, 900.0])
        .with_min_inner_size([760.0, 480.0])
        .with_drag_and_drop(true)
        // macOS keeps its traffic lights over our title bar; elsewhere we draw the whole bar.
        .with_decorations(!titlebar::CUSTOM)
        .with_fullsize_content_view(true)
        .with_titlebar_shown(false)
        .with_title_shown(false);
    if let Some(icon) = host::icon_data(suite.icon_png) {
        viewport = viewport.with_icon(icon);
    }
    let mut options = eframe::NativeOptions {
        viewport,
        centered: true,
        renderer: eframe::Renderer::Wgpu,
        persistence_path: data_dir.as_ref().map(|d| d.join("window.ron")),
        window_builder: Some(Box::new(at_least_min_size)),
        ..Default::default()
    };
    gpu::configure(&mut options);
    let name = suite.name;
    eframe::run_native(name, options, Box::new(move |cc| Ok(Box::new(host::SuiteApp::new(cc, suite, args, data_dir)))))
}

/// Starts `tool`'s app without a window, as the suite would with `--no-settings`, and runs
/// `frames` frames of it at 1280 × 800 points. `Err` holds the message of a panic in `prepare`,
/// the launch, a frame or `on_exit`. For the host crates' tests: proof that an app starts and
/// draws inside the suite. (No GPU: apps get no wgpu render state, as on a CPU fallback.)
pub fn smoke_test(tool: &Tool, frames: usize) -> Result<(), String> {
    use std::panic::{AssertUnwindSafe, catch_unwind};
    let catch = |f: &mut dyn FnMut()| catch_unwind(AssertUnwindSafe(f)).map_err(|p| host::panic_message(p.as_ref()));
    let ctx = egui::Context::default();
    let cc = eframe::CreationContext::_new_kittest(ctx.clone());
    let mut launch = None;
    catch(&mut || launch = Some((tool.prepare)(&cc, Startup { files: vec![], no_settings: true })))?;
    let mut app = None;
    if let Some(launch) = launch {
        let mut launch = Some(launch);
        catch(&mut || app = launch.take().map(|l| l(&cc)))?;
    }
    let Some(mut app) = app else { return Err("no app".into()) };
    let mut frame = eframe::Frame::_new_kittest();
    for i in 0..frames {
        let mut input = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1280.0, 800.0))),
            time: Some(i as f64 / 60.0),
            ..Default::default()
        };
        catch(&mut || {
            app.raw_input_hook(&ctx, &mut input);
            let mut out = ctx.run_ui(input.take(), |ui| {
                app.logic(ui.ctx(), &mut frame);
                app.ui(ui, &mut frame);
            });
            out.textures_delta.clear();
        })?;
    }
    catch(&mut || app.on_exit())
}

/// Grow a restored window that is smaller than the minimum size (eframe saves a minimized
/// window's size on Windows), keeping its centre.
fn at_least_min_size(mut builder: egui::ViewportBuilder) -> egui::ViewportBuilder {
    let (Some(size), Some(min)) = (builder.inner_size, builder.min_inner_size) else { return builder };
    let grown = size.max(min);
    if grown != size {
        builder.position = builder.position.map(|pos| pos - (grown - size) / 2.0);
        builder.inner_size = Some(grown);
    }
    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(id: &'static str, extensions: &'static [&'static str]) -> Tool {
        Tool { id, name: id, summary: "", icon_png: &[], extensions, prepare: |_, _| Box::new(|_| unreachable!()), standalone_storage: None }
    }

    /// An app that draws a label, counts its frames, and panics on demand.
    struct Probe(std::sync::Arc<std::sync::atomic::AtomicUsize>);

    impl eframe::App for Probe {
        fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
            let n = self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            egui::CentralPanel::default().show(ui, |ui| ui.label(format!("frame {n}")));
            if n == 3 && ui.ctx().memory(|m| m.options.zoom_factor) > 1.0 {
                panic!("frame three, zoomed");
            }
        }
    }

    static FRAMES: std::sync::OnceLock<std::sync::Arc<std::sync::atomic::AtomicUsize>> = std::sync::OnceLock::new();

    #[test]
    fn the_smoke_test_runs_frames_and_reports_panics() {
        let frames = FRAMES.get_or_init(Default::default).clone();
        let mut t = tool("probe", &[]);
        t.prepare = |_, startup| {
            assert!(startup.no_settings, "smoke tests never touch the user's settings");
            Box::new(|_| Box::new(Probe(FRAMES.get_or_init(Default::default).clone())))
        };
        smoke_test(&t, 5).unwrap();
        assert_eq!(frames.load(std::sync::atomic::Ordering::Relaxed), 5);
        t.prepare = |_, _| {
            Box::new(|cc| {
                cc.egui_ctx.set_zoom_factor(1.5);
                Box::new(Probe(Default::default()))
            })
        };
        assert_eq!(smoke_test(&t, 5), Err("frame three, zoomed".into()));
    }

    #[test]
    fn files_go_to_the_first_app_that_opens_their_extension() {
        let tools = [tool("photo", &["png", "psd"]), tool("film", &["mp4", "png"])];
        assert_eq!(tool_for(&tools, Path::new("a/b.PSD")), Some(0));
        assert_eq!(tool_for(&tools, Path::new("clip.mp4")), Some(1));
        assert_eq!(tool_for(&tools, Path::new("x.png")), Some(0));
        assert_eq!(tool_for(&tools, Path::new("notes.txt")), None);
        assert_eq!(tool_for(&tools, Path::new("README")), None);
    }

    #[test]
    fn the_command_line_takes_a_tab_a_screenshot_folder_and_files() {
        let os = |v: &[&str]| v.iter().map(std::ffi::OsString::from).collect::<Vec<_>>();
        let a = Args::parse(os(&["--tab", "wordcraft", "a.docx", "--screenshot-all", "shots", "--no-settings", "b.xlsx", "--update", "all"])).unwrap();
        assert_eq!(a.tab.as_deref(), Some("wordcraft"));
        assert!(a.no_settings);
        assert_eq!(a.update.as_deref(), Some("all"));
        assert_eq!(a.screenshot_all, Some(PathBuf::from("shots")));
        assert_eq!(a.files, vec![PathBuf::from("a.docx"), PathBuf::from("b.xlsx")]);
        assert!(Args::parse(os(&["--tab"])).is_err());
        assert!(Args::parse(os(&["--nope"])).is_err());
    }
}
