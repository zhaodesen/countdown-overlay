//! Windows session watcher: pauses the scheduler while the workstation is
//! locked (WM_WTSSESSION_CHANGE → WTS_SESSION_LOCK / WTS_SESSION_UNLOCK).
//!
//! WTS notifications are NOT delivered to message-only windows, so a real
//! (never shown) top-level window is created on a dedicated thread with its
//! own message pump. Sleep/hibernate without a lock event is handled
//! separately by the scheduler's wall-clock gap detection.

use std::sync::OnceLock;
use tauri::AppHandle;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, MSG, WM_WTSSESSION_CHANGE, WNDCLASSW, WTS_SESSION_LOCK,
    WTS_SESSION_UNLOCK,
};

static APP: OnceLock<AppHandle> = OnceLock::new();

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_WTSSESSION_CHANGE {
        if let Some(app) = APP.get() {
            match wparam as u32 {
                WTS_SESSION_LOCK => crate::scheduler::set_session_locked(app, true),
                WTS_SESSION_UNLOCK => crate::scheduler::set_session_locked(app, false),
                _ => {}
            }
        }
        return 0;
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

pub fn spawn(app: AppHandle) {
    if APP.set(app).is_err() {
        return; // already watching
    }
    std::thread::spawn(|| unsafe {
        let class_name: Vec<u16> = "bang_session_watch\0".encode_utf16().collect();
        let hinstance = GetModuleHandleW(std::ptr::null());

        let mut wc: WNDCLASSW = std::mem::zeroed();
        wc.lpfnWndProc = Some(wnd_proc);
        wc.hInstance = hinstance;
        wc.lpszClassName = class_name.as_ptr();
        if RegisterClassW(&wc) == 0 {
            eprintln!("session watcher: RegisterClassW failed");
            return;
        }

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            eprintln!("session watcher: CreateWindowExW failed");
            return;
        }
        if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) == 0 {
            eprintln!("session watcher: WTSRegisterSessionNotification failed");
            return;
        }

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}
