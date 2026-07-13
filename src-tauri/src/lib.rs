mod scheduler;
#[cfg(target_os = "macos")]
mod session_mac;
#[cfg(windows)]
mod session_win;
mod timebj;

use std::time::{Duration, Instant};
use tauri::{
    async_runtime::Mutex,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};

/// Label used for the (single) overlay window. Kept as a constant so it is
/// easy to reuse when we later support multi-monitor (one window per monitor).
const OVERLAY_LABEL: &str = "overlay";
const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_MAIN_ID: &str = "tray-show-main";
const TRAY_EXIT_APP_ID: &str = "tray-exit-app";

pub(crate) struct OverlayState {
    operation_lock: Mutex<()>,
}

impl Default for OverlayState {
    fn default() -> Self {
        Self {
            operation_lock: Mutex::new(()),
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Create and show the full-screen, transparent, click-through overlay window
/// on the primary monitor. Called from the settings window via `invoke` and
/// from the native scheduler when a task fires.
///
/// Notes for future multi-monitor support: iterate `app.available_monitors()`
/// and build one overlay window per monitor with a label like
/// `overlay-<index>`, positioning each at its monitor's origin.
pub(crate) async fn show_overlay_window(
    app: &AppHandle,
    state: &OverlayState,
    theme_id: &str,
    sound_on: bool,
    preview: bool,
    show_digits: bool,
    countdown_secs: u32,
) -> Result<(), String> {
    if !theme_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("invalid theme id".to_string());
    }

    // Multiple tasks may fire in the same scheduler tick. Serialize the full
    // replace/create operation so concurrent invokes cannot claim the label.
    let _operation_guard = state.operation_lock.lock().await;

    // Force-destroy an active overlay before recreating the fixed-label
    // window. Unlike `close`, `destroy` does not emit an interceptable close
    // request, so the label is released before the new window is built.
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        existing.destroy().map_err(|e| e.to_string())?;

        let deadline = Instant::now() + Duration::from_secs(1);
        while app.get_webview_window(OVERLAY_LABEL).is_some() {
            if Instant::now() >= deadline {
                return Err("timed out while replacing the active overlay".to_string());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no primary monitor found".to_string())?;

    let size = monitor.size();
    let position = *monitor.position();
    let scale = monitor.scale_factor();

    // Builder takes logical pixels; the monitor reports physical pixels.
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;

    let overlay_url = format!(
        "overlay.html?theme={theme_id}&sound={}&preview={}&digits={}&secs={}",
        if sound_on { 1 } else { 0 },
        if preview { 1 } else { 0 },
        if show_digits { 1 } else { 0 },
        countdown_secs.clamp(1, 60)
    );

    let window =
        WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App(overlay_url.into()))
            .title("overlay")
            .inner_size(logical_w, logical_h)
            .decorations(false) // no borders / title bar
            .shadow(false) // remove the Windows undecorated inset around the content
            .transparent(true) // transparent background
            .always_on_top(true) // stay above other windows
            .skip_taskbar(true) // hide from taskbar / app switcher where supported
            .resizable(false)
            .focused(true) // receive Escape so the user can always dismiss it
            .build()
            .map_err(|e| e.to_string())?;

    // Cover the primary monitor exactly.
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|e| e.to_string())?;

    // Reinforce always-on-top and enable mouse click-through so the overlay
    // does not block interaction with apps underneath it.
    let _ = window.set_always_on_top(true);
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_focus();

    Ok(())
}

/// Open an https URL in the user's default browser. Used by the settings
/// window's update check; restricted to https to keep the surface minimal.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https urls can be opened".to_string());
    }
    #[cfg(windows)]
    let result = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result.map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_overlay(
    app: AppHandle,
    state: State<'_, OverlayState>,
    theme_id: String,
    sound_on: bool,
    preview: bool,
    show_digits: bool,
    countdown_secs: u32,
) -> Result<(), String> {
    show_overlay_window(
        &app,
        state.inner(),
        &theme_id,
        sound_on,
        preview,
        show_digits,
        countdown_secs,
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OverlayState::default())
        .invoke_handler(tauri::generate_handler![
            show_overlay,
            open_external,
            scheduler::tasks_bootstrap,
            scheduler::tasks_all,
            scheduler::tasks_upsert,
            scheduler::tasks_set_enabled,
            scheduler::tasks_delete,
            scheduler::scheduler_set_settings
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(
                app,
                TRAY_SHOW_MAIN_ID,
                "显示主窗口",
                true,
                None::<&str>,
            )?;
            let quit_item =
                MenuItem::with_id(app, TRAY_EXIT_APP_ID, "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("bang")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    TRAY_SHOW_MAIN_ID => show_main_window(app),
                    TRAY_EXIT_APP_ID => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.build(app)?;

            // Native scheduling authority: load the persisted store, start
            // the deadline loop, and watch for session lock so the scheduler
            // pauses while the workstation is locked.
            app.manage(scheduler::load(app.handle()));
            tauri::async_runtime::spawn(scheduler::scheduler_loop(app.handle().clone()));
            #[cfg(windows)]
            session_win::spawn(app.handle().clone());
            #[cfg(target_os = "macos")]
            session_mac::spawn(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
