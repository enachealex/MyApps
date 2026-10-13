//! One log for the whole window, to standard error and to `<settings>/logs/<app id>.log` (the
//! previous run's is kept as `.previous.log`). The apps log through the `log` crate as they do on
//! their own; this takes the place of each app's logger, since a process has only one.
//!
//! `CRAFT_LOG=debug` (or `trace`, `warn`, …) changes the level for the apps and the suite.

use std::io::Write as _;
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

struct Logger {
    start: Instant,
    level: log::LevelFilter,
    file: Mutex<Option<std::fs::File>>,
}

/// Graphics and windowing crates are chatty below warnings.
fn quiet(target: &str) -> bool {
    ["wgpu", "naga", "winit", "eframe", "egui", "accesskit", "zbus", "tracing", "calloop", "sctk", "symphonia"].iter().any(|p| target.starts_with(p))
}

impl log::Log for Logger {
    fn enabled(&self, m: &log::Metadata<'_>) -> bool {
        let max = if quiet(m.target()) { self.level.min(log::LevelFilter::Warn) } else { self.level };
        m.level() <= max
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!("[{:>9.3} {:<5} {}] {}\n", self.start.elapsed().as_secs_f64(), record.level(), record.target(), record.args());
        let _ = std::io::stderr().write_all(line.as_bytes());
        if let Some(f) = self.file.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_mut() {
            let _ = f.write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Some(f) = self.file.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_mut() {
            let _ = f.flush();
        }
    }
}

pub fn install(app_id: &str, data_dir: Option<&Path>) {
    let level = std::env::var("CRAFT_LOG").ok().and_then(|v| v.parse().ok()).unwrap_or(log::LevelFilter::Info);
    let file = data_dir.and_then(|dir| {
        let dir = dir.join("logs");
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join(format!("{app_id}.log"));
        let _ = std::fs::rename(&path, dir.join(format!("{app_id}.previous.log")));
        std::fs::File::create(path).ok()
    });
    let logger = Logger { start: Instant::now(), level, file: Mutex::new(file) };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(level);
    }
    // A panic anywhere (an app's thread included) is recorded before the default report.
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        log::error!("panic on thread {}: {info}", thread.name().unwrap_or("<unnamed>"));
        log::logger().flush();
        default(info);
    }));
}
