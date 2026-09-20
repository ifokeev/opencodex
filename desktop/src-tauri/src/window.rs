use tauri::{AppHandle, Manager, Url, WebviewWindow, WindowEvent};

const LOOPBACK_PREFIX: &str = "http://127.0.0.1:";

pub fn configure(window: &WebviewWindow) {
    let window_for_close = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_for_close.hide();
            apply_tray_policy(window_for_close.app_handle(), false);
        }
    });
}

pub fn navigation_allowed(url: &Url) -> bool {
    let value = url.as_str();
    if value.starts_with(LOOPBACK_PREFIX) || value.starts_with("tauri://") {
        return true;
    }
    if value.starts_with("http://") || value.starts_with("https://") {
        let _ = tauri_plugin_opener::open_url(value, None::<&str>);
        return false;
    }
    true
}

pub fn show(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
    apply_tray_policy(window.app_handle(), true);
}

pub fn hide(window: &WebviewWindow) {
    let _ = window.hide();
    apply_tray_policy(window.app_handle(), false);
}

#[cfg(target_os = "macos")]
fn apply_tray_policy(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    let _ = app.set_dock_visibility(visible);
    let _ = app.set_activation_policy(policy);
}

#[cfg(not(target_os = "macos"))]
fn apply_tray_policy(_app: &AppHandle, _visible: bool) {}

pub fn set_tray_policy(app: &AppHandle, visible: bool) {
    apply_tray_policy(app, visible);
}
