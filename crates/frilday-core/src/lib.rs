//! Reusable FrilDay business rules.
//!
//! This crate contains date, schedule, planning, completion, session, and
//! planned-versus-actual aggregation rules. It intentionally has no runtime,
//! UI, transport, or persistence dependencies.

pub mod completion;
pub mod date;
pub mod ids;
pub mod plan;
pub mod routine;
pub mod schedule;
pub mod session;
pub mod stats;
pub mod time;
pub mod timer;

pub use completion::{
    Completion, completion_count_for_routine, is_completed_for_plan, is_completed_on,
    toggle_plan_completion, toggle_routine_completion,
};
pub use date::{DateError, LocalDate, Weekday};
pub use ids::{IdError, PlanId, RoutineId, SessionId};
pub use plan::{Plan, PlanStatus};
pub use routine::{Routine, RoutineError};
pub use schedule::{
    CustomSchedule, ScheduleError, ScheduleRule, completed_dates_between, effective_start_on,
    eligible_dates_between, is_eligible_on, visible_dates_between,
};
pub use session::{
    Session, SessionError, SessionLedger, running_routine_id, running_session, start_session,
    stop_session_for_routine, validate_no_concurrent_sessions,
};
pub use stats::{
    CompletionTotals, DailyTotals, RoutineCategory, RoutineStatsTarget, TimeTotals,
    WeeklyCompletionStats, WeeklyTotals, actual_minutes_for_routine, aggregate_for_date,
    aggregate_for_week, completion_stats_between, completion_stats_for_week,
};
pub use time::{ActualDuration, PlannedDuration, Timestamp};
pub use timer::{TargetReachedSession, target_reached_sessions_at};

#[cfg(test)]
mod tests {
    use super::*;

    fn routine() -> Routine {
        Routine::new(
            RoutineId::new("routine-1").unwrap(),
            "Focus",
            "",
            PlannedDuration::from_minutes(30).unwrap(),
            ScheduleRule::Weekdays,
            Timestamp::from_unix_seconds(1_767_225_600),
        )
        .unwrap()
    }

    #[test]
    fn routine_schedule_respects_start_date_and_archiving() {
        let mut routine = routine();
        let created = LocalDate::parse("2026-01-01").unwrap();
        let monday = LocalDate::parse("2026-01-05").unwrap();
        assert!(is_eligible_on(&routine, monday, created));

        routine.set_starts_on(Some(LocalDate::parse("2025-12-01").unwrap()));
        assert_eq!(effective_start_on(&routine, created), created);

        let mut archived = routine.clone();
        archived.archive();
        assert!(!is_eligible_on(&archived, monday, created));
    }

    #[test]
    fn visible_schedule_applies_lifetime_occurrence_limit_and_keeps_history() {
        let mut routine = routine();
        routine.set_occurrence_limit(Some(2)).unwrap();
        let created = LocalDate::parse("2026-01-01").unwrap();
        let monday = LocalDate::parse("2026-01-05").unwrap();
        let completions = vec![Completion::for_routine(routine.id().clone(), monday)];

        assert_eq!(
            visible_dates_between(
                &routine,
                monday,
                monday.checked_add_days(6).unwrap(),
                created,
                &completions,
            ),
            vec![monday, monday.checked_add_days(1).unwrap()]
        );
    }

    #[test]
    fn schedule_start_after_week_beginning_excludes_earlier_weekdays() {
        let mut routine = routine();
        routine.set_starts_on(Some(LocalDate::parse("2026-01-08").unwrap()));
        let week_start = LocalDate::parse("2026-01-05").unwrap();

        assert_eq!(
            visible_dates_between(
                &routine,
                week_start,
                week_start.checked_add_days(6).unwrap(),
                LocalDate::parse("2026-01-01").unwrap(),
                &[],
            ),
            vec![
                LocalDate::parse("2026-01-08").unwrap(),
                LocalDate::parse("2026-01-09").unwrap()
            ]
        );
    }

    #[test]
    fn custom_schedule_requires_a_day_and_normalizes_duplicates() {
        assert_eq!(
            ScheduleRule::custom([Weekday::Fri, Weekday::Mon, Weekday::Fri])
                .unwrap()
                .days(),
            vec![Weekday::Mon, Weekday::Fri]
        );
        assert_eq!(
            ScheduleRule::custom(std::iter::empty()),
            Err(ScheduleError::EmptyCustomSchedule)
        );
    }

