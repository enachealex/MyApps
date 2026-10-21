//! Keeping the window's apps up to date with their upstream releases.
//!
//! **Checking.** At start-up each app's newest release is looked up with `git ls-remote --tags`
//! (plain git: no GitHub API, so no rate limit or account) and compared with the version the
//! window was built from, which `upstream.lock` records beside each app's commit (`v0.7.0`, or
//! `v0.7.0+` for commits after that release).
//!
//! **Updating.** The apps are compiled into the window, so an update rebuilds it from the
//! source folder this program was built from: pin the new release in `upstream.lock`, check it
//! out (`scripts/fetch-upstream`), `cargo build --release`, put the new program in `dist/`, and
//! delete the build cache. The running window carries on meanwhile and offers a restart at the
//! end. If any step fails, the old pin and sources are put back and nothing else changes.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

/// `upstream.lock` as this program was built: the versions it runs.
const BUILT_LOCK: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../upstream.lock"));
/// The source folder this program was built from, where updates are built.
const SOURCE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
/// Lines of build output kept for the Home page.
const TAIL: usize = 14;
/// An update guard older than this was left by a crashed update.
const STALE_GUARD: Duration = Duration::from_secs(3 * 60 * 60);

/// One line of `upstream.lock`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    pub name: String,
    pub commit: String,
    /// `v0.7.0`, `v0.7.0+` (commits after it), or `-` for repositories that aren't apps.
    pub version: String,
    pub url: String,
}

pub fn parse_lock(text: &str) -> Vec<Pin> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let mut f = l.split_whitespace();
            Some(Pin { name: f.next()?.into(), commit: f.next()?.into(), version: f.next()?.into(), url: f.next()?.into() })
        })
        .collect()
}

/// `text` with the commit and version of each named app replaced; comments, order and column
/// alignment stay as they were.
pub fn rewrite_lock(text: &str, changes: &[(&str, &str, &str)]) -> Result<String, String> {
    let mut seen = vec![false; changes.len()];
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let change = (!line.trim_start().starts_with('#') && fields.len() == 4).then(|| changes.iter().position(|(name, ..)| *name == fields[0])).flatten();
        match change {
            Some(i) => {
                seen[i] = true;
                let (name, commit, version) = changes[i];
                let ending = if line.ends_with("\r\n") {
                    "\r\n"
                } else if line.ends_with('\n') {
                    "\n"
                } else {
                    ""
                };
                out.push_str(&format!("{name:<16} {commit}  {version:<9} {}{ending}", fields[3]));
            }
            None => out.push_str(line),
        }
    }
    match changes.iter().zip(&seen).find(|(_, seen)| !**seen) {
        Some(((name, ..), _)) => Err(format!("{name} isn't in upstream.lock")),
        None => Ok(out),
    }
}

/// A release number, `vMAJOR.MINOR.PATCH`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(u32, u32, u32);

impl Version {
    /// `v1.2.3` or `1.2.3`; pre-releases (`v1.2.3-rc.1`) and anything else are `None`.
    pub fn parse(s: &str) -> Option<Self> {
        let mut parts = s.strip_prefix('v').unwrap_or(s).split('.');
        let v = Self(parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
        parts.next().is_none().then_some(v)
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "v{}.{}.{}", self.0, self.1, self.2)
    }
}

/// Whether release `latest` is newer than an installed `upstream.lock` version (`v0.7.0+` is
/// past v0.7.0, so v0.7.0 itself is not newer).
pub fn is_newer(latest: Version, installed: &str) -> bool {
    Version::parse(installed.trim_end_matches('+')).is_some_and(|v| latest > v)
}

