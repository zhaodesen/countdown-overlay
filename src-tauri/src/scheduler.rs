//! Native scheduling authority.
//!
//! Rust owns the task list, the recurrence math, firing, persistence and the
//! lock/sleep pause semantics. The webview is only an editor UI: it mutates
//! tasks through the `tasks_*` commands and mirrors the authoritative list
//! back for display, so a frozen or restarted webview can never stall
//! scheduling.
//!
//! Pause semantics (锁屏/睡眠暂停，解锁/唤醒继续):
//! - While the session is locked or the machine is suspended nothing fires.
//! - On resume, interval (循环) tasks shift their anchor by the paused
//!   duration, so the remaining wait continues where it left off.
//! - once/repeat tasks are bound to absolute wall-clock times; occurrences
//!   that fell inside the pause are skipped (once tasks get disabled) and the
//!   frontend is notified so it can show a "skipped" toast.

use crate::timebj::{beijing_wall_to_epoch, utc_to_beijing};
use crate::{show_overlay_window, OverlayState};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{async_runtime::Mutex, AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;

pub const EVENT_SCHEDULE_FIRED: &str = "scheduler:fired";
pub const EVENT_SCHEDULE_PAUSE: &str = "scheduler:pause-changed";

/// Grace window for "just fired / just past" instants; matches the 1500 ms
/// used by `nextFireEpoch` in src/shared/time.ts.
const FIRE_GRACE_MS: i64 = 1500;

/// Upper bound for a single timer sleep. Tokio timers run on a monotonic
/// clock that freezes while the machine is suspended, so one long sleep would
/// overshoot its wall-clock deadline by the entire suspend duration; short
/// chunks re-check the wall clock within a second of resume.
const MAX_TIMER_CHUNK_MS: i64 = 1000;

/// A chunk sleep overshooting its budget by more than this means the machine
/// was suspended without a session-lock event (e.g. sleep without password);
/// the overshoot is then treated as paused time.
const SUSPEND_GAP_SLACK_MS: i64 = 5000;

/// Due triggers older than this are reported as skipped instead of shown — a
/// countdown to a moment far in the past is meaningless.
const STALE_TRIGGER_MS: i64 = 30_000;

pub fn epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/* ---------------- Task model (mirrors src/shared/types.ts) ---------------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskType {
    Once,
    Repeat,
    Interval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IntervalUnit {
    Second,
    Minute,
    Hour,
    Day,
}

impl IntervalUnit {
    fn ms(self) -> i64 {
        match self {
            IntervalUnit::Second => 1000,
            IntervalUnit::Minute => 60_000,
            IntervalUnit::Hour => 3_600_000,
            IntervalUnit::Day => 86_400_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    #[serde(rename = "type")]
    pub task_type: TaskType,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_value: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_unit: Option<IntervalUnit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_anchor: Option<i64>,
    pub theme_id: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_fired_for: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerSettings {
    /// Countdown duration in seconds; the overlay opens this long BEFORE the
    /// target time so the 5→1 countdown ends exactly at the target.
    pub lead_secs: u32,
    pub sound_on: bool,
    pub show_digits: bool,
}

impl Default for SchedulerSettings {
    fn default() -> Self {
        Self {
            lead_secs: 5,
            sound_on: true,
            show_digits: true,
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PersistedState {
    tasks: Vec<Task>,
    settings: SchedulerSettings,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerFiredPayload {
    pub task_id: String,
    pub fire_at_ms: i64,
    pub opened: bool,
    /// True when the occurrence was missed (pause / long past due) and no
    /// overlay was shown.
    pub skipped: bool,
}

#[derive(Default)]
pub struct PauseInfo {
    pub session_locked: bool,
    /// Wall-clock instant the current pause began, if paused.
    pub paused_since: Option<i64>,
}

pub struct SchedulerState {
    pub tasks: Mutex<Vec<Task>>,
    pub settings: Mutex<SchedulerSettings>,
    /// Wakes the scheduler loop after any state change.
    pub changed: Notify,
    /// std Mutex so the Windows session-watcher thread can use it directly.
    pub pause: StdMutex<PauseInfo>,
    store_path: Option<PathBuf>,
    /// Whether a persisted store existed at startup. When false, the first
    /// `tasks_bootstrap` adopts the webview's localStorage list (migration
    /// from the pre-native-authority format).
    store_loaded: bool,
}

/* ---------------- Persistence ---------------- */

pub fn load(app: &AppHandle) -> SchedulerState {
    let store_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("scheduler.json"));

    let mut persisted = PersistedState::default();
    let mut store_loaded = false;
    if let Some(path) = &store_path {
        if let Ok(text) = std::fs::read_to_string(path) {
            match serde_json::from_str::<PersistedState>(&text) {
                Ok(state) => {
                    persisted = state;
                    store_loaded = true;
                }
                Err(error) => eprintln!("scheduler store unreadable, starting fresh: {error}"),
            }
        }
    }
    persisted.settings.lead_secs = persisted.settings.lead_secs.clamp(1, 60);

    SchedulerState {
        tasks: Mutex::new(persisted.tasks),
        settings: Mutex::new(persisted.settings),
        changed: Notify::new(),
        pause: StdMutex::new(PauseInfo::default()),
        store_path,
        store_loaded,
    }
}

