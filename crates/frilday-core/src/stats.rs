use crate::{
    date::LocalDate,
    plan::Plan,
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