/// The newest release in `git ls-remote --tags` output, with its commit: annotated tags list
/// the tag object and then, as `<tag>^{}`, the commit, which wins.
pub fn newest_release(ls_remote: &str) -> Option<(Version, String)> {
    let mut commits: HashMap<&str, &str> = HashMap::new();
    for line in ls_remote.lines() {
        let Some((sha, name)) = line.split_once('\t') else { continue };
        let Some(tag) = name.trim().strip_prefix("refs/tags/") else { continue };
        match tag.strip_suffix("^{}") {
            Some(tag) => {
                commits.insert(tag, sha.trim());
            }
            None => {
                commits.entry(tag).or_insert(sha.trim());
            }
        }
    }
    commits.into_iter().filter_map(|(tag, sha)| Some((Version::parse(tag)?, sha.to_owned()))).max_by_key(|(v, _)| *v)
}

/// What the check found for one app.
#[derive(Clone, Debug, PartialEq)]
pub enum Check {
    Checking,
    UpToDate,
    Available { version: Version, commit: String },
    Failed(String),
}

/// The step an update is at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Fetch,
    Build,
    Install,
    Clean,
}

impl Step {
    pub const ALL: [Step; 4] = [Step::Fetch, Step::Build, Step::Install, Step::Clean];

    pub fn label(self) -> &'static str {
        match self {
            Step::Fetch => "Downloading the source",
            Step::Build => "Building",
            Step::Install => "Installing",
            Step::Clean => "Cleaning up",
        }
    }
}

/// An app being updated: its name in `upstream.lock` and the release.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub name: String,
    pub version: Version,
    pub commit: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Job {
    Idle,
    Running {
        targets: Vec<Target>,
        step: Step,
        detail: String,
        started: Instant,
        tail: VecDeque<String>,
    },
    /// Built and in `dist/`: a restart runs it.
    Installed {
        targets: Vec<Target>,
    },
    Failed {
        targets: Vec<Target>,
        message: String,
        tail: VecDeque<String>,
    },
}

/// A command to run.
#[derive(Clone, Debug, PartialEq)]
pub struct Cmd {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

/// Runs a command to completion, passing each line it prints to the callback; `Err` says why it
/// couldn't run or how it ended. The real one is [`exec`]; tests stand in for it.
pub type Exec = dyn Fn(&Cmd, &mut dyn FnMut(&str)) -> Result<(), String> + Send + Sync;

/// Runs `cmd` without a console window, its output and errors line by line to `on_line`.
pub fn exec(cmd: &Cmd, on_line: &mut dyn FnMut(&str)) -> Result<(), String> {
    use std::io::BufRead as _;
    let mut c = std::process::Command::new(&cmd.program);
    c.args(&cmd.args).current_dir(&cmd.cwd).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = c.spawn().map_err(|e| format!("couldn't run {}: {e}", cmd.program))?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let readers: Vec<_> = [child.stdout.take().map(|o| Box::new(o) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|e| Box::new(e) as _)]
        .into_iter()
        .flatten()
        .map(|r| {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in std::io::BufReader::new(r).lines().map_while(Result::ok) {
                    let _ = tx.send(line);
                }
            })
        })
        .collect();
    drop(tx);
    for line in rx {
        on_line(&line);
    }
    for r in readers {
        let _ = r.join();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err(format!("{} {} ended with {status}", cmd.program, cmd.args.first().map_or("", String::as_str))) }
}

struct State {
    checks: HashMap<String, Check>,
    checked_at: Option<Instant>,
    job: Job,
    /// Why this program can't update its apps, if it can't.
    blocked: Option<String>,
}

/// The window's update checks and its update job, shared between the Home page and the worker
/// threads.
pub struct Updates {
    /// The cargo package that builds this window (`craft-studio`).
    package: &'static str,
    root: PathBuf,
    /// The apps of this window and the versions it was built with.
    pins: Vec<Pin>,
    state: Mutex<State>,
    exec: Box<Exec>,
    /// Wakes the window when something changes.
    repaint: Box<dyn Fn() + Send + Sync>,
}

impl Updates {
    /// For the window built by `package`, with apps `apps` (their names in `upstream.lock`).
    pub fn new(package: &'static str, apps: &[&str], ctx: egui::Context) -> Arc<Self> {
        Self::with(package, apps, BUILT_LOCK, source_root(), Box::new(exec), Box::new(move || ctx.request_repaint()))
    }

