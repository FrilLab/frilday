use crate::{
    Completion, LocalDate, Plan, RoutineId, RoutinePlanTarget, Session, Timestamp,
    planning::resolve_plans,
};

/// The transparent planned-versus-actual metrics used by Review.
///
/// Planned minutes and actual minutes are intentionally independent. Actual
/// time can exceed the plan, and a completion can exist with no tracked time.
/// `unplanned_actual_minutes` keeps legacy or ad-hoc tracking visible instead
/// of silently assigning it to a planned occurrence.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReviewTotals {
    planned_minutes: u64,
    actual_minutes: u64,
    planned_occurrences: u64,
    completed_occurrences: u64,
    unplanned_actual_minutes: u64,
}

impl ReviewTotals {
    pub const fn planned_minutes(self) -> u64 {
        self.planned_minutes
    }

    pub const fn actual_minutes(self) -> u64 {
        self.actual_minutes
    }

    pub fn variance_minutes(self) -> i128 {
        i128::from(self.actual_minutes) - i128::from(self.planned_minutes)
    }

    /// Returns `None` when there is no positive planned duration. Otherwise
    /// the ratio is the uncapped `actual / planned` value, so overtime is
    /// represented as a value greater than `1.0`.
    pub fn execution_ratio(self) -> Option<f64> {
        (self.planned_minutes > 0).then(|| self.actual_minutes as f64 / self.planned_minutes as f64)
    }

    pub const fn planned_occurrences(self) -> u64 {
        self.planned_occurrences
    }

    pub const fn completed_occurrences(self) -> u64 {
        self.completed_occurrences
    }

    pub const fn unplanned_actual_minutes(self) -> u64 {
        self.unplanned_actual_minutes
    }

    fn add_plan(&mut self, plan: &Plan, completed: bool) {
        self.planned_minutes = self
            .planned_minutes
            .saturating_add(u64::from(plan.planned_duration().minutes()));
        self.planned_occurrences = self.planned_occurrences.saturating_add(1);
        if completed {
            self.completed_occurrences = self.completed_occurrences.saturating_add(1);
        }
    }

    fn add_actual(&mut self, minutes: u64, unplanned: bool) {
        self.actual_minutes = self.actual_minutes.saturating_add(minutes);
        if unplanned {
            self.unplanned_actual_minutes = self.unplanned_actual_minutes.saturating_add(minutes);
        }
    }
}

/// Metrics for one known Routine in a review period.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutineReview {
    routine_id: RoutineId,
    totals: ReviewTotals,
}

impl RoutineReview {
    pub fn routine_id(&self) -> &RoutineId {
        &self.routine_id
    }

    pub const fn totals(&self) -> ReviewTotals {
        self.totals
    }
}

/// A date bucket in a Review period.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewDay {
    date: LocalDate,
    totals: ReviewTotals,
    routines: Vec<RoutineReview>,
}

impl ReviewDay {
    pub const fn date(&self) -> LocalDate {
        self.date
    }

    pub const fn totals(&self) -> ReviewTotals {
        self.totals
    }

    pub fn routines(&self) -> &[RoutineReview] {
        &self.routines
    }
}

/// Metrics for an inclusive period. A period also contains daily buckets so
/// weekly and future arbitrary-range clients share the same calculations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewPeriod {
    start_date: LocalDate,
    end_date: LocalDate,
    days: Vec<ReviewDay>,
    totals: ReviewTotals,
    routines: Vec<RoutineReview>,
}

impl ReviewPeriod {
    pub const fn start_date(&self) -> LocalDate {
        self.start_date
    }

    pub const fn end_date(&self) -> LocalDate {
        self.end_date
    }

    pub fn days(&self) -> &[ReviewDay] {
        &self.days
    }

    pub const fn totals(&self) -> ReviewTotals {
        self.totals
    }

    pub fn routines(&self) -> &[RoutineReview] {
        &self.routines
    }
}

