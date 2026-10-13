//! Apps handing files to each other within the window: LightCraft's Photo ▸ Edit In ▸ PhotoCraft
//! opens the photo in the PhotoCraft tab, where a standalone LightCraft would start a standalone
//! PhotoCraft.
//!
//! The sending app calls [`open_in`]; the window shows the receiving app's tab (starting the app
//! if need be), and the receiving app's host collects the files with [`take_open_requests`] in its
//! `logic`, which runs once its tab is shown.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

#[derive(Default)]
struct State {
    /// The suite windows of this process: their apps' ids, and their context to wake them.
    windows: Vec<(Vec<&'static str>, egui::Context)>,
    /// Files handed to each app, not yet taken.
    files: HashMap<String, Vec<PathBuf>>,
    /// Apps whose tab is to be shown, oldest first.
    show: Vec<String>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    f(STATE.lock().unwrap_or_else(PoisonError::into_inner).get_or_insert_with(State::default))
}

/// A suite window with these apps is running on `ctx`.
pub(crate) fn register(tools: Vec<&'static str>, ctx: egui::Context) {
    with(|s| s.windows.push((tools, ctx)));
}

/// Whether a suite window in this process has the app `id`.
pub fn has_tool(id: &str) -> bool {
    with(|s| s.windows.iter().any(|(tools, _)| tools.contains(&id)))
}

/// Hands `files` to the app `id` of this process's suite window: its tab is shown, and the app
/// receives them through [`take_open_requests`]. `false` when there is no such app here; the caller
/// then does what it does on its own.
pub fn open_in(id: &str, files: Vec<PathBuf>) -> bool {
    with(|s| {
        let Some((_, ctx)) = s.windows.iter().find(|(tools, _)| tools.contains(&id)) else { return false };
        ctx.request_repaint();
        s.files.entry(id.to_owned()).or_default().extend(files);
        s.show.push(id.to_owned());
        true
    })
}

/// The files other apps handed to the app `id` since the last call.
pub fn take_open_requests(id: &str) -> Vec<PathBuf> {
    with(|s| s.files.remove(id).unwrap_or_default())
}

/// The tab (an index into `tools`) the most recent hand-off to one of `tools` asks to show.
pub(crate) fn take_show(tools: &[&str]) -> Option<usize> {
    with(|s| {
        let mut shown = None;
        s.show.retain(|id| match tools.iter().position(|t| t == id) {
            Some(i) => {
                shown = Some(i);
                false
            }
            None => true,
        });
        shown
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_reach_the_app_of_a_running_window_only() {
        let ctx = egui::Context::default();
        assert!(!has_tool("handoff-editor"));
        assert!(!open_in("handoff-editor", vec![PathBuf::from("a.tif")]), "no window has it yet");
        register(vec!["handoff-library", "handoff-editor"], ctx);
        assert!(has_tool("handoff-editor"));
        assert!(open_in("handoff-editor", vec![PathBuf::from("a.tif")]));
        assert!(open_in("handoff-editor", vec![PathBuf::from("b.tif")]));
        assert_eq!(take_show(&["unrelated"]), None);
        assert_eq!(take_show(&["handoff-library", "handoff-editor"]), Some(1));
        assert_eq!(take_show(&["handoff-library", "handoff-editor"]), None, "taken");
        assert_eq!(take_open_requests("handoff-editor"), [PathBuf::from("a.tif"), PathBuf::from("b.tif")]);
        assert!(take_open_requests("handoff-editor").is_empty());
    }
}
