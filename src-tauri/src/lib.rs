use std::time::{Duration, Instant};
use tauri::{
    async_runtime::Mutex, AppHandle, Manager, PhysicalPosition, State, WebviewUrl,
    WebviewWindowBuilder,
};

/// Label used for the (single) overlay window. Kept as a constant so it is
/// easy to reuse when we later support multi-monitor (one window per monitor).
const OVERLAY_LABEL: &str = "overlay";

#[derive(Default)]
struct OverlayState {
    operation_lock: Mutex<()>,
}

/// Create and show the full-screen, transparent, click-through overlay window
/// on the primary monitor. Called from the settings window via `invoke`.
///
/// Notes for future multi-monitor support: iterate `app.available_monitors()`
/// and build one overlay window per monitor with a label like
/// `overlay-<index>`, positioning each at its monitor's origin.
#[tauri::command]
async fn show_overlay(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
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

    let window =
        WebviewWindowBuilder::new(&app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
            .title("overlay")
            .inner_size(logical_w, logical_h)
            .decorations(false) // no borders / title bar
            .transparent(true) // transparent background
            .always_on_top(true) // stay above other windows
            .skip_taskbar(true) // hide from taskbar / app switcher where supported
            .resizable(false)
            .focused(false) // don't steal focus from the active app
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

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OverlayState::default())
        .invoke_handler(tauri::generate_handler![show_overlay])
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                // Closing the control window means quitting the application,
                // including every overlay webview and background task.
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
