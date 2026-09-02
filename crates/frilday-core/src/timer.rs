use crate::{
    ids::{RoutineId, SessionId},
    plan::Plan,
    routine::Routine,
    session::{Session, SessionError, SessionLedger},
    time::Timestamp,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetReachedSession {
    session_id: SessionId,
    routine_id: RoutineId,
    title: String,
    actual_minutes: u64,
    planned_minutes: u32,
}

impl TargetReachedSession {
    pub fn session_id(&self) -> &SessionId {
        &self.session_id
    }

    pub fn routine_id(&self) -> &RoutineId {
        &self.routine_id
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub const fn actual_minutes(&self) -> u64 {
        self.actual_minutes
    }

    pub const fn planned_minutes(&self) -> u32 {
        self.planned_minutes
    }
}

/// Find running sessions whose completed plus currently running time has
/// reached the routine's planned duration.
///
/// This is intentionally read-only: reaching a target is feedback, not a
/// session lifecycle transition. The running session remains running so the
/// user can continue tracking overtime or stop it explicitly.
pub fn target_reached_sessions_at(
    sessions: &[Session],
    routines: &[Routine],
    now: Timestamp,
) -> Result<Vec<TargetReachedSession>, SessionError> {
    target_reached_sessions_at_with_plans(sessions, routines, &[], now)
}

/// Variant of [`target_reached_sessions_at`] that uses a date-specific Plan's
/// effective duration when a Session references one. Legacy sessions without
/// a Plan continue to use the Routine default.
pub fn target_reached_sessions_at_with_plans(
    sessions: &[Session],
    routines: &[Routine],
    plans: &[Plan],
    now: Timestamp,
) -> Result<Vec<TargetReachedSession>, SessionError> {
    let ledger = SessionLedger::try_from_sessions(sessions.to_vec())?;
    let mut reached = Vec::new();

    for session in ledger.sessions() {
        if !session.is_running() {
            continue;
        }

        let Some(routine_id) = session.routine_id().cloned() else {
            continue;
        };
        let Some(routine) = routines.iter().find(|routine| routine.id() == &routine_id) else {
            continue;
        };
        let session_date = session.date();
        let planned_minutes = session
            .plan_id()
            .and_then(|plan_id| plans.iter().find(|plan| plan.id() == plan_id))
            .map(|plan| plan.planned_duration().minutes())
            .unwrap_or_else(|| routine.planned_duration().minutes());

        let completed_minutes = ledger
            .sessions()
            .iter()
            .filter(|candidate| {
                candidate.routine_id() == Some(&routine_id)
                    && candidate.date() == session_date
                    && !candidate.is_running()
            })
            .map(|candidate| candidate.actual_duration_at(now).minutes())
            .fold(0, u64::saturating_add);
        if completed_minutes >= u64::from(planned_minutes) {
            continue;
        }
        let running_minutes = session.actual_duration_at(now).minutes();

        if completed_minutes.saturating_add(running_minutes) < u64::from(planned_minutes) {
            continue;
        }

        reached.push(TargetReachedSession {
            session_id: session.id().clone(),
            routine_id,
            title: routine.title().to_owned(),
            actual_minutes: completed_minutes.saturating_add(running_minutes),
            planned_minutes,
        });
    }

    Ok(reached)
}
