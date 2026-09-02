use std::fmt;

use crate::{
    completion::Completion,
    date::LocalDate,
    ids::{PlanId, RoutineId},
    routine::Routine,
    session::Session,
    time::PlannedDuration,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanError {
    MissingRoutine,
    InvalidDuration,
}

impl fmt::Display for PlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::MissingRoutine => "a persisted plan must identify its routine",
            Self::InvalidDuration => "a persisted plan duration must be positive",
        })
    }
}

impl std::error::Error for PlanError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanStatus {
    Planned,
    Skipped,
    MovedTo(LocalDate),
}

/// A Plan is the date-specific intention. It is separate from a reusable
/// Routine and from the Sessions that record actual work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    id: PlanId,
    routine_id: Option<RoutineId>,
    date: LocalDate,
    planned_duration: PlannedDuration,
    duration_override: Option<PlannedDuration>,
    status: PlanStatus,
}

impl Plan {
    pub fn new(
        id: PlanId,
        routine_id: Option<RoutineId>,
        date: LocalDate,
        planned_duration: PlannedDuration,
    ) -> Self {
        Self {
            id,
            routine_id,
            date,
            planned_duration,
            duration_override: None,
            status: PlanStatus::Planned,
        }
    }

    /// Build the stable identity used by a Routine-derived Plan.
    ///
    /// The length prefix keeps the mapping injective even when a caller uses
    /// `:` in a Routine id. The id is deterministic, so resolving the same
    /// Routine/date pair after a reload cannot create a second Plan.
    pub fn id_for_routine(routine_id: &RoutineId, date: LocalDate) -> PlanId {
        PlanId::new(format!(
            "routine-plan:{}:{}:{}",
            routine_id.as_str().len(),
            routine_id,
            date
        ))
        .expect("the deterministic plan id is never empty")
    }

    /// Materialize a Routine-derived Plan when the date is currently
    /// scheduled. This constructor is used by the virtual-resolution path;
    /// persistence is deliberately owned by the adapter.
    pub fn from_routine(
        routine: &Routine,
        date: LocalDate,
        created_local_date: LocalDate,
    ) -> Option<Self> {
        crate::schedule::is_eligible_on(routine, date, created_local_date).then(|| {
            Self::new(
                Self::id_for_routine(routine.id(), date),
                Some(routine.id().clone()),
                date,
                routine.planned_duration(),
            )
        })
    }

    /// Rehydrate a Plan stored by an adapter. Plan records are snapshots and
    /// therefore do not consult the current Routine schedule.
    pub fn from_persisted(
        id: PlanId,
        routine_id: Option<RoutineId>,
        date: LocalDate,
        baseline_duration: PlannedDuration,
        duration_override: Option<PlannedDuration>,
        status: PlanStatus,
    ) -> Result<Self, PlanError> {
        if routine_id.is_none() {
            return Err(PlanError::MissingRoutine);
        }
        if duration_override.is_some_and(|duration| duration.minutes() == 0) {
            return Err(PlanError::InvalidDuration);
        }
        Ok(Self {
            id,
            routine_id,
            date,
            planned_duration: baseline_duration,
            duration_override,
            status,
        })
    }

    pub fn id(&self) -> &PlanId {
        &self.id
    }

    pub fn routine_id(&self) -> Option<&RoutineId> {
        self.routine_id.as_ref()
    }

    pub const fn date(&self) -> LocalDate {
        self.date
    }

    pub const fn planned_duration(&self) -> PlannedDuration {
        match self.duration_override {
            Some(duration) => duration,
            None => self.planned_duration,
        }
    }

    pub const fn baseline_duration(&self) -> PlannedDuration {
        self.planned_duration
    }

    pub const fn duration_override(&self) -> Option<PlannedDuration> {
        self.duration_override
    }

    pub const fn status(&self) -> PlanStatus {
        self.status
    }

    pub const fn effective_date(&self) -> LocalDate {
        match self.status {
            PlanStatus::MovedTo(date) => date,
            PlanStatus::Planned | PlanStatus::Skipped => self.date,
        }
    }

    pub const fn is_executable(&self) -> bool {
        !matches!(self.status, PlanStatus::Skipped)
    }

    /// A Plan with actual-work or completion history is an immutable
    /// historical snapshot. Adapters can use this before applying a
    /// date-specific adjustment so recorded actuals are never rewritten.
    pub fn has_history(&self, completions: &[Completion], sessions: &[Session]) -> bool {
        completions.iter().any(|completion| {
            completion.plan_id() == Some(&self.id)
                || self.routine_id.as_ref().is_some_and(|routine_id| {
                    completion.matches_routine_on(routine_id, self.date)
                        || completion.matches_routine_on(routine_id, self.effective_date())
                })
        }) || sessions.iter().any(|session| {
            session.plan_id() == Some(&self.id)
                || (session.routine_id() == self.routine_id.as_ref()
                    && (session.date() == self.date || session.date() == self.effective_date()))
        })
    }

    pub fn set_duration_override(&mut self, duration: Option<PlannedDuration>) {
        self.duration_override = duration;
    }

    pub fn clear_duration_override(&mut self) {
        self.duration_override = None;
    }

    pub fn skip(&mut self) {
        self.status = PlanStatus::Skipped;
    }

    pub fn move_to(&mut self, date: LocalDate) {
        self.status = PlanStatus::MovedTo(date);
    }

    pub fn restore(&mut self) {
        self.status = PlanStatus::Planned;
    }
}
