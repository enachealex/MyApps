//! Each app's own eframe storage, so two apps that save under the same key (most save their state
//! under `eframe::APP_KEY`) never overwrite each other. Same format as eframe's: a RON map of
//! strings, one file per app.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub struct Store {
    path: Option<PathBuf>,
    values: BTreeMap<String, String>,
    dirty: bool,
}

/// A store's values in `path`; `Err` names what went wrong.
fn read(path: &Path) -> Result<BTreeMap<String, String>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    ron::from_str(&text).map_err(|e| e.to_string())
}

impl Store {
    /// The store at `path` (`None`: kept in memory only). A missing or unreadable file starts
    /// empty; an unreadable one is kept aside as `<name>.unreadable`, so nothing is lost.
    pub fn open(path: Option<PathBuf>) -> Self {
        let values = path
            .as_ref()
            .filter(|p| p.exists())
            .and_then(|p| match read(p) {
                Ok(values) => Some(values),
                Err(e) => {
                    log::warn!("{}: {e}; starting with empty settings", p.display());
                    let _ = std::fs::rename(p, p.with_extension("unreadable"));
                    None
                }
            })
            .unwrap_or_default();
        Self { path, values, dirty: false }
    }

    /// Kept in a file that doesn't exist yet: the app has never run in the suite.
    pub fn is_new(&self) -> bool {
        self.path.as_ref().is_some_and(|p| !p.exists())
    }

    /// Start from the values of another store file of the same format (eframe's own), such as the
    /// standalone app's; they are saved here with the next flush. The file is only read.
    pub fn seed_from(&mut self, file: &Path) {
        if !file.exists() {
            return;
        }
        match read(file) {
            Ok(values) => {
                log::info!("starting from the settings in {}", file.display());
                self.values = values;
                self.dirty = true;
            }
            Err(e) => log::warn!("{}: {e}; not used", file.display()),
        }
    }
}

impl eframe::Storage for Store {
    fn get_string(&self, key: &str) -> Option<String> {
        self.values.get(key).cloned()
    }

    fn set_string(&mut self, key: &str, value: String) {
        if self.values.get(key) != Some(&value) {
            self.values.insert(key.to_owned(), value);
            self.dirty = true;
        }
    }

    fn remove_string(&mut self, key: &str) {
        self.dirty |= self.values.remove(key).is_some();
    }

    /// Written to a temporary file and renamed over the old one, so a crash mid-write never
    /// leaves half a file.
    fn flush(&mut self) {
        let Some(path) = &self.path else { return };
        if !self.dirty {
            return;
        }
        let text = match ron::ser::to_string_pretty(&self.values, ron::ser::PrettyConfig::default()) {
            Ok(text) => text,
            Err(e) => return log::warn!("{}: {e}", path.display()),
        };
        let tmp = path.with_extension("ron.tmp");
        let written =
            path.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|()| std::fs::write(&tmp, text)).and_then(|()| std::fs::rename(&tmp, path));
        match written {
            Ok(()) => self.dirty = false,
            Err(e) => log::warn!("couldn't save {}: {e}", path.display()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use eframe::Storage as _;

    #[test]
    fn values_survive_a_reopen_and_bad_files_are_kept_aside() {
        let dir = std::env::temp_dir().join(format!("craft-suite-store-{}", std::process::id()));
        let path = dir.join("apps").join("a.ron");
        let mut s = Store::open(Some(path.clone()));
        assert_eq!(s.get_string("app"), None);
        s.set_string("app", "(x: 1)".into());
        s.flush();
        assert_eq!(Store::open(Some(path.clone())).get_string("app").as_deref(), Some("(x: 1)"));

        std::fs::write(&path, "not ron {").unwrap();
        assert_eq!(Store::open(Some(path.clone())).get_string("app"), None);
        assert!(path.with_extension("unreadable").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_store_can_start_from_the_standalone_apps_settings() {
        let dir = std::env::temp_dir().join(format!("craft-suite-seed-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let standalone = dir.join("app.ron");
        // The way eframe writes it.
        std::fs::write(&standalone, "{\n    \"pdfcraft\": \"{\\\"recent\\\":[]}\",\n}").unwrap();
        let path = dir.join("suite").join("pdfcraft.ron");
        let mut s = Store::open(Some(path.clone()));
        assert!(s.is_new());
        s.seed_from(&standalone);
        assert_eq!(s.get_string("pdfcraft").as_deref(), Some("{\"recent\":[]}"));
        s.flush();
        let reopened = Store::open(Some(path));
        assert!(!reopened.is_new(), "seeded once, then the suite's own");
        assert_eq!(reopened.get_string("pdfcraft").as_deref(), Some("{\"recent\":[]}"));
        assert!(std::fs::read_to_string(&standalone).unwrap().contains("pdfcraft"), "the standalone file is only read");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
