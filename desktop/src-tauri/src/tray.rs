use crate::{formatting, proxy::ProxyClient, widget, window};
use serde_json::Value;
use std::sync::atomic::Ordering;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

pub fn install(app: &AppHandle, proxy: ProxyClient) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open-dashboard", "Open Dashboard", true, None::<&str>)?;
    let browser = MenuItem::with_id(app, "open-browser", "Open in Browser", true, None::<&str>)?;
    let login = CheckMenuItem::with_id(
        app,
        "start-at-login",
        "Start at Login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let spawned_by_us = app
        .state::<crate::AppState>()
        .spawned_by_us
        .load(Ordering::Relaxed);
    let stop = MenuItem::with_id(app, "stop-proxy", "Stop proxy", spawned_by_us, None::<&str>)?;
    let stop_item = stop.clone();
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &browser,
            &PredefinedMenuItem::separator(app)?,
            &login,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let tray = TrayIconBuilder::with_id("main")
        .icon(icon())
        .icon_as_template(true)
        .menu(&menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    window::show(&window);
                }
            }
        })
        .on_menu_event(move |app, event| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            match event.id().as_ref() {
                "open-dashboard" => window::show(&window),
                "open-browser" => {
                    let endpoint = app.state::<crate::AppState>().proxy.endpoint();
                    let _ = app
                        .opener()
                        .open_url(format!("{}#/usage", endpoint.url("/")), None::<String>);
                }
                "start-at-login" => {
                    let enabled = app.autolaunch().is_enabled().unwrap_or(false);
                    if enabled {
                        let _ = app.autolaunch().disable();
                    } else {
                        let _ = app.autolaunch().enable();
                    }
                }
                "stop-proxy" => {
                    if app
                        .state::<crate::AppState>()
                        .spawned_by_us
                        .load(Ordering::Relaxed)
                    {
                        let proxy = app.state::<crate::AppState>().proxy.clone();
                        let app = app.clone();
                        let stop_item = stop_item.clone();
                        tauri::async_runtime::spawn(async move {
                            let stopped =
                                proxy.stop().await.is_ok() || proxy.is_alive().await.is_err();
                            if stopped {
                                app.state::<crate::AppState>().shutdown_child();
                                let _ = stop_item.set_enabled(false);
                            }
                        });
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    refresh_title(&tray, &proxy);
    widget::refresh(&proxy);
    let tray = tray.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            refresh_title(&tray, &proxy);
            tick += 1;
            if tick % 5 == 0 {
                widget::refresh(&proxy);
            }
        }
    });
    Ok(())
}

fn refresh_title(tray: &tauri::tray::TrayIcon<Wry>, proxy: &ProxyClient) {
    let proxy = proxy.clone();
    let tray = tray.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(settings) = proxy.companion_settings().await else {
            return;
        };
        let Ok(usage) = proxy.usage_summary().await else {
            return;
        };
        let quotas = proxy.quotas().await.unwrap_or(Value::Null);
        if let Some(title) = render_title(&settings, &usage, &quotas) {
            let _ = tray.set_title(Some(&title));
        }
    });
}

pub(crate) fn render_title(settings: &Value, usage: &Value, quotas: &Value) -> Option<String> {
    let metric = settings
        .pointer("/settings/menuBarMetric")
        .and_then(Value::as_str)
        .unwrap_or("tokens");
    let summary = usage.get("summary").unwrap_or(usage);
    let quota = quota_percent(quotas);
    let value = match metric {
        "requests" => formatting::count(summary.get("requests").and_then(Value::as_i64)),
        "cost" => formatting::cost(summary.get("estimatedCostUsd").and_then(Value::as_f64)),
        "quota" => format_percent(quota),
        "none" => return None,
        _ => formatting::tokens(summary.get("totalTokens").and_then(Value::as_i64)),
    };
    let template = settings
        .pointer("/settings/menuBarTemplate")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let rendered = template
        .map(|value| {
            value
                .replace(
                    "{requests}",
                    &formatting::count(summary.get("requests").and_then(Value::as_i64)),
                )
                .replace(
                    "{totalTokens}",
                    &formatting::tokens(summary.get("totalTokens").and_then(Value::as_i64)),
                )
                .replace(
                    "{costUsd}",
                    &formatting::cost(summary.get("estimatedCostUsd").and_then(Value::as_f64)),
                )
                .replace(
                    "{inputTokens}",
                    &formatting::tokens(summary.get("inputTokens").and_then(Value::as_i64)),
                )
                .replace(
                    "{outputTokens}",
                    &formatting::tokens(summary.get("outputTokens").and_then(Value::as_i64)),
                )
                .replace("{quotaPercent}", &format_percent(quota))
        })
        .unwrap_or(value);
    let rendered = rendered.trim();
    if rendered.is_empty() {
        None
    } else if rendered.chars().count() > 24 {
        Some(format!(
            "{}…",
            rendered.chars().take(23).collect::<String>()
        ))
    } else {
        Some(rendered.to_owned())
    }
}

fn quota_percent(value: &Value) -> Option<f64> {
    let reports = value.get("reports")?.as_array()?;
    let mut values = Vec::new();
    for report in reports {
        let Some(quota) = report.get("quota") else {
            continue;
        };
        for key in ["weeklyPercent", "monthlyPercent", "fiveHourPercent"] {
            if let Some(value) = quota.get(key).and_then(Value::as_f64) {
                values.push(value);
            }
        }
        if let Some(windows) = quota.get("customWindows").and_then(Value::as_array) {
            values.extend(
                windows
                    .iter()
                    .filter_map(|window| window.get("percent").and_then(Value::as_f64)),
            );
        }
    }
    values.into_iter().reduce(f64::min)
}

fn format_percent(value: Option<f64>) -> String {
    value
        .map(|value| format!("{}%", value.round() as i64))
        .unwrap_or_else(|| "—".into())
}

fn icon() -> tauri::image::Image<'static> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray/icon.png"))
        .expect("valid tray icon")
}
