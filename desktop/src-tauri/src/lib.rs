mod auth;
mod discovery;
mod formatting;
mod proxy;
mod sidecar;
mod tray;
mod window;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::process::CommandChild;

pub struct AppState {
    pub proxy: proxy::ProxyClient,
    pub spawned_by_us: AtomicBool,
    pub child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn show_dashboard(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window::show(&window);
    }
}

#[tauri::command]
fn hide_dashboard(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window::hide(&window);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                window::show(&window);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![show_dashboard, hide_dashboard])
        .setup(|app| {
            let (endpoint, home) = discovery::current();
            let proxy = proxy::ProxyClient::new(endpoint, auth::Auth::new(home))
                .map_err(|error| error.to_string())?;
            let child = tauri::async_runtime::block_on(sidecar::ensure_proxy(
                app.handle(),
                &proxy,
                endpoint,
            ))
            .map_err(std::io::Error::other)?;
            app.manage(AppState {
                proxy: proxy.clone(),
                spawned_by_us: AtomicBool::new(child.is_some()),
                child: Mutex::new(child),
            });

            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App(format!("index.html?port={}", endpoint.port).into()),
            )
            .title("OpenCodex")
            .inner_size(1100.0, 720.0)
            .visible(false)
            .on_navigation(window::navigation_allowed)
            .build()?;
            window::configure(&window);
            window::set_tray_policy(app.handle(), false);
            let dashboard = endpoint.url("/#/usage");
            if tauri::async_runtime::block_on(proxy.is_alive()).is_ok() {
                let _ = window.eval(format!("window.location.replace({dashboard:?})"));
            }
            tray::install(app.handle(), proxy)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if state.spawned_by_us.load(Ordering::Relaxed) {
                        if let Ok(mut child) = state.child.lock() {
                            if let Some(child) = child.take() {
                                let _ = child.kill();
                            }
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OpenCodex desktop shell");
}
