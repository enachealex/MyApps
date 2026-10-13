//! PhotoCraft's platform services: file dialogs (rfd), files, codecs, the clipboard, preferences
//! and crash recovery.
//!
//! Adapted from PhotoCraft's `apps/photocraft/src/services.rs` (MIT OR Apache-2.0,
//! https://github.com/storytold/photocraft). Unlike there, [`native`] is given the settings
//! folder rather than always using PhotoCraft's own, so that a `--no-settings` run has no
//! preferences, crash recovery or Photoshop shortcut import at all (upstream's version opens the
//! recovery folder, sweeping old files, as soon as the services are built). The automation
//! services for the `--control` server are left out with the server, and the Xwayland hint for
//! file drops names the running program instead of `photocraft`.

use photocraft_codecs::{ChannelLayout, EncodeOptions, Image};
use photocraft_doc::Document;
use photocraft_format::RecoveryStore;
use photocraft_ui_egui::{FileDialogAnswer, FileDialogReply, FileDialogRequest, Recoverable, Services};
use std::cell::RefCell;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::rc::Rc;
use std::sync::Arc;

/// Everything File › Open reads: PhotoCraft, Photoshop, OpenRaster and Affinity documents, flat images, and
/// Photoshop brushes (.abr), gradients (.grd), swatches (.aco, .ase) and keyboard shortcut sets
/// (.kys), which go to the preset libraries and Edit › Keyboard Shortcuts.
const OPEN_EXTS: &[&str] = &[
    "pcraft", "pdn", "ora", "psd", "psb", "psdt", "png", "jpg", "jpeg", "tif", "tiff", "webp", "gif", "bmp", "tga", "ico", "qoi", "exr", "hdr", "pbm", "pgm",
    "ppm", "pam", "pfm", "fits", "fit", "fts", "heic", "heif", "hif", "dng", "cr2", "cr3", "nef", "nrw", "arw", "pef", "orf", "rw2", "raf", "abr", "grd",
    "svg", "svgz", "aco", "ase", "kys", "af", "afdesign", "afphoto", "afpub",
];
const SVG_EXTS: &[&str] = &["svg", "svgz"];

/// Open dialog extensions that also match uppercase and mixed-case names (`IMG_0001.JPG`).
/// On Linux and the BSDs rfd turns each extension into a case-sensitive `*.ext` glob for the XDG
/// portal or zenity, so every letter becomes a character class, as the portal spec suggests
/// (`*.[iI][cC][oO]`). Windows and macOS take literal extensions and ignore case already.
fn open_filter_extensions(extensions: &[&str]) -> Vec<String> {
    let case_sensitive_globs = cfg!(all(unix, not(target_os = "macos")));
    let class = |c: char| if c.is_ascii_alphabetic() { format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase()) } else { c.to_string() };
    extensions.iter().map(|ext| if case_sensitive_globs { ext.chars().map(class).collect() } else { ext.to_string() }).collect()
}

/// An explicit SVG filter keeps vector artwork discoverable even when a native picker defaults to
/// the PhotoCraft-only filter. SVG is also included in All Formats for normal multi-format opens.
fn open_filters() -> Vec<(&'static str, Vec<String>)> {
    vec![
        ("All Formats", open_filter_extensions(OPEN_EXTS)),
        ("PhotoCraft", open_filter_extensions(&["pcraft"])),
        ("OpenRaster", open_filter_extensions(&["ora"])),
        ("SVG", open_filter_extensions(SVG_EXTS)),
    ]
}

/// File › Save As formats: (filter name, extensions). The filter matching the suggested name's
/// extension comes first, so a .pcraft document saves as .pcraft by default and everything else
/// keeps defaulting to PSD.
const SAVE_FILTERS: &[(&str, &[&str])] = &[
    ("PSD Document", &["psd", "psb"]),
    ("PhotoCraft", &["pcraft"]),
    ("OpenRaster", &["ora"]),
    ("PNG", &["png"]),
    ("JPEG", &["jpg"]),
    ("WebP", &["webp"]),
    ("TIFF", &["tif"]),
    ("Targa", &["tga"]),
    ("OpenEXR", &["exr"]),
    ("FITS", &["fits", "fit"]),
];

