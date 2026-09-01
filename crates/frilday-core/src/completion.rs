use crate::{
    date::LocalDate,
    ids::{PlanId, RoutineId},
};

/// Completion is a binary signal. It is intentionally not derived from, or
/// required by, tracked Session time.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Completion {
    routine_id: Option<RoutineId>,
    plan_id: Option<PlanId>,
    date: LocalDate,
}

impl Completion {
    pub fn for_routine(routine_id: RoutineId, date: LocalDate) -> Self {
        Self {
            routine_id: Some(routine_id),
            plan_id: None,
            date,
        }
    }

    pub fn for_plan(plan_id: PlanId, date: LocalDate) -> Self {
        Self {
            routine_id: None,
            plan_id: Some(plan_id),
            date,
        }
    }

    pub fn for_routine_and_plan(routine_id: RoutineId, plan_id: PlanId, date: LocalDate) -> Self {
        Self {
            routine_id: Some(routine_id),
            plan_id: Some(plan_id),
            date,
        }
    }

    pub fn routine_id(&self) -> Option<&RoutineId> {
        self.routine_id.as_ref()
    }

    pub fn plan_id(&self) -> Option<&PlanId> {
        self.plan_id.as_ref()
    }

    pub const fn date(&self) -> LocalDate {
        self.date
    }

    pub fn belongs_to_routine(&self, routine_id: &RoutineId) -> bool {
        self.routine_id.as_ref() == Some(routine_id)
    }

    pub fn matches_routine_on(&self, routine_id: &RoutineId, date: LocalDate) -> bool {
        self.belongs_to_routine(routine_id) && self.date == date
    }

    pub fn matches_plan_on(&self, plan_id: &PlanId, date: LocalDate) -> bool {
        self.plan_id.as_ref() == Some(plan_id) && self.date == date
    }
}

pub fn is_completed_on(
    completions: &[Completion],
    routine_id: &RoutineId,
    date: LocalDate,
) -> bool {
    completions
        .iter()
        .any(|completion| completion.matches_routine_on(routine_id, date))
}

/// Toggles a routine/date completion while preserving unrelated records and
/// preventing duplicate completion records.
pub fn toggle_routine_completion(
    completions: &[Completion],
    routine_id: RoutineId,
    date: LocalDate,
) -> Vec<Completion> {
    if is_completed_on(completions, &routine_id, date) {
        completions
            .iter()
            .filter(|completion| !completion.matches_routine_on(&routine_id, date))
            .cloned()
            .collect()
    } else {
        let mut next = completions.to_vec();
        next.push(Completion::for_routine(routine_id, date));
        next
    }
}

pub fn is_completed_for_plan(
    completions: &[Completion],
    plan_id: &PlanId,
    date: LocalDate,
) -> bool {
    completions
        .iter()
        .any(|completion| completion.matches_plan_on(plan_id, date))
}

pub fn toggle_plan_completion(
    completions: &[Completion],
    plan_id: PlanId,
    date: LocalDate,
) -> Vec<Completion> {
    if is_completed_for_plan(completions, &plan_id, date) {
        completions
            .iter()
            .filter(|completion| !completion.matches_plan_on(&plan_id, date))
            .cloned()
            .collect()
    } else {
        let mut next = completions.to_vec();
        next.push(Completion::for_plan(plan_id, date));
        next
    }
}

pub fn completion_count_for_routine(completions: &[Completion], routine_id: &RoutineId) -> usize {
    completions
        .iter()
        .filter(|completion| completion.belongs_to_routine(routine_id))
        .map(Completion::date)
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}