    #[test]
    fn completion_is_independent_from_session_time() {
        let routine = routine();
        let routine_id = routine.id().clone();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let completions = toggle_routine_completion(&[], routine_id.clone(), date);
        assert!(is_completed_on(&completions, &routine_id, date));
        assert_eq!(completions[0].date(), date);
    }

    #[test]
    fn running_session_duration_is_derived_and_overtime_is_preserved() {
        let date = LocalDate::parse("2026-01-05").unwrap();
        let routine_id = RoutineId::new("routine-1").unwrap();
        let start = Timestamp::from_unix_seconds(1_767_600_000);
        let end = Timestamp::from_unix_seconds(1_767_605_400);
        let mut session = Session::start(
            SessionId::new("session-1").unwrap(),
            Some(routine_id),
            None,
            date,
            start,
        )
        .unwrap();
        assert_eq!(session.actual_duration_at(end).minutes(), 90);
        assert_eq!(session.stop(end).unwrap().minutes(), 90);
    }

    #[test]
    fn only_one_running_session_is_allowed() {
        let date = LocalDate::parse("2026-01-05").unwrap();
        let routine_id = RoutineId::new("routine-1").unwrap();
        let first = Session::start(
            SessionId::new("session-1").unwrap(),
            Some(routine_id.clone()),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_000),
        )
        .unwrap();
        let second = Session::start(
            SessionId::new("session-2").unwrap(),
            Some(routine_id),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_060),
        )
        .unwrap();
        assert_eq!(
            validate_no_concurrent_sessions(&[first, second]),
            Err(SessionError::MultipleRunningSessions)
        );
    }

    #[test]
    fn daily_and_weekly_totals_keep_planned_and_actual_separate() {
        let routine = routine();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let plan = Plan::new(
            PlanId::new("plan-1").unwrap(),
            Some(routine.id().clone()),
            date,
            routine.planned_duration(),
        );
        let session = Session::new(
            SessionId::new("session-1").unwrap(),
            Some(routine.id().clone()),
            Some(plan.id().clone()),
            date,
            Timestamp::from_unix_seconds(1_767_600_000),
            Some(Timestamp::from_unix_seconds(1_767_605_400)),
        )
        .unwrap();
        let totals = aggregate_for_date(
            &[plan],
            &[session],
            date,
            Timestamp::from_unix_seconds(1_767_610_000),
        );
        assert_eq!(totals.planned_minutes(), 30);
        assert_eq!(totals.actual_minutes(), 90);
        assert_eq!(totals.variance_minutes(), 60);
    }

    #[test]
    fn plan_override_and_status_do_not_change_the_routine() {
        let routine = routine();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let moved_date = LocalDate::parse("2026-01-06").unwrap();
        let mut plan = Plan::new(
            PlanId::new("plan-1").unwrap(),
            Some(routine.id().clone()),
            date,
            routine.planned_duration(),
        );

        plan.set_duration_override(Some(PlannedDuration::from_minutes(45).unwrap()));
        assert_eq!(plan.planned_duration().minutes(), 45);
        plan.move_to(moved_date);
        assert_eq!(plan.effective_date(), moved_date);
        plan.skip();
        assert!(!plan.is_executable());
        assert_eq!(routine.planned_duration().minutes(), 30);
    }

    #[test]
    fn completion_toggle_supports_plan_keys_without_touching_routine_keys() {
        let routine_id = RoutineId::new("routine-1").unwrap();
        let plan_id = PlanId::new("plan-1").unwrap();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let initial = vec![Completion::for_routine(routine_id.clone(), date)];
        let next = toggle_plan_completion(&initial, plan_id.clone(), date);
        assert!(is_completed_on(&next, &routine_id, date));
        assert!(is_completed_for_plan(&next, &plan_id, date));
        assert_eq!(toggle_plan_completion(&next, plan_id, date).len(), 1);
    }

    #[test]
    fn session_ledger_enforces_unique_ids_and_one_running_session() {
        let date = LocalDate::parse("2026-01-05").unwrap();
        let routine_id = RoutineId::new("routine-1").unwrap();
        let first = Session::start(
            SessionId::new("session-1").unwrap(),
            Some(routine_id.clone()),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_000),
        )
        .unwrap();
        let mut ledger = SessionLedger::default();
        ledger.start(first.clone()).unwrap();
        assert_eq!(ledger.start(first), Err(SessionError::DuplicateSessionId));

        let second = Session::start(
            SessionId::new("session-2").unwrap(),
            Some(routine_id),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_060),
        )
        .unwrap();
        assert_eq!(
            ledger.start(second),
            Err(SessionError::MultipleRunningSessions)
        );
        assert!(SessionLedger::default().active().is_none());
        assert!(PlannedDuration::from_minutes(0).is_none());
    }

    #[test]
    fn completed_history_survives_schedule_changes_and_archiving() {
        let mut routine = routine();
        let created = LocalDate::parse("2026-01-01").unwrap();
        let saturday = LocalDate::parse("2026-01-10").unwrap();
        let completions = vec![Completion::for_routine(routine.id().clone(), saturday)];

        routine.archive();
        assert_eq!(
            visible_dates_between(&routine, saturday, saturday, created, &completions,),
            vec![saturday]
        );
    }

    #[test]
    fn starting_a_timer_closes_the_other_running_session() {
        let date = LocalDate::parse("2026-01-05").unwrap();
        let first = Session::start(
            SessionId::new("session-1").unwrap(),
            Some(RoutineId::new("routine-1").unwrap()),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_000),
        )
        .unwrap();
        let second = Session::start(
            SessionId::new("session-2").unwrap(),
            Some(RoutineId::new("routine-2").unwrap()),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_060),
        )
        .unwrap();

        let next = start_session(
            &[first],
            second,
            Timestamp::from_unix_seconds(1_767_600_060),
        )
        .unwrap();
        assert_eq!(
            next.iter().filter(|session| session.is_running()).count(),
            1
        );
        assert_eq!(
            next[0].actual_duration_at(next[1].started_at()).minutes(),
            1
        );
    }

    #[test]
    fn target_reached_is_read_only_and_preserves_overtime() {
        let routine = routine();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let session = Session::start(
            SessionId::new("session-1").unwrap(),
            Some(routine.id().clone()),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_000),
        )
        .unwrap();
        let reached = target_reached_sessions_at(
            std::slice::from_ref(&session),
            std::slice::from_ref(&routine),
            Timestamp::from_unix_seconds(1_767_603_600),
        )
        .unwrap();

        assert_eq!(reached.len(), 1);
        assert_eq!(reached[0].actual_minutes(), 60);
        assert_eq!(reached[0].planned_minutes(), 30);
        assert!(session.is_running());
        assert_eq!(
            session
                .actual_duration_at(Timestamp::from_unix_seconds(1_767_603_600))
                .minutes(),
            60
        );

        let previous = Session::new(
            SessionId::new("session-previous").unwrap(),
            Some(routine.id().clone()),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_600_000),
            Some(Timestamp::from_unix_seconds(1_767_601_800)),
        )
        .unwrap();
        let resumed = Session::start(
            SessionId::new("session-resumed").unwrap(),
            Some(routine.id().clone()),
            None,
            date,
            Timestamp::from_unix_seconds(1_767_602_000),
        )
        .unwrap();
        assert!(
            target_reached_sessions_at(
                &[previous, resumed],
                std::slice::from_ref(&routine),
                Timestamp::from_unix_seconds(1_767_602_000),
            )
            .unwrap()
            .is_empty()
        );
    }

    #[test]
    fn completion_statistics_keep_category_buckets_and_start_cutoffs() {
        let routine = routine();
        let created = LocalDate::parse("2026-01-01").unwrap();
        let monday = LocalDate::parse("2026-01-05").unwrap();
        let completions = vec![Completion::for_routine(routine.id().clone(), monday)];
        let targets = [RoutineStatsTarget {
            routine: &routine,
            created_local_date: created,
            category: RoutineCategory::Weekday,
        }];

        let weekly = completion_stats_for_week(&targets, &completions, monday);
        assert_eq!(weekly.total().rate(), 100.0);
        assert_eq!(weekly.weekday().completed_count(), 1);
        assert_eq!(
            completion_stats_between(&targets, &completions, monday, monday).rate(),
            100.0
        );
    }
}
