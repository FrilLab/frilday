use std::collections::{BTreeMap, HashSet};

use crate::{Completion, LocalDate, Plan, PlanId, Routine, schedule::visible_dates_between};

/// A Routine paired with the local calendar date on which it was created.
/// The adapter supplies this because a timestamp alone cannot safely answer a
/// local-date scheduling question after a timezone change.
#[derive(Debug, Clone, Copy)]
pub struct RoutinePlanTarget<'a> {
    pub routine: &'a Routine,
    pub created_local_date: LocalDate,
}

/// Resolve the effective Plan for one date.
///
/// A persisted Plan always wins, including when the Routine is later archived
/// or its schedule changes. Without a persisted record, the Plan is virtual
/// and is derived from the current schedule and Routine default duration.
pub fn resolve_plan(
    target: RoutinePlanTarget<'_>,
    date: LocalDate,
    completions: &[Completion],
    persisted: Option<&Plan>,
) -> Option<Plan> {
    if let Some(plan) = persisted {
        return Some(plan.clone());
    }

    let visible = visible_dates_between(
        target.routine,
        date,
        date,
        target.created_local_date,
        completions,
    );
    visible.contains(&date).then(|| {
        // A completion can be the only evidence that a historical Plan
        // existed after a schedule/archive change. Preserve that history
        // with the Routine duration available at resolution time.
        Plan::new(
            Plan::id_for_routine(target.routine.id(), date),
            Some(target.routine.id().clone()),
            date,
            target.routine.planned_duration(),
        )
    })
}

