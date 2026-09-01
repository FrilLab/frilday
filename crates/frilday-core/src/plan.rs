use crate::{
    date::LocalDate,
    ids::{PlanId, RoutineId},
    time::PlannedDuration,
};

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

    pub fn set_duration_override(&mut self, duration: Option<PlannedDuration>) {
        self.duration_override = duration;
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
