use std::fmt;

use crate::{
    date::LocalDate,
    ids::{PlanId, RoutineId, SessionId},
    time::{ActualDuration, Timestamp},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    MissingAssociation,
    EndBeforeStart,
    AlreadyStopped,
    MultipleRunningSessions,
    DuplicateSessionId,
}

impl fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingAssociation => {
                formatter.write_str("a session must be associated with a routine or plan")
            }
            Self::EndBeforeStart => formatter.write_str("a session cannot end before it starts"),
            Self::AlreadyStopped => formatter.write_str("the session has already ended"),
            Self::MultipleRunningSessions => {
                formatter.write_str("only one session may be running at a time")
            }
            Self::DuplicateSessionId => formatter.write_str("session ids must be unique"),
        }
    }
}

impl std::error::Error for SessionError {}

/// A Session records actual work. Its duration is always derived from its
/// timestamps; there is no mutable cached minutes field to drift from them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    id: SessionId,
    routine_id: Option<RoutineId>,
    plan_id: Option<PlanId>,
    date: LocalDate,
    started_at: Timestamp,
    ended_at: Option<Timestamp>,
}

impl Session {
    pub fn start(
        id: SessionId,
        routine_id: Option<RoutineId>,
        plan_id: Option<PlanId>,
        date: LocalDate,
        started_at: Timestamp,
    ) -> Result<Self, SessionError> {
        Self::new(id, routine_id, plan_id, date, started_at, None)
    }

    pub fn new(
        id: SessionId,
        routine_id: Option<RoutineId>,
        plan_id: Option<PlanId>,
        date: LocalDate,
        started_at: Timestamp,
        ended_at: Option<Timestamp>,
    ) -> Result<Self, SessionError> {
        if routine_id.is_none() && plan_id.is_none() {
            return Err(SessionError::MissingAssociation);
        }
        if ended_at.is_some_and(|ended| ended < started_at) {
            return Err(SessionError::EndBeforeStart);
        }
        Ok(Self {
            id,
            routine_id,
            plan_id,
            date,
            started_at,
            ended_at,
        })
    }

    pub fn id(&self) -> &SessionId {
        &self.id
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

    pub const fn started_at(&self) -> Timestamp {
        self.started_at
    }

    pub const fn ended_at(&self) -> Option<Timestamp> {
        self.ended_at
    }

    pub const fn is_running(&self) -> bool {
        self.ended_at.is_none()
    }

    pub fn stop(&mut self, ended_at: Timestamp) -> Result<ActualDuration, SessionError> {
        if self.ended_at.is_some() {
            return Err(SessionError::AlreadyStopped);
        }
        if ended_at < self.started_at {
            return Err(SessionError::EndBeforeStart);
        }
        self.ended_at = Some(ended_at);
        Ok(self.started_at.elapsed_minutes_until(ended_at))
    }

    pub fn actual_duration(&self) -> Option<ActualDuration> {
        self.ended_at
            .map(|ended_at| self.started_at.elapsed_minutes_until(ended_at))
    }

    pub fn actual_duration_at(&self, now: Timestamp) -> ActualDuration {
        self.started_at
            .elapsed_minutes_until(self.ended_at.unwrap_or(now))
    }
}

pub fn validate_no_concurrent_sessions(sessions: &[Session]) -> Result<(), SessionError> {
    if sessions
        .iter()
        .filter(|session| session.is_running())
        .count()
        > 1
    {
        return Err(SessionError::MultipleRunningSessions);
    }
    Ok(())
}

pub fn running_session(sessions: &[Session]) -> Option<&Session> {
    sessions.iter().find(|session| session.is_running())
}

/// A small aggregate for adapters that keep sessions in memory. It makes the
/// one-running-session invariant enforceable at insertion time.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionLedger {
    sessions: Vec<Session>,
}

impl SessionLedger {
    pub fn try_from_sessions(sessions: Vec<Session>) -> Result<Self, SessionError> {
        let ledger = Self { sessions };
        ledger.validate()?;
        Ok(ledger)
    }

    pub fn sessions(&self) -> &[Session] {
        &self.sessions
    }

    pub fn active(&self) -> Option<&Session> {
        running_session(&self.sessions)
    }

    pub fn start(&mut self, session: Session) -> Result<(), SessionError> {
        self.insert(session)
    }

    pub fn insert(&mut self, session: Session) -> Result<(), SessionError> {
        if self
            .sessions
            .iter()
            .any(|existing| existing.id() == session.id())
        {
            return Err(SessionError::DuplicateSessionId);
        }
        if session.is_running() && self.active().is_some() {
            return Err(SessionError::MultipleRunningSessions);
        }
        self.sessions.push(session);
        Ok(())
    }

    fn validate(&self) -> Result<(), SessionError> {
        if self.sessions.iter().enumerate().any(|(index, session)| {
            self.sessions[..index]
                .iter()
                .any(|prior| prior.id() == session.id())
        }) {
            return Err(SessionError::DuplicateSessionId);
        }
        validate_no_concurrent_sessions(&self.sessions)
    }
}
