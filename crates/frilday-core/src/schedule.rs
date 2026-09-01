use std::fmt;

use crate::{
    Weekday,
    completion::{Completion, completion_count_for_routine},
    date::LocalDate,
    routine::Routine,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScheduleError {
    EmptyCustomSchedule,
}

impl fmt::Display for ScheduleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a custom schedule must contain at least one day")
    }
}

impl std::error::Error for ScheduleError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomSchedule {
    days: Vec<Weekday>,
}

impl CustomSchedule {
    pub fn new(days: impl IntoIterator<Item = Weekday>) -> Result<Self, ScheduleError> {
        let mut days = days.into_iter().peekable();
        if days.peek().is_none() {
            return Err(ScheduleError::EmptyCustomSchedule);
        }

        let mut selected = Vec::new();
        for day in days {
            if !selected.contains(&day) {
                selected.push(day);
            }
        }
        selected.sort_unstable();
        Ok(Self { days: selected })
    }

    pub fn days(&self) -> &[Weekday] {
        &self.days
    }

    fn contains(&self, weekday: Weekday) -> bool {
        self.days.contains(&weekday)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScheduleRule {
    Weekdays,
    Weekends,
    Daily,
    Custom(CustomSchedule),
}

impl ScheduleRule {
    pub fn custom(days: impl IntoIterator<Item = Weekday>) -> Result<Self, ScheduleError> {
        Ok(Self::Custom(CustomSchedule::new(days)?))
    }

    pub fn matches(&self, weekday: Weekday) -> bool {
        match self {
            Self::Weekdays => weekday.is_weekday(),
            Self::Weekends => !weekday.is_weekday(),
            Self::Daily => true,
            Self::Custom(days) => days.contains(weekday),
        }
    }

    pub fn days(&self) -> Vec<Weekday> {
        match self {
            Self::Weekdays => Weekday::ALL[..5].to_vec(),
            Self::Weekends => Weekday::ALL[5..].to_vec(),
            Self::Daily => Weekday::ALL.to_vec(),
            Self::Custom(days) => days.days().to_vec(),
        }
    }
}

/// Returns the first date on which a routine may be scheduled. The adapter
/// supplies the local date corresponding to the routine's creation timestamp.
pub fn effective_start_on(routine: &Routine, created_local_date: LocalDate) -> LocalDate {
    routine
        .starts_on()
        .filter(|start| *start > created_local_date)
        .unwrap_or(created_local_date)
}

pub fn is_eligible_on(routine: &Routine, date: LocalDate, created_local_date: LocalDate) -> bool {
    routine.is_active()
        && date >= effective_start_on(routine, created_local_date)
        && routine.schedule().matches(date.weekday())
}

pub fn eligible_dates_between(
    routine: &Routine,
    start: LocalDate,
    end: LocalDate,
    created_local_date: LocalDate,
) -> Vec<LocalDate> {
    if end < start {
        return Vec::new();
    }

    let mut dates = Vec::new();
    let mut current = start;
    loop {
        if is_eligible_on(routine, current, created_local_date) {
            dates.push(current);
        }
        if current == end {
            break;
        }
        current = current
            .checked_add_days(1)
            .expect("bounded date range should remain in LocalDate range");
    }
    dates
}

/// Selects visible planned dates for a period, preserving completed history.
/// `occurrence_limit` is a lifetime cap, matching the existing desktop
/// `repeatCount` behavior; it is not a weekly recurrence count.
pub fn visible_dates_between(
    routine: &Routine,
    start: LocalDate,
    end: LocalDate,
    created_local_date: LocalDate,
    completions: &[Completion],
) -> Vec<LocalDate> {
    if end < start {
        return Vec::new();
    }

    let cutoff = effective_start_on(routine, created_local_date);
    let period_dates = date_range(start, end);
    let scheduled = eligible_dates_between(routine, start, end, created_local_date);
    let completed_in_period: Vec<_> = period_dates
        .iter()
        .copied()
        .filter(|date| *date >= cutoff && is_completed_on(completions, routine, *date))
        .collect();

    let Some(limit) = routine.occurrence_limit() else {
        return merge_dates(period_dates, cutoff, scheduled, completed_in_period);
    };

    let completed_total = completion_count_for_routine(completions, routine.id());
    let completed_total = u32::try_from(completed_total).unwrap_or(u32::MAX);
    let remaining = limit.saturating_sub(completed_total);
    if remaining == 0 {
        return completed_in_period;
    }

    let queued: Vec<_> = scheduled
        .into_iter()
        .filter(|date| !completed_in_period.contains(date))
        .take(remaining as usize)
        .collect();
    merge_dates(period_dates, cutoff, queued, completed_in_period)
}

fn merge_dates(
    period_dates: Vec<LocalDate>,
    cutoff: LocalDate,
    first: Vec<LocalDate>,
    second: Vec<LocalDate>,
) -> Vec<LocalDate> {
    period_dates
        .into_iter()
        .filter(|date| *date >= cutoff && (first.contains(date) || second.contains(date)))
        .collect()
}

fn date_range(start: LocalDate, end: LocalDate) -> Vec<LocalDate> {
    let mut dates = Vec::new();
    let mut current = start;
    loop {
        dates.push(current);
        if current == end {
            break;
        }
        current = current
            .checked_add_days(1)
            .expect("bounded date range should remain in LocalDate range");
    }
    dates
}

fn is_completed_on(completions: &[Completion], routine: &Routine, date: LocalDate) -> bool {
    completions
        .iter()
        .any(|completion| completion.matches_routine_on(routine.id(), date))
}
