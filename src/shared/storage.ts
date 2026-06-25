/** localStorage-backed persistence. Both windows share the same origin,
 *  so the settings window can hand config to the overlay window this way. */

import {
  AppSettings,
  DEFAULT_SETTINGS,
  LS_OVERLAY_CONFIG,
  LS_SETTINGS,
  LS_TASKS,
  OverlayConfig,
  Task,
} from "./types";

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(LS_TASKS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
}

export function writeOverlayConfig(cfg: OverlayConfig): void {
  localStorage.setItem(LS_OVERLAY_CONFIG, JSON.stringify(cfg));
}

export function readOverlayConfig(): OverlayConfig {
  try {
    const raw = localStorage.getItem(LS_OVERLAY_CONFIG);
    if (raw) return JSON.parse(raw) as OverlayConfig;
  } catch {
    /* ignore */
  }
  return { themeId: "cyberpunk", soundOn: true, preview: false };
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