    /// `--update <app>[,<app>…]` or `--update all`: what the Home tab's Update buttons do, without
    /// a window, reporting to standard error. The exit code says whether it worked.
    pub fn run_cli(package: &'static str, apps: &[&str], wanted: &str) -> i32 {
        let u = Self::with(package, apps, BUILT_LOCK, source_root(), Box::new(exec), Box::new(|| {}));
        u.check();
        while u.checked_at().is_none() {
            std::thread::sleep(Duration::from_millis(50));
        }
        if let Some(why) = u.blocked() {
            eprintln!("{why}");
            return 1;
        }
        let names: Vec<&str> = if wanted == "all" { u.pins.iter().map(|p| p.name.as_str()).collect() } else { wanted.split(',').map(str::trim).collect() };
        let mut targets = vec![];
        for name in names {
            match u.check_of(name) {
                Some(Check::Available { version, .. }) => {
                    eprintln!("{name}: {} -> {version}", u.installed(name).unwrap_or("?"));
                    targets.push(name);
                }
                Some(Check::UpToDate) => eprintln!("{name}: up to date ({})", u.installed(name).unwrap_or("?")),
                Some(Check::Failed(e)) => eprintln!("{name}: couldn't check: {e}"),
                Some(Check::Checking) | None => eprintln!("{name}: not an app of {package}"),
            }
        }
        if targets.is_empty() {
            eprintln!("nothing to update");
            return 0;
        }
        u.update(&targets);
        let (mut step, mut shown) = (None, Instant::now());
        loop {
            match u.job() {
                Job::Running { step: s, detail, started, .. } => {
                    if step != Some(s) || shown.elapsed() >= Duration::from_secs(15) {
                        let t = started.elapsed().as_secs();
                        eprintln!("[{}:{:02}] {}{}", t / 60, t % 60, s.label(), if detail.is_empty() { String::new() } else { format!(": {detail}") });
                        (step, shown) = (Some(s), Instant::now());
                    }
                }
                Job::Installed { .. } => {
                    eprintln!("updated: {} is in {}; start it again to use the new versions", u.exe_name(), u.installed_exe().display());
                    return 0;
                }
                Job::Failed { message, tail, .. } => {
                    eprintln!("update failed: {message}\nnothing changed; the last output was:");
                    for line in tail {
                        eprintln!("  {line}");
                    }
                    return 1;
                }
                Job::Idle => return 1,
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    pub fn with(package: &'static str, apps: &[&str], lock: &str, root: PathBuf, exec: Box<Exec>, repaint: Box<dyn Fn() + Send + Sync>) -> Arc<Self> {
        let pins = parse_lock(lock).into_iter().filter(|p| apps.contains(&p.name.as_str()) && p.version != "-").collect();
        let state = State { checks: HashMap::new(), checked_at: None, job: Job::Idle, blocked: None };
        Arc::new(Self { package, root, pins, state: Mutex::new(state), exec, repaint })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The version this program was built with, for app `name`.
    pub fn installed(&self, name: &str) -> Option<&str> {
        self.pins.iter().find(|p| p.name == name).map(|p| p.version.as_str())
    }

    pub fn check_of(&self, name: &str) -> Option<Check> {
        self.lock().checks.get(name).cloned()
    }

    /// How many apps have a newer release.
    pub fn available(&self) -> usize {
        self.lock().checks.values().filter(|c| matches!(c, Check::Available { .. })).count()
    }

    pub fn checked_at(&self) -> Option<Instant> {
        self.lock().checked_at
    }

    pub fn job(&self) -> Job {
        self.lock().job.clone()
    }

    /// Why this program can't build updates (no source folder, no Rust), if it can't.
    pub fn blocked(&self) -> Option<String> {
        self.lock().blocked.clone()
    }

    pub fn busy(&self) -> bool {
        matches!(self.lock().job, Job::Running { .. })
    }

    /// Puts a failed update's report away.
    pub fn dismiss(&self) {
        let mut s = self.lock();
        if matches!(s.job, Job::Failed { .. }) {
            s.job = Job::Idle;
        }
    }

    /// Looks up every app's newest release, in the background.
    pub fn check(self: &Arc<Self>) {
        {
            let mut s = self.lock();
            for p in &self.pins {
                s.checks.insert(p.name.clone(), Check::Checking);
            }
        }
        (self.repaint)();
        let me = self.clone();
        std::thread::Builder::new()
            .name("update-check".into())
            .spawn(move || {
                let blocked = me.find_blocker();
                me.lock().blocked = blocked;
                let threads: Vec<_> = me
                    .pins
                    .clone()
                    .into_iter()
                    .map(|pin| {
                        let me = me.clone();
                        std::thread::spawn(move || {
                            let check = me.check_one(&pin);
                            if let Check::Failed(e) = &check {
                                log::warn!("update check for {}: {e}", pin.name);
                            }
                            me.lock().checks.insert(pin.name, check);
                            (me.repaint)();
                        })
                    })
                    .collect();
                for t in threads {
                    let _ = t.join();
                }
                me.lock().checked_at = Some(Instant::now());
                log::info!("update check: {} of {} apps have a newer release", me.available(), me.pins.len());
                (me.repaint)();
            })
            .map_err(|e| log::warn!("update check: {e}"))
            .ok();
    }

    fn check_one(&self, pin: &Pin) -> Check {
        let mut out = String::new();
        let cmd = Cmd { program: "git".into(), args: vec!["ls-remote".into(), "--tags".into(), pin.url.clone()], cwd: self.root.clone() };
        if let Err(e) = (self.exec)(&cmd, &mut |l| {
            out.push_str(l);
            out.push('\n');
        }) {
            return Check::Failed(if e.starts_with("couldn't run") { "git isn't installed".into() } else { e });
        }
        match newest_release(&out) {
            Some((version, commit)) if is_newer(version, &pin.version) && commit != pin.commit => Check::Available { version, commit },
            Some(_) => Check::UpToDate,
            None => Check::Failed("no releases found".into()),
        }
    }

    /// Updates need the source folder this program was built from, and Rust to build it.
    fn find_blocker(&self) -> Option<String> {
        if !self.root.join("upstream.lock").is_file() || !self.root.join("Cargo.toml").is_file() {
            return Some(format!("Updates are built from the Combine Apps source folder, which isn't at {}.", self.root.display()));
        }
        let cargo = Cmd { program: "cargo".into(), args: vec!["--version".into()], cwd: self.root.clone() };
        if (self.exec)(&cargo, &mut |_| {}).is_err() {
            return Some("Updating needs Rust (cargo), which isn't installed.".into());
        }
        None
    }

    /// Rebuilds the window with the newest release of each app in `names`, in the background.
    pub fn update(self: &Arc<Self>, names: &[&str]) {
        let targets: Vec<Target> = {
            let s = self.lock();
            if matches!(s.job, Job::Running { .. }) || s.blocked.is_some() {
                return;
            }
            names
                .iter()
                .filter_map(|n| match s.checks.get(*n) {
                    Some(Check::Available { version, commit }) => Some(Target { name: (*n).into(), version: *version, commit: commit.clone() }),
                    _ => None,
                })
                .collect()
        };
        if targets.is_empty() {
            return;
        }
        self.lock().job = Job::Running { targets: targets.clone(), step: Step::Fetch, detail: String::new(), started: Instant::now(), tail: VecDeque::new() };
        (self.repaint)();
        let me = self.clone();
        let spawned = std::thread::Builder::new().name("update".into()).spawn(move || {
            let result = me.run(&targets);
            me.lock().job = match result {
                Ok(()) => Job::Installed { targets },
                Err(message) => {
                    log::error!("update failed: {message}");
                    let tail = match &me.lock().job {
                        Job::Running { tail, .. } => tail.clone(),
                        _ => VecDeque::new(),
                    };
                    Job::Failed { targets, message, tail }
                }
            };
            (me.repaint)();
        });
        if let Err(e) = spawned {
            self.lock().job = Job::Idle;
            log::error!("update: {e}");
        }
    }

    fn set_step(&self, step: Step) {
        if let Job::Running { step: s, detail, .. } = &mut self.lock().job {
            *s = step;
            detail.clear();
        }
        log::info!("update: {}", step.label());
        (self.repaint)();
    }

    /// Runs `cmd`, keeping its last lines and its latest "Compiling …" line for the Home page.
    fn run_cmd(&self, cmd: &Cmd) -> Result<(), String> {
        (self.exec)(cmd, &mut |line| {
            let mut s = self.lock();
            if let Job::Running { tail, detail, .. } = &mut s.job {
                let line = line.trim_end();
                if let Some(c) = line.trim_start().strip_prefix("Compiling ") {
                    *detail = format!("Compiling {}", c.split(" (").next().unwrap_or(c));
                }
                tail.push_back(line.to_owned());
                while tail.len() > TAIL {
                    tail.pop_front();
                }
            }
            drop(s);
            (self.repaint)();
        })
    }

    fn fetch(&self, names: &[&str]) -> Result<(), String> {
        if !cfg!(windows) {
            let mut args = vec!["scripts/fetch-upstream.sh".to_owned()];
            args.extend(names.iter().map(|n| (*n).to_owned()));
            return self.run_cmd(&Cmd { program: "sh".into(), args, cwd: self.root.clone() });
        }
        let mut args: Vec<String> = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\\fetch-upstream.ps1", "-Only"].map(Into::into).into();
        args.push(names.join(","));
        // PowerShell 7 where it's installed: Windows PowerShell 5.1 turns git's ordinary messages
        // on its error stream into errors that stop the script.
        match self.run_cmd(&Cmd { program: "pwsh".into(), args: args.clone(), cwd: self.root.clone() }) {
            Err(e) if e.starts_with("couldn't run") => self.run_cmd(&Cmd { program: "powershell".into(), args, cwd: self.root.clone() }),
            other => other,
        }
    }

    fn cargo(&self, args: &[&str]) -> Result<(), String> {
        self.run_cmd(&Cmd { program: "cargo".into(), args: args.iter().map(|a| (*a).to_owned()).collect(), cwd: self.root.clone() })
    }

    pub fn exe_name(&self) -> String {
        format!("{}{}", self.package, std::env::consts::EXE_SUFFIX)
    }

    /// Where the updated program goes, and where a restart runs it from.
    pub fn installed_exe(&self) -> PathBuf {
        self.root.join("dist").join(self.exe_name())
    }

    fn run(&self, targets: &[Target]) -> Result<(), String> {
        let _guard = UpdateGuard::take(&self.root, self.package)?;
        let lock_path = self.root.join("upstream.lock");
        let original = std::fs::read_to_string(&lock_path).map_err(|e| format!("couldn't read {}: {e}", lock_path.display()))?;
        let names: Vec<&str> = targets.iter().map(|t| t.name.as_str()).collect();
        let versions: Vec<String> = targets.iter().map(|t| t.version.to_string()).collect();
        let changes: Vec<(&str, &str, &str)> = targets.iter().zip(&versions).map(|(t, v)| (t.name.as_str(), t.commit.as_str(), v.as_str())).collect();
        std::fs::write(&lock_path, rewrite_lock(&original, &changes)?).map_err(|e| format!("couldn't write {}: {e}", lock_path.display()))?;

        let built = (|| {
            self.set_step(Step::Fetch);
            self.fetch(&names).map_err(|e| format!("couldn't download the new source: {e}"))?;
            self.set_step(Step::Build);
            self.cargo(&["build", "--release", "-p", self.package])
                .map_err(|e| format!("the new version doesn't build with this suite yet ({e}); its host crate may need changes for it"))?;
            self.set_step(Step::Install);
            self.install()
        })();
        if built.is_err() {
            // Back to the versions this window runs, sources included.
            let _ = std::fs::write(&lock_path, &original);
            let _ = self.fetch(&names);
        }
        self.set_step(Step::Clean);
        if let Err(e) = self.cargo(&["clean"]) {
            log::warn!("update: couldn't delete the build cache: {e}");
        }
        built
    }

    /// The new program into `dist/`. The running one may be that very file: Windows can't
    /// replace it, but it can rename it, so it moves aside as `<name>.old` until the restart.
    fn install(&self) -> Result<(), String> {
        let built = self.root.join("target").join("release").join(self.exe_name());
        let target = self.installed_exe();
        let dist = self.root.join("dist");
        std::fs::create_dir_all(&dist).map_err(|e| format!("couldn't create {}: {e}", dist.display()))?;
        if target.exists() && std::fs::remove_file(&target).is_err() {
            let old = old_exe(&target);
            let _ = std::fs::remove_file(&old);
            std::fs::rename(&target, &old).map_err(|e| format!("couldn't move the running program aside: {e}"))?;
        }
        std::fs::copy(&built, &target).map(|_| ()).map_err(|e| format!("couldn't copy {} to {}: {e}", built.display(), target.display()))
    }

    /// A program moved aside by an earlier update, deleted once its window has gone.
    pub fn remove_old_exe(&self) {
        let old = old_exe(&self.installed_exe());
        if old.exists() && std::fs::remove_file(&old).is_ok() {
            log::info!("removed {}", old.display());
        }
    }
}

/// The source folder, without Windows' `\\?\` prefix that canonical paths carry (PowerShell
/// won't run in such a folder).
fn source_root() -> PathBuf {
    let root = std::fs::canonicalize(SOURCE_ROOT).unwrap_or_else(|_| PathBuf::from(SOURCE_ROOT));
    match root.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(plain) if !plain.starts_with("UNC") => PathBuf::from(plain),
        _ => root,
    }
}

fn old_exe(exe: &Path) -> PathBuf {
    exe.with_extension(match exe.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("old.{ext}"),
        None => "old".into(),
    })
}

/// One update at a time across both windows, which share the source folder and build cache: a
/// file that says who is updating. A guard left by a crash goes stale after a few hours.
struct UpdateGuard(PathBuf);

impl UpdateGuard {
    fn take(root: &Path, who: &str) -> Result<Self, String> {
        let path = root.join(".update-in-progress");
        if let Ok(meta) = std::fs::metadata(&path) {
            let age = meta.modified().ok().and_then(|m| SystemTime::now().duration_since(m).ok()).unwrap_or_default();
            if age < STALE_GUARD {
                let by = std::fs::read_to_string(&path).unwrap_or_default();
                return Err(format!("another update is running ({})", by.trim()));
            }
            let _ = std::fs::remove_file(&path);
        }
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| format!("couldn't start the update: {e}"))?;
        std::io::Write::write_all(&mut file, who.as_bytes()).map_err(|e| e.to_string())?;
        Ok(Self(path))
    }
}

impl Drop for UpdateGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCK: &str = "# header\n#\n# name           commit                                    version   repository\n\
photocraft       649b1d5d92c08bf846631a868adc8a5c6ec6e888  v0.7.0+   https://github.com/storytold/photocraft\n\
gridcraft        3926d21aa9a79d272b9f71ae60d67d7d7e5bd2c2  v0.8.0    https://github.com/storytold/gridcraft\n\
craft-fonts      3d9ab3a132ed0eff457e424226a435a901da30d3  -         https://github.com/storytold/craft-fonts\n";

