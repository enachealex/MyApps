//! ArtCraft Studio: the apps for photo, video, audio and design, one tab each.
//!
//! Usage: `craft-studio [--tab <app>] [--no-settings] [--screenshot-all <dir>] [--update <app,…>|all] [files…]`
// Release builds on Windows are GUI apps: no console window when started from Explorer.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

fn main() -> eframe::Result {
    craft_suite::run(craft_suite::Suite {
        name: "ArtCraft Studio",
        app_id: "artcraft-studio",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icon/hicolor/256x256/apps/ai.storyteller.artcraft-launcher.png"),
        // Files go to the first tab that opens their type, so the order also settles who gets a
        // type two apps open (PhotoCraft before LightCraft for JPEG and TIFF, FilmCraft before
        // SoundCraft for video with sound).
        tools: vec![
            host_photocraft::tool(),
            host_lightcraft::tool(),
            host_vectorcraft::tool(),
            host_filmcraft::tool(),
            host_effectcraft::tool(),
            host_soundcraft::tool(),
            host_cadcraft::tool(),
        ],
        // The Home tab: each app's version, and updates built from this package.
        package: Some(env!("CARGO_PKG_NAME")),
    })
}
