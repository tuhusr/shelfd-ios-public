#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let shelfd_url = "https://myscreenlist.com/"
        .parse()
        .expect("Shelfd live URL must be valid");

    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(shelfd_url),
            )
            .title("Shelfd")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 640.0)
            .resizable(true)
            .center()
            .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Allow)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Shelfd desktop app");
}