/// Calculate planned-versus-actual metrics for one local date.
pub fn review_for_date(
    targets: &[RoutinePlanTarget<'_>],
    persisted_plans: &[Plan],
    completions: &[Completion],
    sessions: &[Session],
    date: LocalDate,
    now: Timestamp,
) -> ReviewDay {
    review_for_range(
        targets,
        persisted_plans,
        completions,
        sessions,
        date,
        date,
        now,
    )
    .days
    .into_iter()
    .next()
    .expect("a valid single-date review always contains one day")
}

/// Calculate planned-versus-actual metrics for a Monday-based seven-day week.
pub fn review_for_week(
    targets: &[RoutinePlanTarget<'_>],
    persisted_plans: &[Plan],
    completions: &[Completion],
    sessions: &[Session],
    week_start: LocalDate,
    now: Timestamp,
) -> ReviewPeriod {
    let week_end = week_start
        .checked_add_days(6)
        .expect("a seven-day review should remain in LocalDate range");
    review_for_range(
        targets,
        persisted_plans,
        completions,
        sessions,
        week_start,
        week_end,
        now,
    )
}

/// Calculate planned-versus-actual metrics for an inclusive local-date range.
///
/// Persisted Plans are resolved at their effective date. Skipped Plans do not
/// contribute planned minutes or planned occurrences, while Sessions tied to
/// them remain actual history and are reported as unplanned actual time.
/// Sessions without a Plan id still match an executable Routine/date Plan,
/// preserving migrated history without requiring a second statistics source.
pub fn review_for_range(
    targets: &[RoutinePlanTarget<'_>],
    persisted_plans: &[Plan],
    completions: &[Completion],
    sessions: &[Session],
    start: LocalDate,
    end: LocalDate,
    now: Timestamp,
) -> ReviewPeriod {
    let targets = unique_targets(targets);
    let dates = date_range(start, end);
    let mut states = targets
        .iter()
        .map(|target| RoutineState {
            routine_id: target.routine.id().clone(),
            plans: resolve_plans(
                std::slice::from_ref(target),
                persisted_plans,
                completions,
                start,
                end,
            ),
            totals: ReviewTotals::default(),
        })
        .collect::<Vec<_>>();
    let mut days = dates
        .iter()
        .copied()
        .map(|date| ReviewDay {
            date,
            totals: ReviewTotals::default(),
            routines: states
                .iter()
                .map(|state| RoutineReview {
                    routine_id: state.routine_id.clone(),
                    totals: ReviewTotals::default(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();

    for (routine_index, state) in states.iter_mut().enumerate() {
        for plan in &state.plans {
            if !plan.is_executable() || !date_in_range(plan.effective_date(), start, end) {
                continue;
            }

            let completed = completion_matches_plan(completions, plan);
            state.totals.add_plan(plan, completed);
            let day_index = date_index(&dates, plan.effective_date())
                .expect("an in-range Plan must have an in-range effective date");
            days[day_index].totals.add_plan(plan, completed);
            days[day_index].routines[routine_index]
                .totals
                .add_plan(plan, completed);
        }
    }

    for session in sessions
        .iter()
        .filter(|session| date_in_range(session.date(), start, end))
    {
        let actual_minutes = session.actual_duration_at(now).minutes();
        let day_index = date_index(&dates, session.date())
            .expect("a filtered Session must have an in-range date");
        let routine_index = session
            .routine_id()
            .and_then(|routine_id| {
                states
                    .iter()
                    .position(|state| state.routine_id == *routine_id)
            })
            .or_else(|| {
                session.plan_id().and_then(|plan_id| {
                    states
                        .iter()
                        .position(|state| state.plans.iter().any(|plan| plan.id() == plan_id))
                })
            });
        let assigned = states.iter().any(|state| {
            state
                .plans
                .iter()
                .any(|plan| plan.is_executable() && plan_matches_session(plan, session))
        });

        days[day_index].totals.add_actual(actual_minutes, !assigned);
        if let Some(routine_index) = routine_index {
            let routine_assigned = states[routine_index]
                .plans
                .iter()
                .any(|plan| plan.is_executable() && plan_matches_session(plan, session));
            states[routine_index]
                .totals
                .add_actual(actual_minutes, !routine_assigned);
            days[day_index].routines[routine_index]
                .totals
                .add_actual(actual_minutes, !routine_assigned);
        }
    }

    let totals = days.iter().fold(ReviewTotals::default(), |mut total, day| {
        total.merge(day.totals);
        total
    });
    let routines = states
        .into_iter()
        .map(|state| RoutineReview {
            routine_id: state.routine_id,
            totals: state.totals,
        })
        .collect();

    ReviewPeriod {
        start_date: start,
        end_date: end,
        days,
        totals,
        routines,
    }
}

#[derive(Debug)]
struct RoutineState {
    routine_id: RoutineId,
    plans: Vec<Plan>,
    totals: ReviewTotals,
}

impl ReviewTotals {
    fn merge(&mut self, other: Self) {
        self.planned_minutes = self.planned_minutes.saturating_add(other.planned_minutes);
        self.actual_minutes = self.actual_minutes.saturating_add(other.actual_minutes);
        self.planned_occurrences = self
            .planned_occurrences
            .saturating_add(other.planned_occurrences);
        self.completed_occurrences = self
            .completed_occurrences
            .saturating_add(other.completed_occurrences);
        self.unplanned_actual_minutes = self
            .unplanned_actual_minutes
            .saturating_add(other.unplanned_actual_minutes);
    }
}

fn unique_targets<'a>(targets: &[RoutinePlanTarget<'a>]) -> Vec<RoutinePlanTarget<'a>> {
    targets
        .iter()
        .copied()
        .fold(Vec::new(), |mut unique, target| {
            if unique.iter().all(|existing: &RoutinePlanTarget<'a>| {
                existing.routine.id() != target.routine.id()
            }) {
                unique.push(target);
            }
            unique
        })
}

fn plan_matches_session(plan: &Plan, session: &Session) -> bool {
    if !plan.is_executable() || plan.effective_date() != session.date() {
        return false;
    }
    if session
        .routine_id()
        .is_some_and(|routine_id| plan.routine_id() != Some(routine_id))
    {
        return false;
    }
    match session.plan_id() {
        Some(plan_id) => plan.id() == plan_id,
        None => plan.routine_id() == session.routine_id(),
    }
}

fn completion_matches_plan(completions: &[Completion], plan: &Plan) -> bool {
    completions.iter().any(|completion| {
        completion.matches_plan_on(plan.id(), plan.effective_date())
            || plan.routine_id().is_some_and(|routine_id| {
                completion.matches_routine_on(routine_id, plan.effective_date())
            })
    })
}

fn date_in_range(date: LocalDate, start: LocalDate, end: LocalDate) -> bool {
    date >= start && date <= end
}

fn date_index(dates: &[LocalDate], date: LocalDate) -> Option<usize> {
    dates.iter().position(|candidate| *candidate == date)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PlanId, PlannedDuration, Routine, ScheduleRule, SessionId, Weekday};

    fn routine(id: &str, duration_minutes: u32) -> Routine {
        Routine::new(
            RoutineId::new(id).unwrap(),
            id,
            "",
            PlannedDuration::from_minutes(duration_minutes).unwrap(),
            ScheduleRule::Weekdays,
            Timestamp::from_unix_seconds(1_767_225_600),
        )
        .unwrap()
    }

    fn target(routine: &Routine, created_local_date: LocalDate) -> RoutinePlanTarget<'_> {
        RoutinePlanTarget {
            routine,
            created_local_date,
        }
    }

    fn finished_session(
        id: &str,
        routine_id: Option<RoutineId>,
        plan_id: Option<PlanId>,
        date: LocalDate,
        start_seconds: i64,
        minutes: i64,
    ) -> Session {
        Session::new(
            SessionId::new(id).unwrap(),
            routine_id,
            plan_id,
            date,
            Timestamp::from_unix_seconds(start_seconds),
            Some(Timestamp::from_unix_seconds(start_seconds + minutes * 60)),
        )
        .unwrap()
    }

    #[test]
    fn daily_and_weekly_review_aggregate_sessions_and_keep_overtime_uncapped() {
        let routine = routine("routine:focus", 30);
        let monday = LocalDate::parse("2026-01-05").unwrap();
        let plan_id = Plan::id_for_routine(routine.id(), monday);
        let sessions = vec![
            finished_session(
                "session-1",
                Some(routine.id().clone()),
                Some(plan_id.clone()),
                monday,
                1_767_600_000,
                20,
            ),
            finished_session(
                "session-2",
                Some(routine.id().clone()),
                Some(plan_id.clone()),
                monday,
                1_767_602_000,
                40,
            ),
        ];
        let completions = vec![Completion::for_routine_and_plan(
            routine.id().clone(),
            plan_id,
            monday,
        )];
        let targets = [target(&routine, monday)];

        let daily = review_for_date(
            &targets,
            &[],
            &completions,
            &sessions,
            monday,
            Timestamp::from_unix_seconds(1_767_610_000),
        );
        let totals = daily.totals();
        assert_eq!(totals.planned_minutes(), 30);
        assert_eq!(totals.actual_minutes(), 60);
        assert_eq!(totals.variance_minutes(), 30);
        assert_eq!(totals.execution_ratio(), Some(2.0));
        assert_eq!(totals.planned_occurrences(), 1);
        assert_eq!(totals.completed_occurrences(), 1);
        assert_eq!(totals.unplanned_actual_minutes(), 0);
        assert_eq!(daily.routines()[0].totals(), totals);

        let weekly = review_for_week(
            &targets,
            &[],
            &completions,
            &sessions,
            monday,
            Timestamp::from_unix_seconds(1_767_610_000),
        );
        assert_eq!(weekly.days().len(), 7);
        assert_eq!(weekly.totals().planned_minutes(), 150);
        assert_eq!(weekly.totals().actual_minutes(), 60);
        assert_eq!(weekly.totals().planned_occurrences(), 5);
        assert_eq!(weekly.totals().completed_occurrences(), 1);
        assert_eq!(weekly.routines()[0].totals(), weekly.totals());
    }

    #[test]
    fn skipped_and_moved_plans_are_explicit_without_losing_actual_history() {
        let routine = routine("routine:adjust", 30);
        let monday = LocalDate::parse("2026-01-05").unwrap();
        let tuesday = monday.checked_add_days(1).unwrap();
        let thursday = monday.checked_add_days(3).unwrap();
        let friday = monday.checked_add_days(4).unwrap();
        let mut skipped = Plan::from_routine(&routine, monday, monday).unwrap();
        skipped.skip();
        let mut moved = Plan::from_routine(&routine, tuesday, monday).unwrap();
        moved.move_to(thursday);
        let completions = vec![
            Completion::for_routine_and_plan(routine.id().clone(), skipped.id().clone(), monday),
            Completion::for_routine_and_plan(routine.id().clone(), moved.id().clone(), thursday),
        ];
        let sessions = vec![
            finished_session(
                "session-skipped",
                Some(routine.id().clone()),
                Some(skipped.id().clone()),
                monday,
                1_767_600_000,
                10,
            ),
            finished_session(
                "session-moved",
                Some(routine.id().clone()),
                Some(moved.id().clone()),
                thursday,
                1_767_602_000,
                25,
            ),
            // Legacy sessions have no Plan association. The executable
            // Friday Routine/date occurrence still receives the actual time.
            finished_session(
                "session-legacy",
                Some(routine.id().clone()),
                None,
                friday,
                1_767_604_000,
                15,
            ),
        ];
        let targets = [target(&routine, monday)];

        let review = review_for_week(
            &targets,
            &[skipped, moved],
            &completions,
            &sessions,
            monday,
            Timestamp::from_unix_seconds(1_767_610_000),
        );
        let totals = review.totals();
        assert_eq!(totals.planned_minutes(), 90);
        assert_eq!(totals.actual_minutes(), 50);
        assert_eq!(totals.variance_minutes(), -40);
        assert_eq!(totals.planned_occurrences(), 3);
        assert_eq!(totals.completed_occurrences(), 1);
        assert_eq!(totals.unplanned_actual_minutes(), 10);
        assert_eq!(review.routines()[0].totals(), totals);
    }

    #[test]
    fn zero_plan_is_not_reported_as_a_percentage_and_ad_hoc_time_remains_visible() {
        let routine = routine("routine:weekday", 30);
        let saturday = LocalDate::parse("2026-01-10").unwrap();
        let sessions = [finished_session(
            "session-ad-hoc",
            Some(routine.id().clone()),
            None,
            saturday,
            1_767_600_000,
            25,
        )];
        let review = review_for_date(
            &[target(&routine, saturday)],
            &[],
            &[],
            &sessions,
            saturday,
            Timestamp::from_unix_seconds(1_767_610_000),
        );

        assert_eq!(review.totals().planned_minutes(), 0);
        assert_eq!(review.totals().actual_minutes(), 25);
        assert_eq!(review.totals().variance_minutes(), 25);
        assert_eq!(review.totals().execution_ratio(), None);
        assert_eq!(review.totals().planned_occurrences(), 0);
        assert_eq!(review.totals().unplanned_actual_minutes(), 25);
    }

    #[test]
    fn archived_routines_keep_persisted_history_in_review() {
        let mut routine = routine("routine:archived", 45);
        let monday = LocalDate::parse("2026-01-05").unwrap();
        let plan = Plan::from_routine(&routine, monday, monday).unwrap();
        routine.archive();
        let session = finished_session(
            "session-archived",
            Some(routine.id().clone()),
            Some(plan.id().clone()),
            monday,
            1_767_600_000,
            20,
        );
        let completion = Completion::for_routine(routine.id().clone(), monday);

        let review = review_for_date(
            &[target(&routine, monday)],
            &[plan],
            &[completion],
            &[session],
            monday,
            Timestamp::from_unix_seconds(1_767_610_000),
        );
        assert_eq!(review.totals().planned_minutes(), 45);
        assert_eq!(review.totals().actual_minutes(), 20);
        assert_eq!(review.totals().completed_occurrences(), 1);
        assert_eq!(review.routines()[0].routine_id(), routine.id());
    }

    #[test]
    fn deterministic_plan_completion_can_restore_a_virtual_historical_plan() {
        let routine = routine("routine:plan-only", 30);
        let monday = LocalDate::parse("2026-01-05").unwrap();
        let completion = Completion::for_plan(Plan::id_for_routine(routine.id(), monday), monday);

        let review = review_for_date(
            &[target(&routine, monday)],
            &[],
            &[completion],
            &[],
            monday,
            Timestamp::from_unix_seconds(1_767_610_000),
        );

        assert_eq!(review.totals().planned_occurrences(), 1);
        assert_eq!(review.totals().completed_occurrences(), 1);
        assert_eq!(review.totals().actual_minutes(), 0);
    }

    #[test]
    fn empty_or_reversed_ranges_have_no_buckets_but_remain_safe() {
        let routine = routine("routine:empty", 30);
        let start = LocalDate::parse("2026-01-06").unwrap();
        let end = LocalDate::parse("2026-01-05").unwrap();
        let review = review_for_range(
            &[target(&routine, start)],
            &[],
            &[],
            &[],
            start,
            end,
            Timestamp::from_unix_seconds(1_767_610_000),
        );

        assert!(review.days().is_empty());
        assert_eq!(review.totals(), ReviewTotals::default());
        assert_eq!(review.routines().len(), 1);
        assert_eq!(Weekday::Tue, start.weekday());
    }
}