async fn persist(state: &SchedulerState) {
    let Some(path) = &state.store_path else {
        return;
    };
    let snapshot = PersistedState {
        tasks: state.tasks.lock().await.clone(),
        settings: *state.settings.lock().await,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(&snapshot) {
        Ok(json) => {
            if let Err(error) = std::fs::write(path, json) {
                eprintln!("unable to persist scheduler store: {error}");
            }
        }
        Err(error) => eprintln!("unable to serialize scheduler store: {error}"),
    }
}

/* ---------------- Recurrence math (port of time.ts nextFireEpoch) ---------------- */

fn next_fire_epoch(task: &Task, lead_secs: u32, now_ms: i64) -> Option<i64> {
    let lead_ms = lead_secs as i64 * 1000;

    match task.task_type {
        TaskType::Interval => {
            let period = task.interval_value.unwrap_or(0)
                * task.interval_unit.map_or(0, IntervalUnit::ms);
            if period <= 0 {
                return None;
            }
            let anchor = task.interval_anchor.unwrap_or(now_ms);
            // Smallest k≥1 whose fire instant (target − lead) is not already
            // long past.
            let k = (now_ms - anchor + lead_ms).div_euclid(period).max(1);
            let mut fire = anchor + k * period - lead_ms;
            if fire <= now_ms - FIRE_GRACE_MS {
                fire = anchor + (k + 1) * period - lead_ms;
            }
            Some(fire)
        }

        TaskType::Once => Some(
            beijing_wall_to_epoch(
                task.year,
                task.month,
                task.day,
                task.hour,
                task.minute,
                task.second,
            )? - lead_ms,
        ),

        TaskType::Repeat => {
            if task.weekdays.is_empty() {
                return None;
            }
            let base = utc_to_beijing(now_ms);
            let day0 = beijing_wall_to_epoch(base.year, base.month, base.day, 0, 0, 0)?;
            for offset in 0..8 {
                let probe = utc_to_beijing(day0 + offset * 86_400_000);
                if !task.weekdays.contains(&probe.weekday) {
                    continue;
                }
                let fire = beijing_wall_to_epoch(
                    probe.year,
                    probe.month,
                    probe.day,
                    task.hour,
                    task.minute,
                    task.second,
                )? - lead_ms;
                if fire > now_ms - FIRE_GRACE_MS {
                    return Some(fire);
                }
            }
            None
        }
    }
}

/// Next fire instant, never returning the occurrence recorded in
/// `last_fired_for` (which would double-fire within the grace window).
fn effective_next_fire(task: &Task, lead_secs: u32, now_ms: i64) -> Option<i64> {
    let fire = next_fire_epoch(task, lead_secs, now_ms)?;
    if task.task_type != TaskType::Once && task.last_fired_for == Some(fire) {
        return next_fire_epoch(task, lead_secs, fire + FIRE_GRACE_MS + 1);
    }
    Some(fire)
}

/* ---------------- Pause / resume ---------------- */

/// Called from the Windows session watcher on WM_WTSSESSION_CHANGE.
pub fn set_session_locked(app: &AppHandle, locked: bool) {
    let state = app.state::<SchedulerState>();
    let ended_pause = {
        let mut pause = state.pause.lock().unwrap();
        if locked {
            pause.session_locked = true;
            if pause.paused_since.is_none() {
                pause.paused_since = Some(epoch_ms());
            }
            None
        } else {
            pause.session_locked = false;
            pause.paused_since.take()
        }
    };
    if let Some(since) = ended_pause {
        // Settle the pause before the loop is woken so it cannot fire from a
        // not-yet-shifted schedule.
        tauri::async_runtime::block_on(end_pause(app, since, epoch_ms()));
    }
    let _ = app.emit_to("main", EVENT_SCHEDULE_PAUSE, locked);
    state.changed.notify_one();
}

/// Apply pause semantics for the window `[paused_since, now_ms]`.
async fn end_pause(app: &AppHandle, paused_since: i64, now_ms: i64) {
    if now_ms <= paused_since {
        return;
    }
    let state = app.state::<SchedulerState>();
    let pause_ms = now_ms - paused_since;
    let lead_secs = state.settings.lock().await.lead_secs;

    let mut skipped: Vec<SchedulerFiredPayload> = Vec::new();
    {
        let mut tasks = state.tasks.lock().await;
        for task in tasks.iter_mut().filter(|task| task.enabled) {
            match task.task_type {
                // 暂停语义：锚点整体后移，剩余等待时长跨过锁屏/睡眠保持不变。
                TaskType::Interval => {
                    if let Some(anchor) = task.interval_anchor.as_mut() {
                        *anchor += pause_ms;
                    }
                }
                // Absolute wall-clock tasks: occurrences inside the pause are
                // skipped; once tasks cannot recur, so they get disabled.
                TaskType::Once | TaskType::Repeat => {
                    if let Some(fire) = effective_next_fire(task, lead_secs, paused_since) {
                        if fire <= now_ms {
                            task.last_fired_for = Some(fire);
                            if task.task_type == TaskType::Once {
                                task.enabled = false;
                            }
                            skipped.push(SchedulerFiredPayload {
                                task_id: task.id.clone(),
                                fire_at_ms: fire,
                                opened: false,
                                skipped: true,
                            });
                        }
                    }
                }
            }
        }
    }
    persist(&state).await;
    for payload in skipped {
        let _ = app.emit_to("main", EVENT_SCHEDULE_FIRED, payload);
    }
}

/* ---------------- Scheduler loop ---------------- */

pub async fn scheduler_loop(app: AppHandle) {
    loop {
        let state = app.state::<SchedulerState>();
        let changed = state.changed.notified();

        // Paused (session locked): nothing fires until the unlock handler
        // settles the pause and notifies.
        if state.pause.lock().unwrap().paused_since.is_some() {
            changed.await;
            continue;
        }

        let now = epoch_ms();
        let lead_secs = { state.settings.lock().await.lead_secs };
        let next = {
            let tasks = state.tasks.lock().await;
            tasks
                .iter()
                .filter(|task| task.enabled)
                .filter_map(|task| effective_next_fire(task, lead_secs, now))
                .min()
        };

        let Some(next_fire) = next else {
            changed.await;
            continue;
        };

        let delay_ms = next_fire - now;
        if delay_ms > 0 {
            let chunk_ms = delay_ms.min(MAX_TIMER_CHUNK_MS);
            let slept_from = epoch_ms();
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(chunk_ms as u64)) => {},
                _ = changed => {},
            }
            // Wall clock jumped far past a ≤1s monotonic sleep: the machine
            // was suspended without a lock event — treat the gap as a pause.
            let woke_at = epoch_ms();
            if woke_at - slept_from > chunk_ms + SUSPEND_GAP_SLACK_MS {
                let locked_meanwhile =
                    { state.pause.lock().unwrap().paused_since.is_some() };
                if !locked_meanwhile {
                    end_pause(&app, slept_from, woke_at).await;
                }
            }
            continue;
        }

        // Fire everything due; record state first so a re-entrant sync can
        // never double-fire, then persist and open the overlays.
        let settings = { *state.settings.lock().await };
        let mut fired: Vec<(SchedulerFiredPayload, String)> = Vec::new();
        {
            let mut tasks = state.tasks.lock().await;
            for task in tasks.iter_mut().filter(|task| task.enabled) {
                let Some(fire) = effective_next_fire(task, settings.lead_secs, now) else {
                    continue;
                };
                if fire > now {
                    continue;
                }
                task.last_fired_for = Some(fire);
                if task.task_type == TaskType::Once {
                    task.enabled = false;
                }
                fired.push((
                    SchedulerFiredPayload {
                        task_id: task.id.clone(),
                        fire_at_ms: fire,
                        opened: false,
                        skipped: false,
                    },
                    task.theme_id.clone(),
                ));
            }
        }
        persist(&state).await;

        for (mut payload, theme_id) in fired {
            payload.skipped = epoch_ms() - payload.fire_at_ms > STALE_TRIGGER_MS;
            payload.opened = !payload.skipped
                && show_overlay_window(
                    &app,
                    app.state::<OverlayState>().inner(),
                    &theme_id,
                    settings.sound_on,
                    false,
                    settings.show_digits,
                    settings.lead_secs,
                )
                .await
                .is_ok();
            let _ = app.emit_to("main", EVENT_SCHEDULE_FIRED, payload);
        }
    }
}