/// Resolve all Plans in an inclusive range without producing duplicates.
/// Persisted records are included by their effective date so moved Plans are
/// still visible at their destination, while skipped Plans remain attached to
/// their original date and suppress the virtual schedule slot.
pub fn resolve_plans(
    targets: &[RoutinePlanTarget<'_>],
    persisted: &[Plan],
    completions: &[Completion],
    start: LocalDate,
    end: LocalDate,
) -> Vec<Plan> {
    if end < start {
        return Vec::new();
    }

    let target_by_routine: BTreeMap<_, _> = targets
        .iter()
        .map(|target| (target.routine.id().clone(), *target))
        .collect();
    let persisted_by_key: BTreeMap<_, _> = persisted
        .iter()
        .filter_map(|plan| {
            plan.routine_id()
                .map(|routine_id| (PlanKey(routine_id.clone(), plan.date()), plan))
        })
        .collect();
    let mut resolved = BTreeMap::<PlanId, Plan>::new();

    for target in targets {
        let mut date = start;
        loop {
            let key = PlanKey(target.routine.id().clone(), date);
            if let Some(plan) = resolve_plan(
                *target,
                date,
                completions,
                persisted_by_key.get(&key).copied(),
            ) {
                resolved.entry(plan.id().clone()).or_insert(plan);
            }
            if date == end {
                break;
            }
            date = date
                .checked_add_days(1)
                .expect("bounded plan range should remain in LocalDate range");
        }
    }

    // A moved Plan can have an origin outside the requested range. Include it
    // at the destination, but only for a known Routine so unrelated future
    // plan types do not leak into this Routine projection.
    for plan in persisted {
        let Some(routine_id) = plan.routine_id() else {
            continue;
        };
        if target_by_routine.contains_key(routine_id)
            && plan.effective_date() >= start
            && plan.effective_date() <= end
        {
            resolved
                .entry(plan.id().clone())
                .or_insert_with(|| plan.clone());
        }
    }

    let persisted_ids: HashSet<_> = persisted.iter().map(|plan| plan.id().clone()).collect();
    let mut by_effective_date = BTreeMap::<(crate::RoutineId, LocalDate), Plan>::new();
    for plan in resolved.into_values() {
        let Some(routine_id) = plan.routine_id().cloned() else {
            continue;
        };
        let key = (routine_id, plan.effective_date());
        match by_effective_date.get(&key) {
            Some(existing)
                if persisted_ids.contains(existing.id()) && !persisted_ids.contains(plan.id()) => {}
            _ => {
                by_effective_date.insert(key, plan);
            }
        }
    }
    by_effective_date.into_values().collect()
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct PlanKey(crate::RoutineId, LocalDate);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PlanStatus, PlannedDuration, RoutineId, ScheduleRule, Timestamp};

    fn routine() -> Routine {
        Routine::new(
            RoutineId::new("routine:focus").unwrap(),
            "Focus",
            "",
            PlannedDuration::from_minutes(30).unwrap(),
            ScheduleRule::Weekdays,
            Timestamp::from_unix_seconds(1_767_225_600),
        )
        .unwrap()
    }

    #[test]
    fn the_same_routine_date_always_has_one_stable_plan_id() {
        let routine = routine();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let first = Plan::from_routine(&routine, date, date).unwrap();
        let second = Plan::from_routine(&routine, date, date).unwrap();

        assert_eq!(first.id(), second.id());
        assert_eq!(first.id(), &Plan::id_for_routine(routine.id(), date));
    }

    #[test]
    fn persisted_override_wins_over_routine_changes() {
        let mut routine = routine();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let mut persisted = Plan::from_routine(&routine, date, date).unwrap();
        persisted.set_duration_override(Some(PlannedDuration::from_minutes(45).unwrap()));

        routine.set_starts_on(Some(LocalDate::parse("2026-02-01").unwrap()));
        let resolved = resolve_plan(
            RoutinePlanTarget {
                routine: &routine,
                created_local_date: date,
            },
            date,
            &[],
            Some(&persisted),
        )
        .unwrap();

        assert_eq!(resolved.planned_duration().minutes(), 45);
        assert_eq!(resolved.status(), PlanStatus::Planned);
    }

    #[test]
    fn completed_date_still_resolves_after_routine_is_archived() {
        let mut routine = routine();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let completions = vec![crate::Completion::for_routine(routine.id().clone(), date)];
        routine.archive();

        let resolved = resolve_plan(
            RoutinePlanTarget {
                routine: &routine,
                created_local_date: date,
            },
            date,
            &completions,
            None,
        )
        .unwrap();

        assert_eq!(resolved.id(), &Plan::id_for_routine(routine.id(), date));
        assert_eq!(resolved.planned_duration().minutes(), 30);
    }

    #[test]
    fn skipped_date_suppresses_the_virtual_plan_but_restore_can_return_to_it() {
        let routine = routine();
        let date = LocalDate::parse("2026-01-05").unwrap();
        let mut skipped = Plan::from_routine(&routine, date, date).unwrap();
        skipped.skip();

        assert!(
            !resolve_plan(
                RoutinePlanTarget {
                    routine: &routine,
                    created_local_date: date,
                },
                date,
                &[],
                Some(&skipped),
            )
            .unwrap()
            .is_executable()
        );

        skipped.restore();
        assert!(
            resolve_plan(
                RoutinePlanTarget {
                    routine: &routine,
                    created_local_date: date,
                },
                date,
                &[],
                Some(&skipped),
            )
            .unwrap()
            .is_executable()
        );
    }

    #[test]
    fn resolving_a_range_deduplicates_persisted_and_virtual_records() {
        let routine = routine();
        let start = LocalDate::parse("2026-01-05").unwrap();
        let end = LocalDate::parse("2026-01-05").unwrap();
        let persisted = vec![Plan::from_routine(&routine, start, start).unwrap()];
        let targets = [RoutinePlanTarget {
            routine: &routine,
            created_local_date: start,
        }];

        let plans = resolve_plans(&targets, &persisted, &[], start, end);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].id(), persisted[0].id());
    }

    #[test]
    fn moved_persisted_plan_is_projected_at_its_destination() {
        let routine = routine();
        let source = LocalDate::parse("2026-01-05").unwrap();
        let destination = LocalDate::parse("2026-01-10").unwrap();
        let mut moved = Plan::from_routine(&routine, source, source).unwrap();
        moved.move_to(destination);
        let targets = [RoutinePlanTarget {
            routine: &routine,
            created_local_date: source,
        }];

        let plans = resolve_plans(&targets, &[moved], &[], destination, destination);

        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].effective_date(), destination);
        assert_eq!(plans[0].date(), source);
    }
}