/// Non-document files the shell saves (Swatches panel exports): offered alone, so the dialog
/// never swaps their extension for a document format's.
const OTHER_SAVE_FILTERS: &[(&str, &[&str])] = &[("Color Swatches", &["aco"]), ("Swatch Exchange", &["ase"])];

/// Lists the save dialog's file types with the `suggested` type first (added if unlisted), so the dialog keeps that extension instead of .psd.
fn save_filters(suggested: &str) -> Vec<(String, Vec<String>)> {
    let ext = Path::new(suggested).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if let Some((name, exts)) = OTHER_SAVE_FILTERS.iter().find(|(_, exts)| exts.contains(&ext.as_str())) {
        return vec![(name.to_string(), exts.iter().map(|e| e.to_string()).collect())];
    }
    let mut v: Vec<(String, Vec<String>)> = SAVE_FILTERS.iter().map(|(name, exts)| (name.to_string(), exts.iter().map(|e| e.to_string()).collect())).collect();
    match v.iter().position(|(_, exts)| exts.contains(&ext)) {
        Some(i) => {
            let f = v.remove(i);
            v.insert(0, f);
        }
        None if !ext.is_empty() => v.insert(0, (ext.to_ascii_uppercase(), vec![ext])),
        None => {}
    }
    v
}

/// Shows an Open or Save dialog without blocking the event loop (#673, #574): rfd's async dialog
/// is created here, on the main thread, with the window as its parent (a sheet on macOS, an owned
/// modal window elsewhere), and a helper thread waits for it and hands the answer to the app.
fn show_file_dialog(request: FileDialogRequest, parent: Option<&eframe::Frame>, reply: FileDialogReply) {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(parent) = parent {
        dialog = dialog.set_parent(parent);
    }
    let answer: Pin<Box<dyn Future<Output = Option<FileDialogAnswer>> + Send>> = match request {
        FileDialogRequest::Open { multiple, initial_dir, extensions } => {
            if let Some(dir) = initial_dir {
                dialog = dialog.set_directory(dir);
            }
            // A command-specific filter must not inherit the image formats used by File › Open.
            let dialog = if let Some(exts) = extensions {
                dialog.add_filter("Supported Files", &open_filter_extensions(&exts.iter().map(String::as_str).collect::<Vec<_>>()))
            } else {
                open_filters()
                    .into_iter()
                    .fold(dialog, |dialog, (name, extensions)| dialog.add_filter(name, &extensions))
                    .add_filter("Paint.NET", &open_filter_extensions(&["pdn"]))
            };
            if multiple {
                let picked = dialog.pick_files();
                Box::pin(async move { picked.await.map(|files| FileDialogAnswer::Paths(files.iter().map(path_of).collect())) })
            } else {
                let picked = dialog.pick_file();
                Box::pin(async move { picked.await.map(|file| FileDialogAnswer::Paths(vec![path_of(&file)])) })
            }
        }
        FileDialogRequest::Save { suggested } => {
            for (name, exts) in save_filters(&suggested) {
                dialog = dialog.add_filter(name, &exts);
            }
            if let Some(name) = Path::new(&suggested).file_name() {
                dialog = dialog.set_file_name(name.to_string_lossy());
            }
            if let Some(dir) = Path::new(&suggested).parent().filter(|p| !p.as_os_str().is_empty()) {
                dialog = dialog.set_directory(dir);
            }
            let picked = dialog.save_file();
            Box::pin(async move { picked.await.map(|file| FileDialogAnswer::SaveTo(path_of(&file))) })
        }
    };
    // Without the thread the reply is dropped unanswered, which the app takes as Cancel.
    if let Err(e) = std::thread::Builder::new().name("file dialog".into()).spawn(move || {
        // An empty answer from a system with no dialog backend isn't a Cancel (#3354).
        let answer = block_on(answer).or_else(|| crate::file_dialog_probe::known_problem().map(FileDialogAnswer::Unavailable));
        reply.send(answer)
    }) {
        log::error!("couldn't wait for the file dialog: {e}");
    }
}

fn path_of(file: &rfd::FileHandle) -> String {
    file.path().to_string_lossy().into_owned()
}