/* ---------------- Commands (webview → Rust) ---------------- */

/// First call after the webview loads. When no persisted store exists yet,
/// adopts the webview's localStorage task list (one-time migration);
/// otherwise the persisted list wins. Returns the authoritative list.
#[tauri::command]
pub async fn tasks_bootstrap(
    state: State<'_, SchedulerState>,
    tasks: Vec<Task>,
) -> Result<Vec<Task>, String> {
    if !state.store_loaded {
        *state.tasks.lock().await = tasks;
        persist(state.inner()).await;
    }
    state.changed.notify_one();
    Ok(state.tasks.lock().await.clone())
}

#[tauri::command]
pub async fn tasks_all(state: State<'_, SchedulerState>) -> Result<Vec<Task>, String> {
    Ok(state.tasks.lock().await.clone())
}

#[tauri::command]
pub async fn tasks_upsert(
    state: State<'_, SchedulerState>,
    mut task: Task,
) -> Result<Vec<Task>, String> {
    // A (re)saved definition re-arms from scratch.
    task.last_fired_for = None;
    let id = task.id.clone();
    {
        let mut tasks = state.tasks.lock().await;
        match tasks.iter_mut().find(|item| item.id == id) {
            Some(existing) => *existing = task,
            None => tasks.push(task),
        }
    }
    persist(state.inner()).await;
    state.changed.notify_one();
    Ok(state.tasks.lock().await.clone())
}

