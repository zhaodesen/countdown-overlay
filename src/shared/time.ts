/**
 * Beijing-time helpers. All scheduling is done in Beijing (UTC+8) wall-clock
 * so behaviour is identical regardless of the host machine's timezone.
 */

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
}

/** Current Beijing wall-clock, derived from the real UTC instant. */
export function beijingNow(): WallClock {
  return utcToBeijing(Date.now());
}

/** Convert a real epoch-ms instant into Beijing wall-clock components. */
export function utcToBeijing(epochMs: number): WallClock {
  const d = new Date(epochMs + BEIJING_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

/**
 * Convert Beijing wall-clock components into the real epoch-ms instant.
 * (A Beijing wall time T corresponds to UTC = T − 8h.)
 */
export function beijingWallToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) - BEIJING_OFFSET_MS;
}

/** Weekday (0=Sun…6=Sat) for a Beijing calendar date. */
export function beijingWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "2026年06月25日 周四 13:09:07" */
export function formatClock(w: WallClock): string {
  const wk = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][w.weekday];
  return (
    `${w.year}年${pad(w.month)}月${pad(w.day)}日 ${wk} ` +
    `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`
  );
}

/** "06-25 13:09:07" compact form for the task list. */
export function formatTaskTime(t: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): string {
  return (
    `${pad(t.month)}-${pad(t.day)} ` +
    `${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`
  );
}

/** Default new-task time: Beijing now + 1 minute. */
export function defaultTaskTime(): WallClock {
  return utcToBeijing(Date.now() + 60_000);
}

/** Parse an "<input type=datetime-local step=1>" value as Beijing wall-clock. */
export function parseDatetimeLocal(value: string): WallClock | null {
  // Format: YYYY-MM-DDTHH:MM[:SS]
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return {
    year: +y,
    month: +mo,
    day: +d,
    hour: +h,
    minute: +mi,
    second: s ? +s : 0,
    weekday: beijingWeekday(+y, +mo, +d),
  };
}

/** Build a datetime-local input value from wall-clock components. */
export function toDatetimeLocal(w: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): string {
  return (
    `${w.year}-${pad(w.month)}-${pad(w.day)}T` +
    `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`
  );
}

/**
 * Compute the next fire instant (epoch ms) for a task, given "now".
 * The overlay should appear `lead` seconds BEFORE the target time so the
 * 5→1 countdown ends exactly at the target.
 *
 * - once   : if the target is in the past, returns the past instant (caller
 *            decides whether to fire / disable).
 * - repeat : finds the next selected weekday whose time-of-day is still ahead.
 */
export function nextFireEpoch(
  task: {
    type: "once" | "repeat";
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    weekdays: number[];
  },
  lead: number,
  nowMs: number
): number | null {
  if (task.type === "once") {
    return (
      beijingWallToEpoch(
        task.year,
        task.month,
        task.day,
        task.hour,
        task.minute,
        task.second
      ) -
      lead * 1000
    );
  }

  // repeat: search the next 8 days for a matching weekday + time.
  if (!task.weekdays.length) return null;
  const base = utcToBeijing(nowMs);
  for (let offset = 0; offset < 8; offset++) {
    const probe = utcToBeijing(
      beijingWallToEpoch(base.year, base.month, base.day, 0, 0, 0) +
        offset * 86_400_000
    );
    if (!task.weekdays.includes(probe.weekday)) continue;
    const fireAt =
      beijingWallToEpoch(
        probe.year,
        probe.month,
        probe.day,
        task.hour,
        task.minute,
        task.second
      ) -
      lead * 1000;
    if (fireAt > nowMs - 1500) return fireAt;
  }
  return null;
}