/// Runs `future` to completion on this thread, sleeping until it is woken.
fn block_on<T>(future: impl Future<Output = T>) -> T {
    struct Unpark(std::thread::Thread);
    impl std::task::Wake for Unpark {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = std::task::Waker::from(Arc::new(Unpark(std::thread::current())));
    let mut cx = std::task::Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let std::task::Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
        // Spurious wake-ups just poll again.
        std::thread::park();
    }
}

/// Per-user settings directory: `PHOTOCRAFT_CONFIG_DIR`, else `<exe dir>/PhotoCraftData` in
/// portable mode, else the platform convention. Everything the app persists lives under it; see
/// [`crate::app_dirs`].
pub fn config_dir() -> Option<PathBuf> {
    crate::app_dirs::config_dir()
}

/// The brush preset store in the settings folder `config` (one file per preset group plus tip
/// bitmaps; see `photocraft_engine::preset_store`).
pub fn presets_dir(config: &Path) -> PathBuf {
    config.join("Presets")
}

/// Write `bytes` crash-safely (temp file beside the target, fsync, rename, directory fsync; see
/// [`photocraft_format::atomic`]). Every document write (Save, Save As, Export, Save for Web) and
/// the preferences go through here, so a failed or interrupted save never destroys the old file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    photocraft_format::atomic_write(path, bytes).map_err(|e| e.to_string())
}

/// [`write_atomic`] reporting the fraction written (a background save's progress, #3389).
fn write_atomic_progress(path: &Path, bytes: &[u8], progress: &dyn Fn(f32)) -> Result<(), String> {
    photocraft_format::atomic_write_progress(path, bytes, progress).map_err(|e| e.to_string())
}

fn export_options(settings: &photocraft_ui_egui::ExportSettings) -> photocraft_io::ExportOptions {
    let mut opts = photocraft_io::ExportOptions::default();
    if let Some(q) = settings.jpeg_quality {
        opts.encode.jpeg_quality = q;
    }
    opts.encode.webp_lossless = settings.webp_lossless;
    if let Some(q) = settings.webp_quality {
        opts.encode.webp_quality = q;
    }
    opts.tiff_layers = settings.tiff_layers;
    opts.xmp = if settings.xmp_all { photocraft_io::XmpEmbed::All } else { photocraft_io::XmpEmbed::None };
    opts.tga_bits = settings.tga_bits;
    opts.image_previews = settings.image_previews;
    opts
}

/// The share of a save's progress bar that encoding fills; writing the file fills the rest. A
/// 24 MP, 5-layer PSD (572 MB) takes about 3 s to encode and 0.5 s or more to write and flush.
const ENCODE_SHARE: f32 = 0.85;

/// A save on a worker thread (`Services::save_file`, #2017): encode, then write through `write`.
/// Cancelling while encoding leaves the target untouched; once writing starts the save can't be
/// cancelled. The encoder's progress fills the first [`ENCODE_SHARE`] of the job's progress, so
/// the status bar and tab read "Saving NN%" (#3389).
fn save_through(
    doc: &Document,
    path: &str,
    settings: &photocraft_ui_egui::ExportSettings,
    ctl: &photocraft_ui_egui::jobs_ui::SaveCtl,
    write: impl Fn(&str, &[u8], &dyn Fn(f32)) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    ctl.progress(0.0, "Encoding");
    let opts = export_options(settings);
    let cancelled = || ctl.check().is_err();
    let progress = |f: f32| ctl.progress(f * ENCODE_SHARE, "");
    let interrupt = photocraft_raster::Interrupt::new(&cancelled, &progress);
    let r = crate::crash_guard::guard("Save", || photocraft_io::export_with(doc, path, &opts, &interrupt).map_err(|e| e.to_string()))?;
    ctl.commit()?;
    ctl.progress(ENCODE_SHARE, "Writing");
    // The last bit is the flush and rename after the last chunk: 100% only once they're done.
    write(path, &r.bytes, &|f| ctl.progress(ENCODE_SHARE + (0.99 - ENCODE_SHARE) * f, ""))?;
    ctl.progress(1.0, "");
    Ok(r.warnings)
}

