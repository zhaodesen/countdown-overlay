//! macOS session watcher: pauses the scheduler while the screen is locked.
//!
//! Listens for the `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked`
//! distributed notifications on a dedicated thread pumping its own CFRunLoop,
//! and feeds them into the same `set_session_locked` used on Windows.
//! Sleep/wake without a lock event is handled separately by the scheduler's
//! wall-clock gap detection.

use std::ffi::c_void;
use std::os::raw::c_char;
use std::sync::OnceLock;
use tauri::AppHandle;

type CFNotificationCenterRef = *mut c_void;
type CFStringRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFAllocatorRef = *const c_void;
type CFIndex = isize;

type CFNotificationCallback = extern "C" fn(
    center: CFNotificationCenterRef,
    observer: *mut c_void,
    name: CFStringRef,
    object: *const c_void,
    user_info: CFDictionaryRef,
);

const KCF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
/// CFNotificationSuspensionBehaviorDeliverImmediately
const DELIVER_IMMEDIATELY: CFIndex = 4;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFNotificationCenterGetDistributedCenter() -> CFNotificationCenterRef;
    fn CFNotificationCenterAddObserver(
        center: CFNotificationCenterRef,
        observer: *const c_void,
        call_back: CFNotificationCallback,
        name: CFStringRef,
        object: *const c_void,
        suspension_behavior: CFIndex,
    );
    fn CFStringCreateWithCString(
        alloc: CFAllocatorRef,
        c_str: *const c_char,
        encoding: u32,
    ) -> CFStringRef;
    fn CFRunLoopRun();
}

static APP: OnceLock<AppHandle> = OnceLock::new();

extern "C" fn on_screen_locked(
    _center: CFNotificationCenterRef,
    _observer: *mut c_void,
    _name: CFStringRef,
    _object: *const c_void,
    _user_info: CFDictionaryRef,
) {
    if let Some(app) = APP.get() {
        crate::scheduler::set_session_locked(app, true);
    }
}

extern "C" fn on_screen_unlocked(
    _center: CFNotificationCenterRef,
    _observer: *mut c_void,
    _name: CFStringRef,
    _object: *const c_void,
    _user_info: CFDictionaryRef,
) {
    if let Some(app) = APP.get() {
        crate::scheduler::set_session_locked(app, false);
    }
}

pub fn spawn(app: AppHandle) {
    if APP.set(app).is_err() {
        return; // already watching
    }
    std::thread::spawn(|| unsafe {
        let center = CFNotificationCenterGetDistributedCenter();
        if center.is_null() {
            eprintln!("session watcher: no distributed notification center");
            return;
        }
        let locked_name = CFStringCreateWithCString(
            std::ptr::null(),
            c"com.apple.screenIsLocked".as_ptr(),
            KCF_STRING_ENCODING_UTF8,
        );
        let unlocked_name = CFStringCreateWithCString(
            std::ptr::null(),
            c"com.apple.screenIsUnlocked".as_ptr(),
            KCF_STRING_ENCODING_UTF8,
        );
        if locked_name.is_null() || unlocked_name.is_null() {
            eprintln!("session watcher: unable to create notification names");
            return;
        }
        CFNotificationCenterAddObserver(
            center,
            std::ptr::null(),
            on_screen_locked,
            locked_name,
            std::ptr::null(),
            DELIVER_IMMEDIATELY,
        );
        CFNotificationCenterAddObserver(
            center,
            std::ptr::null(),
            on_screen_unlocked,
            unlocked_name,
            std::ptr::null(),
            DELIVER_IMMEDIATELY,
        );
        // Notifications are delivered on the registering thread's run loop;
        // park it here forever to pump them.
        CFRunLoopRun();
    });
}
