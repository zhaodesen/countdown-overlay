//! Beijing-time helpers mirroring `src/shared/time.ts`. All scheduling is
//! done in Beijing (UTC+8) wall-clock so behaviour is identical regardless of
//! the host machine's timezone.

use chrono::{DateTime, Datelike, FixedOffset, TimeZone};

const BEIJING_OFFSET_SECS: i32 = 8 * 3600;

fn beijing() -> FixedOffset {
    FixedOffset::east_opt(BEIJING_OFFSET_SECS).expect("UTC+8 is a valid offset")
}

/// Beijing wall-clock components of an instant.
#[derive(Debug, Clone, Copy)]
pub struct WallClock {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    /// 0 = Sunday … 6 = Saturday (matches JS `Date.getUTCDay`).
    pub weekday: u32,
}

/// Convert a real epoch-ms instant into Beijing wall-clock components.
pub fn utc_to_beijing(epoch_ms: i64) -> WallClock {
    let dt: DateTime<FixedOffset> = DateTime::from_timestamp_millis(epoch_ms)
        .unwrap_or_default()
        .with_timezone(&beijing());
    WallClock {
        year: dt.year(),
        month: dt.month(),
        day: dt.day(),
        weekday: dt.weekday().num_days_from_sunday(),
    }
}

/// Convert Beijing wall-clock components into the real epoch-ms instant.
/// Returns `None` for calendar-invalid components (e.g. Feb 30).
pub fn beijing_wall_to_epoch(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> Option<i64> {
    beijing()
        .with_ymd_and_hms(year, month, day, hour, minute, second)
        .single()
        .map(|dt| dt.timestamp_millis())
}
