use std::fmt;

use crate::{
    completion::{Completion, completion_count_for_routine},
    date::LocalDate,
    ids::RoutineId,
    schedule::ScheduleRule,
    time::{PlannedDuration, Timestamp},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoutineError {
    EmptyTitle,
    InvalidCompletionLimit,
    InvalidOccurrenceLimit,
}

impl fmt::Display for RoutineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTitle => formatter.write_str("a routine title must not be empty"),
            Self::InvalidCompletionLimit => {
                formatter.write_str("the completion limit must be greater than zero")
            }
            Self::InvalidOccurrenceLimit => {
                formatter.write_str("the occurrence limit must be greater than zero")
            }
        }
    }
}

impl std::error::Error for RoutineError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Routine {
    id: RoutineId,
    title: String,
    description: String,
    planned_duration: PlannedDuration,
    schedule: ScheduleRule,
    starts_on: Option<LocalDate>,
    completion_limit: Option<u32>,
    occurrence_limit: Option<u32>,
    active: bool,
    created_at: Timestamp,
}

impl Routine {
    pub fn new(
        id: RoutineId,
        title: impl Into<String>,
        description: impl Into<String>,
        planned_duration: PlannedDuration,
        schedule: ScheduleRule,
        created_at: Timestamp,
    ) -> Result<Self, RoutineError> {
        let title = title.into().trim().to_owned();
        if title.is_empty() {
            return Err(RoutineError::EmptyTitle);
        }

        Ok(Self {
            id,
            title,
            description: description.into().trim().to_owned(),
            planned_duration,
            schedule,
            starts_on: None,
            completion_limit: None,
            occurrence_limit: None,
            active: true,
            created_at,
        })
    }

    pub fn id(&self) -> &RoutineId {
        &self.id
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub const fn planned_duration(&self) -> PlannedDuration {
        self.planned_duration
    }

    pub fn schedule(&self) -> &ScheduleRule {
        &self.schedule
    }

    pub const fn starts_on(&self) -> Option<LocalDate> {
        self.starts_on
    }

    pub const fn completion_limit(&self) -> Option<u32> {
        self.completion_limit
    }

    pub const fn occurrence_limit(&self) -> Option<u32> {
        self.occurrence_limit
    }

    pub const fn is_active(&self) -> bool {
        self.active
    }

    pub const fn created_at(&self) -> Timestamp {
        self.created_at
    }

    pub fn set_starts_on(&mut self, starts_on: Option<LocalDate>) {
        self.starts_on = starts_on;
    }

    pub fn set_completion_limit(&mut self, limit: Option<u32>) -> Result<(), RoutineError> {
        if limit == Some(0) {
            return Err(RoutineError::InvalidCompletionLimit);
        }
        self.completion_limit = limit;
        Ok(())
    }

    pub fn set_occurrence_limit(&mut self, limit: Option<u32>) -> Result<(), RoutineError> {
        if limit == Some(0) {
            return Err(RoutineError::InvalidOccurrenceLimit);
        }
        self.occurrence_limit = limit;
        Ok(())
    }

    pub fn archive(&mut self) {
        self.active = false;
    }

    pub fn restore(&mut self) {
        self.active = true;
    }

    pub fn should_auto_archive(&self, completions: &[Completion]) -> bool {
        self.completion_limit.is_some_and(|limit| {
            completion_count_for_routine(completions, self.id()) >= limit as usize
        })
    }
}
