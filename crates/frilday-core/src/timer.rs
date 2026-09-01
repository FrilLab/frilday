use crate::{
    completion::{Completion, toggle_routine_completion},
    ids::RoutineId,
    routine::Routine,
    session::{Session, SessionError, SessionLedger},
    time::Timestamp,
};

/// The result of automatically stopping sessions that have reached their
/// routine's planned duration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoStopResult {
    sessions: Vec<Session>,
    completions: Vec<Completion>,
    finished: Vec<FinishedSession>,
}

impl AutoStopResult {
    pub fn sessions(&self) -> &[Session] {
        &self.sessions
    }

    pub fn completions(&self) -> &[Completion] {
        &self.completions
    }

    pub fn finished(&self) -> &[FinishedSession] {
        &self.finished
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinishedSession {
    routine_id: RoutineId,
    title: String,
    minutes: u64,
    auto_completed: bool,
}

impl FinishedSession {
    pub fn routine_id(&self) -> &RoutineId {
        &self.routine_id
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub const fn minutes(&self) -> u64 {
        self.minutes
    }

    pub const fn auto_completed(&self) -> bool {
        self.auto_completed
    }
}

/// Stop each running session whose completed plus currently running time has
/// reached the routine's planned duration. Completion remains independent from
/// tracking, but reaching the timer target creates a completion when one does
/// not already exist for that routine and local tracking date.
pub fn auto_stop_sessions_at_target(
    sessions: &[Session],
    routines: &[Routine],
    completions: &[Completion],
    now: Timestamp,
) -> Result<AutoStopResult, SessionError> {
    let ledger = SessionLedger::try_from_sessions(sessions.to_vec())?;
    let mut next_sessions = ledger.sessions().to_vec();
    let mut next_completions = completions.to_vec();
    let mut finished = Vec::new();

    for index in 0..next_sessions.len() {
        let Some(session) = next_sessions.get(index) else {
            continue;
        };
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

        let completed_minutes = next_sessions
            .iter()
            .filter(|candidate| {
                candidate.routine_id() == Some(&routine_id)
                    && candidate.date() == session_date
                    && !candidate.is_running()
            })
            .map(|candidate| candidate.actual_duration_at(now).minutes())
            .fold(0, u64::saturating_add);
        let running_minutes = session.actual_duration_at(now).minutes();

        if completed_minutes.saturating_add(running_minutes)
            < u64::from(routine.planned_duration().minutes())
        {
            continue;
        }

        let session = next_sessions
            .get_mut(index)
            .expect("session index came from the same collection");
        session.stop(now)?;

        let already_completed = next_completions
            .iter()
            .any(|completion| completion.matches_routine_on(&routine_id, session_date));
        if !already_completed {
            next_completions =
                toggle_routine_completion(&next_completions, routine_id.clone(), session_date);
        }

        finished.push(FinishedSession {
            routine_id,
            title: routine.title().to_owned(),
            minutes: running_minutes,
            auto_completed: !already_completed,
        });
    }

    Ok(AutoStopResult {
        sessions: next_sessions,
        completions: next_completions,
        finished,
    })
}
