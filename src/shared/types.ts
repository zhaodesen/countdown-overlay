/** Shared constants/types between the settings window and the overlay window. */

/** Default number of seconds the overlay counts down (N → 1). */
export const COUNTDOWN_SECONDS = 5;

/** Valid range for the configurable countdown duration. */
export const MIN_COUNTDOWN_SECONDS = 1;
export const MAX_COUNTDOWN_SECONDS = 60;

/** Clamp an arbitrary value into a valid countdown duration. */
export function clampCountdownSeconds(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return COUNTDOWN_SECONDS;
  return Math.min(MAX_COUNTDOWN_SECONDS, Math.max(MIN_COUNTDOWN_SECONDS, n));
}

/** Tauri event the overlay emits when its countdown is fully finished. */
export const EVENT_FINISHED = "overlay:finished";
export const EVENT_SCHEDULE_FIRED = "scheduler:fired";
/** Emitted by the native scheduler when the lock/sleep pause state changes (payload: paused boolean). */
export const EVENT_SCHEDULE_PAUSE = "scheduler:pause-changed";

export interface SchedulerFiredPayload {
  taskId: string;
  fireAtMs: number;
  opened: boolean;
  /** True when the trigger was long past due (machine slept through it) and no overlay was shown. */
  skipped: boolean;
}

/** localStorage keys (shared across the two same-origin windows). */
export const LS_TASKS = "co.tasks.v1";
export const LS_SETTINGS = "co.settings.v1";
export const LS_OVERLAY_CONFIG = "co.overlay.config.v1";

/** Task repeat type. */
export type TaskType = "once" | "repeat" | "interval";

/** Unit used by interval (循环) tasks. */
export type IntervalUnit = "second" | "minute" | "hour" | "day";

/** How a one-off task's target time was specified. */
export type TimeMode = "time" | "date";

/** Milliseconds per interval unit. */
export const UNIT_MS: Record<IntervalUnit, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** A single countdown task. */
export interface Task {
  id: string;
  name: string;
  /** Target time as Beijing wall-clock components. */
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  type: TaskType;
  /** For repeat tasks: selected weekdays. 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /**
   * For one-off tasks: whether the user picked just a clock time ("time",
   * fires at the next occurrence) or a full calendar date ("date").
   */
  timeMode?: TimeMode;
  /** For interval (循环) tasks: how many units between runs. */
  intervalValue?: number;
  /** For interval (循环) tasks: the unit of the interval. */
  intervalUnit?: IntervalUnit;
  /** For interval (循环) tasks: epoch-ms the cycle is measured from. */
  intervalAnchor?: number;
  /** Theme id to play for this task. */
  themeId: string;
  enabled: boolean;
  /** Guards against double-firing: the fireAt timestamp last handled. */
  lastFiredFor?: number;
}

/** Global app settings. */
export interface AppSettings {
  soundOn: boolean;
  colorMode: "dark" | "light";
  /** Whether the overlay shows the countdown digits. */
  showDigits: boolean;
  /** Countdown duration in seconds (also the trigger lead time). */
  countdownSeconds: number;
}

/** Config handed to the overlay window via localStorage before it opens. */
export interface OverlayConfig {
  themeId: string;
  soundOn: boolean;
  preview: boolean;
  /** Whether the overlay shows the countdown digits. */
  showDigits: boolean;
  /** Countdown duration in seconds. */
  countdownSeconds: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  soundOn: true,
  colorMode: "dark",
  showDigits: true,
  countdownSeconds: COUNTDOWN_SECONDS,
};
