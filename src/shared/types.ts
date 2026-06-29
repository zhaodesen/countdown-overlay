/** Shared constants/types between the settings window and the overlay window. */

/** Number of seconds the overlay counts down (5 → 1). */
export const COUNTDOWN_SECONDS = 5;

/** How many seconds before the target time the overlay should appear. */
export const TRIGGER_LEAD_SECONDS = 5;

/** Tauri event the overlay emits when its countdown is fully finished. */
export const EVENT_FINISHED = "overlay:finished";
export const EVENT_SCHEDULE_FIRED = "scheduler:fired";

export interface SchedulerFiredPayload {
  taskId: string;
  fireAtMs: number;
  opened: boolean;
}

/** localStorage keys (shared across the two same-origin windows). */
export const LS_TASKS = "co.tasks.v1";
export const LS_SETTINGS = "co.settings.v1";
export const LS_OVERLAY_CONFIG = "co.overlay.config.v1";

/** Task repeat type. */
export type TaskType = "once" | "repeat";

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
}

/** Config handed to the overlay window via localStorage before it opens. */
export interface OverlayConfig {
  themeId: string;
  soundOn: boolean;
  preview: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { soundOn: true, colorMode: "dark" };