fn save_file(
    doc: &Document,
    path: &str,
    settings: &photocraft_ui_egui::ExportSettings,
    ctl: &photocraft_ui_egui::jobs_ui::SaveCtl,
) -> Result<Vec<String>, String> {
    save_through(doc, path, settings, ctl, |p, b, progress| write_atomic_progress(Path::new(p), b, progress))
}

type SharedRecovery = Rc<RefCell<Option<RecoveryStore>>>;

/// Run `f` on the recovery store (`Err` without a config directory). The service closures never
/// call each other, so the store is never borrowed twice.
fn with_store<R>(store: &SharedRecovery, f: impl FnOnce(&mut RecoveryStore) -> R) -> Result<R, String> {
    let mut slot = store.try_borrow_mut().map_err(|_| "crash recovery is busy".to_string())?;
    Ok(f(slot.as_mut().ok_or("no config directory")?))
}

/// Crash recovery: background incremental .pcraft autosaves into `dir`. Recovered documents keep
/// their entries until a newer autosave replaces them or they're saved or closed (see
/// [`RecoveryStore`]).
fn recovery_services(dir: PathBuf) -> Services {
    let recover_dir = dir.clone();
    let store: SharedRecovery = Rc::new(RefCell::new(Some(RecoveryStore::new(dir))));
    let (s1, s2, s4) = (store.clone(), store.clone(), store.clone());
    Services {
        autosave: Some(Box::new(move |doc: &Arc<Document>, revision: u64, path: Option<&str>| {
            with_store(&s1, |s| s.autosave_checked(doc, revision, path.map(str::to_string)))?
        })),
        autosave_results: Some(Box::new(move || with_store(&s4, |s| s.take_completed()).unwrap_or_default())),
        discard_autosave: Some(Box::new(move |id: u64| {
            let _ = with_store(&s2, |s| s.discard(id));
        })),
        recover: Some(Box::new(move || {
            photocraft_format::list_recovery(&recover_dir)
                .into_iter()
                .map(|e| Recoverable {
                    key: e.info.key.clone(),
                    name: e.info.document_name.clone(),
                    path: e.info.original_path.clone(),
                    load: Box::new(move || photocraft_format::recover(&e).map_err(|e| e.to_string())),
                })
                .collect()
        })),
        adopt_autosave: Some(Box::new(move |id: u64, key: &str| {
            let _ = with_store(&store, |s| s.adopt(id, key));
        })),
        ..Default::default()
    }
}

/// The pixels to paste when the clipboard holds copied files rather than an image (Copy in
/// Files, Finder or Explorer puts paths on the clipboard, #338): the first file that decodes,
/// upright, as RGBA8. Files that aren't images are skipped after reading only their header.
fn image_from_files(paths: &[PathBuf]) -> Option<(u32, u32, Vec<u8>)> {
    use std::io::Read;
    paths.iter().find_map(|path| {
        // text/uri-list lines end in CRLF (RFC 2483, and GTK writes them so), but arboard splits
        // on LF only, so a path copied in GNOME Files arrives with a trailing '\r'.
        let path = path.to_str().map_or_else(|| path.clone(), |s| PathBuf::from(s.trim_end_matches('\r')));
        let mut head = Vec::with_capacity(256);
        std::fs::File::open(&path).ok()?.take(256).read_to_end(&mut head).ok()?;
        // TGA has no magic number and is only guessed from the header, so trust the extension
        // too before reading what may be a large non-image file.
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        match photocraft_codecs::detect(&head)? {
            photocraft_codecs::Format::Tga if photocraft_codecs::from_extension(ext) != Some(photocraft_codecs::Format::Tga) => return None,
            _ => {}
        }
        let img = photocraft_codecs::decode(&std::fs::read(&path).ok()?).ok()?;
        Some((img.width(), img.height(), img.to_rgba8()))
    })
}