    #[test]
    fn the_lock_reads_and_rewrites_one_line_at_a_time() {
        let pins = parse_lock(LOCK);
        assert_eq!(pins.len(), 3);
        assert_eq!(pins[0].version, "v0.7.0+");
        let new = rewrite_lock(LOCK, &[("photocraft", "aaaa", "v0.10.0")]).unwrap();
        assert!(new.contains("photocraft       aaaa  v0.10.0   https://github.com/storytold/photocraft\n"), "{new}");
        assert_eq!(
            new.lines().filter(|l| l.starts_with("gridcraft")).collect::<Vec<_>>(),
            LOCK.lines().filter(|l| l.starts_with("gridcraft")).collect::<Vec<_>>()
        );
        assert!(new.starts_with("# header\n"));
        assert!(rewrite_lock(LOCK, &[("nope", "a", "v1.0.0")]).is_err());
        // The built lock parses, and only apps carry versions.
        assert!(parse_lock(BUILT_LOCK).iter().any(|p| p.name == "photocraft" && p.version.starts_with('v')));
        assert!(parse_lock(BUILT_LOCK).iter().any(|p| p.name == "craft-fonts" && p.version == "-"));
    }

    #[test]
    fn versions_compare_and_snapshots_count_as_past_their_release() {
        let v = |s| Version::parse(s).unwrap();
        assert!(v("v0.10.0") > v("v0.9.1"));
        assert_eq!(Version::parse("v1.2.3-rc.1"), None);
        assert_eq!(Version::parse("craft-v1"), None);
        assert!(is_newer(v("v0.10.0"), "v0.7.0+"));
        assert!(!is_newer(v("v0.7.0"), "v0.7.0+"));
        assert!(!is_newer(v("v0.7.0"), "v0.7.0"));
        assert!(is_newer(v("v0.7.1"), "v0.7.0"));
        assert!(!is_newer(v("v9.0.0"), "-"));
    }

