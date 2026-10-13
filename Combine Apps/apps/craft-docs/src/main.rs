//! ArtCraft Docs: the apps for writing, data and documents, one tab each.
//!
//! Usage: `craft-docs [--tab <app>] [--no-settings] [--screenshot-all <dir>] [files…]`
// Release builds on Windows are GUI apps: no console window when started from Explorer.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

fn main() -> eframe::Result {
    craft_suite::run(craft_suite::Suite {
        name: "ArtCraft Docs",
        app_id: "artcraft-docs",
        icon_png: include_bytes!("../../../vendor/craft-launcher/assets/app-icon/hicolor/256x256/apps/ai.storyteller.artcraft-launcher.png"),
        // Files go to the first tab that opens their type.
        tools: vec![host_wordcraft::tool(), host_gridcraft::tool(), host_deckcraft::tool(), host_pdfcraft::tool(), host_designcraft::tool()],
    })
}