/// The shell command that starts this program under XWayland, where winit delivers file drops
/// (winit 0.30 has none on Wayland, #386). A Flatpak gets the X11 socket only without the Wayland
/// one, an AppImage relaunches by its own path, and anything else by `exe`, the running program.
/// `None` outside Flatpak when there is no X server (`DISPLAY` unset) to run on, or no program.
#[cfg(any(target_os = "linux", test))]
pub fn xwayland_command(flatpak_id: Option<&str>, appimage: Option<&str>, exe: Option<&str>, x_display: bool) -> Option<String> {
    if let Some(id) = flatpak_id.filter(|id| !id.is_empty()) {
        return Some(format!("flatpak run --nosocket=wayland --socket=x11 {}", shell_word(id)));
    }
    let exe = appimage.filter(|path| !path.is_empty()).or(exe.filter(|path| !path.is_empty())).map(shell_word)?;
    x_display.then(|| format!("WAYLAND_DISPLAY= {exe}"))
}

/// `s` as one POSIX shell word: bare when every character is safe there, else single-quoted.
#[cfg(any(target_os = "linux", test))]
fn shell_word(s: &str) -> String {
    if s.bytes().all(|b| b.is_ascii_alphanumeric() || b"/._-+:,@".contains(&b)) { s.to_string() } else { format!("'{}'", s.replace('\'', r"'\''")) }
}

/// The desktop services. `config` is PhotoCraft's settings folder, which holds the preferences
/// and the crash-recovery autosaves; `None` keeps nothing (`--no-settings`): no preferences are
/// read or written, nothing is autosaved or recovered, and Photoshop's shortcuts are not offered.
pub fn native(config: Option<&Path>) -> Services {
    let clip: Rc<RefCell<Option<arboard::Clipboard>>> = Rc::default();
    let prefs_file = config.map(|d| d.join("preferences.json"));
    let save_to = prefs_file.clone();
    let recovery = config.map(|d| recovery_services(d.join("Recovery"))).unwrap_or_default();
    Services {
        import: Some(Box::new(|name: &str, bytes: &[u8], max_svg_group_depth: usize| {
            crate::crash_guard::guard("Open", || {
                photocraft_io::import_with_svg_group_depth(name, bytes, max_svg_group_depth).map(|r| (r.document, r.warnings)).map_err(|e| e.to_string())
            })
        })),
        export: Some(Box::new(|doc: &Document, path: &str, settings: &photocraft_ui_egui::ExportSettings| {
            let opts = export_options(settings);
            crate::crash_guard::guard("Export", || photocraft_io::export(doc, path, &opts).map(|r| (r.bytes, r.warnings)).map_err(|e| e.to_string()))
        })),
        save_file: Some(Arc::new(save_file)),
        file_dialog: Some(Box::new(show_file_dialog)),
        write: Some(Box::new(|path: &str, bytes: &[u8]| write_atomic(Path::new(path), bytes))),
        encode_png: Some(Box::new(|w, h, rgba| {
            let img = Image::from_u8(w, h, ChannelLayout::Rgba, rgba.to_vec()).map_err(|e| e.to_string())?;
            photocraft_codecs::encode(&img, photocraft_codecs::Format::Png, &EncodeOptions::default()).map_err(|e| e.to_string())
        })),
        inbox: None,
        open_url: Some(Box::new(|url: &str| open::that(url).map_err(|e| e.to_string()))),
        beep: Some(platform_beep),
        clipboard_set_image: Some({
            let clip = clip.clone();
            Box::new(move |w: u32, h: u32, px: &[u8]| {
                let mut slot = clip.try_borrow_mut().map_err(|_| "clipboard is busy".to_string())?;
                let cb = match slot.as_mut() {
                    Some(c) => c,
                    None => slot.insert(arboard::Clipboard::new().map_err(|e| e.to_string())?),
                };
                cb.set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: std::borrow::Cow::Borrowed(px) }).map_err(|e| e.to_string())
            })
        }),
        clipboard_get_image: Some({
            let clip = clip.clone();
            Box::new(move || {
                let mut slot = clip.try_borrow_mut().ok()?;
                let cb = match slot.as_mut() {
                    Some(c) => c,
                    None => slot.insert(arboard::Clipboard::new().ok()?),
                };
                // Copied files first: Finder also puts the file's icon on the clipboard as an
                // image, which would otherwise paste instead of the file.
                if let Some(img) = cb.get().file_list().ok().and_then(|paths| image_from_files(&paths)) {
                    return Some(img);
                }
                let img = cb.get_image().ok()?;
                Some((img.width as u32, img.height as u32, img.bytes.into_owned()))
            })
        }),
        load_prefs: prefs_file.map(|file| Box::new(move || std::fs::read_to_string(&file).ok()) as photocraft_ui_egui::LoadTextFn),
        photoshop_shortcuts: config
            .map(|_| Box::new(|| crate::photoshop_settings::live_keyboard_shortcuts(&|k| std::env::var_os(k))) as photocraft_ui_egui::PhotoshopShortcutsFn),
        save_prefs: save_to.map(|file| Box::new(move |text: &str| write_atomic(&file, text.as_bytes())) as photocraft_ui_egui::SaveTextFn),
        system_theme: crate::appearance::service(),
        append_text: Some(Box::new(|path: &str, text: &str| {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
            f.write_all(text.as_bytes()).map_err(|e| e.to_string())
        })),
        // Set by the host from the window it runs in.
        is_wayland: false,
        ..recovery
    }
}

