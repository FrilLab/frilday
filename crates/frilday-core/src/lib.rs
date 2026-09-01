//! Shared FrilDay domain rules live here as they are migrated out of adapters.
//!
//! This crate intentionally has no framework, transport, or persistence
//! dependencies. The public model is the vocabulary shared by future desktop
//! and server adapters; adapters are responsible for translating their own
//! storage and timestamp formats into these types.

mod model;

pub use model::{
    Completion, CompletionTarget, Date, DomainError, LocalDate, Plan, PlanId, PlanState,
    PlannedDuration, Routine, RoutineId, RoutineState, ScheduleRule, Session, SessionId, Timestamp,
    TrackedDuration, Weekday, ensure_single_running_session, toggle_completion,
};
