use std::{fmt, num::NonZeroU32};

/// Planned time is deliberately distinct from actual tracked time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PlannedDuration(NonZeroU32);

impl PlannedDuration {
    pub fn from_minutes(minutes: u32) -> Option<Self> {
        NonZeroU32::new(minutes).map(Self)
    }

    pub const fn minutes(self) -> u32 {
        self.0.get()
    }
}

/// Actual time is derived from session timestamps and is allowed to exceed
/// the planned duration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct ActualDuration(u64);

impl ActualDuration {
    pub const fn zero() -> Self {
        Self(0)
    }

    pub const fn from_minutes(minutes: u64) -> Self {
        Self(minutes)
    }

    pub const fn minutes(self) -> u64 {
        self.0
    }

    pub fn saturating_add(self, other: Self) -> Self {
        Self(self.0.saturating_add(other.0))
    }
}

/// An instant represented as Unix milliseconds.
///
/// Parsing and formatting a timestamp belongs to a delivery adapter. Keeping
/// the core representation numeric makes elapsed-time calculations explicit,
/// deterministic, and independent of a date/time or persistence library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Timestamp(i64);

impl Timestamp {
    pub const fn from_unix_millis(millis: i64) -> Self {
        Self(millis)
    }

    pub const fn from_unix_seconds(seconds: i64) -> Self {
        Self(seconds.saturating_mul(1_000))
    }

    pub const fn unix_millis(self) -> i64 {
        self.0
    }

    pub fn elapsed_millis_until(self, end: Self) -> u64 {
        end.0.saturating_sub(self.0).max(0) as u64
    }

    pub fn elapsed_minutes_until(self, end: Self) -> ActualDuration {
        let elapsed_millis = self.elapsed_millis_until(end);
        ActualDuration::from_minutes(elapsed_millis / 60_000)
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}
