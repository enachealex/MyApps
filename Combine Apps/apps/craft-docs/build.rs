//! The Windows executable's icon and version details.

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let mut res = winresource::WindowsResource::new();
    res.set_icon("../../vendor/craft-launcher/assets/app-icon/artcraft-launcher.ico");
    res.set("ProductName", "ArtCraft Docs");
    res.set("FileDescription", "ArtCraft Docs");
    if let Err(e) = res.compile() {
        println!("cargo::warning=no Windows icon resource: {e}");
    }
}