    #[test]
    fn the_newest_release_comes_from_ls_remote_with_annotated_tags_peeled() {
        let out = "aaa\trefs/tags/v0.9.0\n111\trefs/tags/v0.10.0\n222\trefs/tags/v0.10.0^{}\nbbb\trefs/tags/v0.11.0-rc.1\nccc\trefs/tags/nightly\n";
        assert_eq!(newest_release(out), Some((Version(0, 10, 0), "222".into())));
        assert_eq!(newest_release("ddd\trefs/tags/v1.0.0\n"), Some((Version(1, 0, 0), "ddd".into())));
        assert_eq!(newest_release(""), None);
    }

    /// A source folder in the temp dir, and an exec that answers like git, cargo and the fetch
    /// script would, recording what ran; `fail` makes a command containing it fail.
    fn sandbox(name: &str, fail: Option<&'static str>) -> (Arc<Updates>, PathBuf, Arc<Mutex<Vec<String>>>) {
        let root = std::env::temp_dir().join(format!("craft-suite-update-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("target/release")).unwrap();
        std::fs::write(root.join("upstream.lock"), LOCK).unwrap();
        std::fs::write(root.join("Cargo.toml"), "").unwrap();
        let ran = Arc::new(Mutex::new(Vec::new()));
        let log = ran.clone();
        let built = root.join("target/release").join(format!("craft-test{}", std::env::consts::EXE_SUFFIX));
        let exec: Box<Exec> = Box::new(move |cmd: &Cmd, on_line: &mut dyn FnMut(&str)| {
            let line = format!("{} {}", cmd.program, cmd.args.join(" "));
            log.lock().unwrap().push(line.clone());
            if fail.is_some_and(|f| line.contains(f)) {
                return Err(format!("{line} failed"));
            }
            if cmd.args.first().map(String::as_str) == Some("ls-remote") {
                if line.contains("gridcraft") {
                    // Already on its newest release.
                    on_line("3926d21aa9a79d272b9f71ae60d67d7d7e5bd2c2\trefs/tags/v0.8.0");
                } else {
                    on_line("111\trefs/tags/v0.10.0");
                    on_line("222\trefs/tags/v0.10.0^{}");
                }
            }
            if line.starts_with("cargo build") {
                on_line("   Compiling photocraft-engine v0.10.0 (C:\\x)");
                std::fs::write(&built, b"new program").unwrap();
            }
            Ok(())
        });
        let u = Updates::with("craft-test", &["photocraft", "gridcraft"], LOCK, root.clone(), exec, Box::new(|| {}));
        (u, root, ran)
    }

    fn wait(u: &Updates) {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(10) {
            let checking = u.lock().checks.values().any(|c| *c == Check::Checking) || u.checked_at().is_none();
            if !checking && !u.busy() {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("timed out");
    }

    #[test]
    fn a_check_finds_the_apps_with_a_newer_release() {
        let (u, root, _) = sandbox("check", None);
        u.check();
        wait(&u);
        assert_eq!(u.check_of("photocraft"), Some(Check::Available { version: Version(0, 10, 0), commit: "222".into() }));
        assert_eq!(u.check_of("gridcraft"), Some(Check::UpToDate));
        assert_eq!(u.available(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn an_update_pins_builds_installs_and_cleans_up() {
        let (u, root, ran) = sandbox("ok", None);
        std::fs::create_dir_all(root.join("dist")).unwrap();
        std::fs::write(u.installed_exe(), b"old program").unwrap();
        u.check();
        wait(&u);
        u.update(&["photocraft"]);
        wait(&u);
        assert!(matches!(u.job(), Job::Installed { .. }), "{:?}", u.job());
        let lock = std::fs::read_to_string(root.join("upstream.lock")).unwrap();
        assert!(lock.contains("photocraft       222  v0.10.0"), "{lock}");
        assert_eq!(std::fs::read(u.installed_exe()).unwrap(), b"new program");
        let ran = ran.lock().unwrap().clone();
        let steps: Vec<_> = ran.iter().filter(|l| !l.contains("ls-remote") && !l.contains("--version")).collect();
        assert!(steps[0].contains("fetch-upstream") && steps[0].contains("photocraft"), "{steps:?}");
        assert_eq!(steps[1], "cargo build --release -p craft-test");
        assert_eq!(steps[2], "cargo clean");
        assert!(!root.join(".update-in-progress").exists(), "the guard is released");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_failed_build_puts_everything_back() {
        let (u, root, ran) = sandbox("fail", Some("cargo build"));
        u.check();
        wait(&u);
        u.update(&["photocraft"]);
        wait(&u);
        match u.job() {
            Job::Failed { message, .. } => assert!(message.contains("doesn't build"), "{message}"),
            other => panic!("{other:?}"),
        }
        assert_eq!(std::fs::read_to_string(root.join("upstream.lock")).unwrap(), LOCK, "the old pin is back");
        let ran = ran.lock().unwrap().clone();
        let fetches = ran.iter().filter(|l| l.contains("fetch-upstream")).count();
        assert_eq!(fetches, 2, "the new source, then the old one again: {ran:?}");
        assert_eq!(ran.last().map(String::as_str), Some("cargo clean"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn one_update_at_a_time_across_windows() {
        let root = std::env::temp_dir().join(format!("craft-suite-guard-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let first = UpdateGuard::take(&root, "ArtCraft Studio").unwrap();
        let second = UpdateGuard::take(&root, "ArtCraft Docs").err().unwrap();
        assert!(second.contains("ArtCraft Studio"), "{second}");
        drop(first);
        assert!(UpdateGuard::take(&root, "ArtCraft Docs").is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_source_folder_is_this_checkout_in_plain_form() {
        let root = source_root();
        assert!(root.join("upstream.lock").is_file() && root.join("crates").join("craft-suite").is_dir(), "{}", root.display());
        assert!(!root.to_string_lossy().starts_with(r"\\?\"));
    }

    #[test]
    fn the_running_program_moves_aside_as_old() {
        assert_eq!(old_exe(Path::new("dist/craft-studio.exe")), PathBuf::from("dist/craft-studio.old.exe"));
        assert_eq!(old_exe(Path::new("dist/craft-studio")), PathBuf::from("dist/craft-studio.old"));
    }
}