#[tauri::command]
pub async fn tasks_set_enabled(
    state: State<'_, SchedulerState>,
    id: String,
    enabled: bool,
) -> Result<Vec<Task>, String> {
    {
        let mut tasks = state.tasks.lock().await;
        if let Some(task) = tasks.iter_mut().find(|item| item.id == id) {
            task.enabled = enabled;
            task.last_fired_for = None;
        }
    }
    persist(state.inner()).await;
    state.changed.notify_one();
    Ok(state.tasks.lock().await.clone())
}

#[tauri::command]
pub async fn tasks_delete(
    state: State<'_, SchedulerState>,
    id: String,
) -> Result<Vec<Task>, String> {
    {
        let mut tasks = state.tasks.lock().await;
        tasks.retain(|item| item.id != id);
    }
    persist(state.inner()).await;
    state.changed.notify_one();
    Ok(state.tasks.lock().await.clone())
}

#[tauri::command]
pub async fn scheduler_set_settings(
    state: State<'_, SchedulerState>,
    settings: SchedulerSettings,
) -> Result<(), String> {
    let mut next = settings;
    next.lead_secs = next.lead_secs.clamp(1, 60);
    *state.settings.lock().await = next;
    persist(state.inner()).await;
    state.changed.notify_one();
    Ok(())
}
