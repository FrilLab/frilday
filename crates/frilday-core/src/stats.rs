use crate::{
    completion::Completion,
    date::LocalDate,
    plan::Plan,
    routine::Routine,
    schedule::is_eligible_on,
    session::Session,
    time::{ActualDuration, PlannedDuration, Timestamp},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TimeTotals {
    planned_minutes: u64,
    actual_minutes: u64,
}

impl TimeTotals {
    pub const fn planned_minutes(self) -> u64 {
        self.planned_minutes
    }

    pub const fn actual_minutes(self) -> u64 {
        self.actual_minutes
    }

    pub fn variance_minutes(self) -> i128 {
        i128::from(self.actual_minutes) - i128::from(self.planned_minutes)
    }

    pub fn planned_duration(self) -> Option<PlannedDuration> {
        u32::try_from(self.planned_minutes)
            .ok()
            .and_then(PlannedDuration::from_minutes)
    }

    pub const fn actual_duration(self) -> ActualDuration {
        ActualDuration::from_minutes(self.actual_minutes)
    }

    fn add_plan(&mut self, plan: &Plan) {
        self.planned_minutes = self
            .planned_minutes
            .saturating_add(u64::from(plan.planned_duration().minutes()));
    }

    fn add_session(&mut self, session: &Session, now: Timestamp) {
        self.actual_minutes = self
            .actual_minutes
            .saturating_add(session.actual_duration_at(now).minutes());
    }
}

/// Sum actual time for one routine on one local tracking date.
pub fn actual_minutes_for_routine(
    sessions: &[Session],
    routine_id: &crate::RoutineId,
    date: LocalDate,
    now: Timestamp,
) -> u64 {
    sessions
        .iter()
        .filter(|session| session.date() == date && session.routine_id() == Some(routine_id))
        .map(|session| session.actual_duration_at(now).minutes())
        .fold(0, u64::saturating_add)
}

pub fn aggregate_for_date(
    plans: &[Plan],
    sessions: &[Session],
    date: LocalDate,
    now: Timestamp,
) -> TimeTotals {
    let mut totals = TimeTotals::default();
    for plan in plans {
        if plan.effective_date() == date && plan.is_executable() {
            totals.add_plan(plan);
        }
    }
    for session in sessions {
        // The session's date is its local tracking date. Overnight work stays
        // on its start date, matching the desktop persistence model.
        if session.date() == date {
            totals.add_session(session, now);
        }
    }
    totals
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DailyTotals {
    date: LocalDate,
    totals: TimeTotals,
}

impl DailyTotals {
    pub const fn date(self) -> LocalDate {
        self.date
    }

    pub const fn totals(self) -> TimeTotals {
        self.totals
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeeklyTotals {
    week_start: LocalDate,
    days: Vec<DailyTotals>,
    totals: TimeTotals,
}

impl WeeklyTotals {
    pub const fn week_start(&self) -> LocalDate {
        self.week_start
    }

    pub fn days(&self) -> &[DailyTotals] {
        &self.days
    }

    pub const fn totals(&self) -> TimeTotals {
        self.totals
    }
}

pub fn aggregate_for_week(
    plans: &[Plan],
    sessions: &[Session],
    week_start: LocalDate,
    now: Timestamp,
) -> WeeklyTotals {
    let mut days = Vec::with_capacity(7);
    let mut totals = TimeTotals::default();
    for offset in 0..7 {
        let date = week_start
            .checked_add_days(offset)
            .expect("a seven-day aggregate should remain in LocalDate range");
        let day_totals = aggregate_for_date(plans, sessions, date, now);
        totals.planned_minutes = totals
            .planned_minutes
            .saturating_add(day_totals.planned_minutes);
        totals.actual_minutes = totals
            .actual_minutes
            .saturating_add(day_totals.actual_minutes);
        days.push(DailyTotals {
            date,
            totals: day_totals,
        });
    }

    WeeklyTotals {
        week_start,
        days,
        totals,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutineCategory {
    Weekday,
    Weekend,
    Daily,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompletionTotals {
    scheduled_count: u64,
    completed_count: u64,
}

impl CompletionTotals {
    pub const fn scheduled_count(self) -> u64 {
        self.scheduled_count
    }

    pub const fn completed_count(self) -> u64 {
        self.completed_count
    }

    pub fn rate(self) -> f64 {
        if self.scheduled_count == 0 {
            0.0
        } else {
            (self.completed_count as f64 * 100.0) / self.scheduled_count as f64
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeeklyCompletionStats {
    week_start: LocalDate,
    total: CompletionTotals,
    weekday: CompletionTotals,
    weekend: CompletionTotals,
    daily: CompletionTotals,
    custom: CompletionTotals,
}

impl WeeklyCompletionStats {
    pub const fn week_start(self) -> LocalDate {
        self.week_start
    }

    pub const fn total(self) -> CompletionTotals {
        self.total
    }

    pub const fn weekday(self) -> CompletionTotals {
        self.weekday
    }

    pub const fn weekend(self) -> CompletionTotals {
        self.weekend
    }

    pub const fn daily(self) -> CompletionTotals {
        self.daily
    }

    pub const fn custom(self) -> CompletionTotals {
        self.custom
    }
}

/// A routine plus the local creation date resolved by the desktop adapter.
/// The category is retained because `weekday` and a custom Monday-Friday rule
/// have the same schedule semantics but different existing statistics buckets.
#[derive(Debug, Clone, Copy)]
pub struct RoutineStatsTarget<'a> {
    pub routine: &'a Routine,
    pub created_local_date: LocalDate,
    pub category: RoutineCategory,
}

/// Calculate the existing desktop weekly completion contract: each active
/// routine contributes at most one completed item for the displayed week,
/// regardless of how many scheduled days it has in that week.
pub fn completion_stats_for_week(
    targets: &[RoutineStatsTarget<'_>],
    completions: &[Completion],
    week_start: LocalDate,
) -> WeeklyCompletionStats {
    let week_dates = date_range(
        week_start,
        week_start.checked_add_days(6).expect("week is bounded"),
    );
    let mut total = CompletionTotals::default();
    let mut weekday = CompletionTotals::default();
    let mut weekend = CompletionTotals::default();
    let mut daily = CompletionTotals::default();
    let mut custom = CompletionTotals::default();

    for target in targets.iter().filter(|target| target.routine.is_active()) {
        let completed = completions.iter().any(|completion| {
            completion.routine_id() == Some(target.routine.id())
                && week_dates.contains(&completion.date())
        });
        total = add_completion(total, completed);
        match target.category {
            RoutineCategory::Weekday => weekday = add_completion(weekday, completed),
            RoutineCategory::Weekend => weekend = add_completion(weekend, completed),
            RoutineCategory::Daily => daily = add_completion(daily, completed),
            RoutineCategory::Custom => custom = add_completion(custom, completed),
        }
    }

    WeeklyCompletionStats {
        week_start,
        total,
        weekday,
        weekend,
        daily,
        custom,
    }
}

/// Calculate scheduled-instance completion totals for an inclusive date
/// range. Start dates and archived routines are applied by the core schedule
/// rule, so historical records remain stored without becoming future plans.
pub fn completion_stats_between(
    targets: &[RoutineStatsTarget<'_>],
    completions: &[Completion],
    start: LocalDate,
    end: LocalDate,
) -> CompletionTotals {
    if end < start {
        return CompletionTotals::default();
    }

    let mut totals = CompletionTotals::default();
    for date in date_range(start, end) {
        for target in targets
            .iter()
            .filter(|target| is_eligible_on(target.routine, date, target.created_local_date))
        {
            totals.scheduled_count = totals.scheduled_count.saturating_add(1);
            if completions
                .iter()
                .any(|completion| completion.matches_routine_on(target.routine.id(), date))
            {
                totals.completed_count = totals.completed_count.saturating_add(1);
            }
        }
    }
    totals
}

fn add_completion(mut totals: CompletionTotals, completed: bool) -> CompletionTotals {
    totals.scheduled_count = totals.scheduled_count.saturating_add(1);
    if completed {
        totals.completed_count = totals.completed_count.saturating_add(1);
    }
    totals
}

fn date_range(start: LocalDate, end: LocalDate) -> Vec<LocalDate> {
    if end < start {
        return Vec::new();
    }

    let mut dates = Vec::new();
    let mut current = start;
    loop {
        dates.push(current);
        if current == end {
            break;
        }
        current = current.checked_add_days(1).expect("bounded date range");
    }
    dates
}

impl Default for CompletionTotals {
    fn default() -> Self {
        Self {
            scheduled_count: 0,
            completed_count: 0,
        }
    }
}