/// Preferences ▸ General ▸ Beep When Done: the platform's default information beep.
fn platform_beep() {
    #[cfg(target_os = "windows")]
    {
        let _ = winsafe::MessageBeep(winsafe::co::MBP::OK);
    }
    #[cfg(not(target_os = "windows"))]
    {
        // No beep API among this app's other platforms' dependencies: write the terminal bell
        // (audible when launched from a terminal, which is the same cue macOS terminals use).
        use std::io::Write as _;
        let _ = std::io::stdout().write_all(b"\x07").and_then(|()| std::io::stdout().flush());
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn without_a_settings_folder_nothing_is_kept() {
        let s = native(None);
        assert!(s.load_prefs.is_none() && s.save_prefs.is_none(), "no preferences");
        assert!(s.autosave.is_none() && s.recover.is_none() && s.discard_autosave.is_none() && s.adopt_autosave.is_none(), "no crash recovery");
        assert!(s.photoshop_shortcuts.is_none(), "Photoshop's settings are not read");
        assert!(s.import.is_some() && s.save_file.is_some() && s.file_dialog.is_some(), "files still open and save");
    }

    #[test]
    fn preferences_live_in_the_settings_folder() {
        let dir = std::env::temp_dir().join(format!("host-photocraft-prefs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut s = native(Some(&dir));
        s.save_prefs.as_mut().unwrap()("{\"general\":{}}").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("preferences.json")).unwrap(), "{\"general\":{}}");
        assert_eq!(s.load_prefs.as_mut().unwrap()().as_deref(), Some("{\"general\":{}}"));
        assert!(s.autosave.is_some() && s.recover.is_some());
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_dialogs_lead_with_the_suggested_type() {
        assert_eq!(save_filters("cat.pcraft")[0].0, "PhotoCraft");
        assert_eq!(save_filters("cat.webp")[0].0, "WebP");
        assert_eq!(save_filters("swatches.ase"), vec![("Swatch Exchange".to_string(), vec!["ase".to_string()])]);
        assert_eq!(save_filters("cat.gif")[0], ("GIF".to_string(), vec!["gif".to_string()]));
        assert_eq!(save_filters("Untitled")[0].0, "PSD Document");
    }

    #[test]
    fn xwayland_command_matches_how_the_suite_was_installed() {
        let flatpak = xwayland_command(Some("ai.storyteller.artcraft"), None, Some("/app/bin/craft-studio"), false);
        assert_eq!(flatpak.as_deref(), Some("flatpak run --nosocket=wayland --socket=x11 ai.storyteller.artcraft"));
        let appimage = xwayland_command(None, Some("/home/me/My Apps/it's.AppImage"), Some("/tmp/.mount/craft-studio"), true);
        assert_eq!(appimage.as_deref(), Some(r"WAYLAND_DISPLAY= '/home/me/My Apps/it'\''s.AppImage'"));
        assert_eq!(xwayland_command(None, None, Some("/usr/bin/craft-studio"), true).as_deref(), Some("WAYLAND_DISPLAY= /usr/bin/craft-studio"));
        assert_eq!(xwayland_command(None, None, Some("/usr/bin/craft-studio"), false), None, "no X server");
        assert_eq!(xwayland_command(Some(""), Some(""), None, true), None, "nothing to run");
    }
}
