use std::{collections::HashSet, fmt};

use crate::{
    date::LocalDate,
    ids::{PlanId, RoutineId, SessionId},
    time::{ActualDuration, Timestamp},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    MissingAssociation,
    EndBeforeStart,
    ClockMovedBackwards,
    AlreadyStopped,
    AlreadyPaused,
    NotPaused,
    InvalidState,
    NoRunningSession,
    NoOpenSession,
    RoutineAlreadyRunning,
    MultipleRunningSessions,
    OpenSessionAlreadyExists,
    DuplicateSessionId,
}

impl fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingAssociation => {
                formatter.write_str("a session must be associated with a routine or plan")
            }
            Self::EndBeforeStart => formatter.write_str("a session cannot end before it starts"),
            Self::ClockMovedBackwards => {
                formatter.write_str("a session transition cannot use an earlier timestamp")
            }
            Self::AlreadyStopped => formatter.write_str("the session has already ended"),
            Self::AlreadyPaused => formatter.write_str("the session is already paused"),
            Self::NotPaused => formatter.write_str("the session is not paused"),
            Self::InvalidState => formatter.write_str("the session has an invalid persisted state"),
            Self::NoRunningSession => formatter.write_str("no running session was found"),
            Self::NoOpenSession => formatter.write_str("no open session was found"),
            Self::RoutineAlreadyRunning => {
                formatter.write_str("a session is already running for this routine")
            }
            Self::MultipleRunningSessions => {
                formatter.write_str("only one session may be running at a time")
            }
            Self::OpenSessionAlreadyExists => {
                formatter.write_str("an open session must be finished before starting another")
            }
            Self::DuplicateSessionId => formatter.write_str("session ids must be unique"),
        }
    }
}

impl std::error::Error for SessionError {}

/// A Session records actual work as durable active-time segments.
///
/// `started_at` is the first start of the session. `active_started_at` is the
/// start of the currently running segment, while `accumulated_millis` contains
/// completed active segments. This lets adapters restore a running or paused
/// session without relying on UI ticks or a cached minute counter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    id: SessionId,
    routine_id: Option<RoutineId>,
    plan_id: Option<PlanId>,
    date: LocalDate,
    started_at: Timestamp,
    ended_at: Option<Timestamp>,
    accumulated_millis: u64,
    active_started_at: Option<Timestamp>,
    paused_at: Option<Timestamp>,
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

    /// Construct a session using the legacy start/end representation.
    pub fn new(
        id: SessionId,
        routine_id: Option<RoutineId>,
        plan_id: Option<PlanId>,
        date: LocalDate,
        started_at: Timestamp,
        ended_at: Option<Timestamp>,
    ) -> Result<Self, SessionError> {
        let accumulated_millis = ended_at
            .map(|ended| {
                if ended < started_at {
                    0
                } else {
                    started_at.elapsed_millis_until(ended)
                }
            })
            .unwrap_or(0);
        Self::from_persisted(
            id,
            routine_id,
            plan_id,
            date,
            started_at,
            ended_at,
            accumulated_millis,
            if ended_at.is_none() {
                Some(started_at)
            } else {
                None
            },
            None,
        )
    }

    /// Rehydrate a session from durable lifecycle state.
    pub fn from_persisted(
        id: SessionId,
        routine_id: Option<RoutineId>,
        plan_id: Option<PlanId>,
        date: LocalDate,
        started_at: Timestamp,
        ended_at: Option<Timestamp>,
        accumulated_millis: u64,
        active_started_at: Option<Timestamp>,
        paused_at: Option<Timestamp>,
    ) -> Result<Self, SessionError> {
        if routine_id.is_none() && plan_id.is_none() {
            return Err(SessionError::MissingAssociation);
        }
        if ended_at.is_some_and(|ended| ended < started_at) {
            return Err(SessionError::EndBeforeStart);
        }
        if active_started_at.is_some_and(|active| active < started_at)
            || paused_at.is_some_and(|paused| paused < started_at)
        {
            return Err(SessionError::EndBeforeStart);
        }
        if ended_at.is_some() && (active_started_at.is_some() || paused_at.is_some()) {
            return Err(SessionError::InvalidState);
        }
        if active_started_at.is_some() && paused_at.is_some() {
            return Err(SessionError::InvalidState);
        }
        if ended_at.is_none() && active_started_at.is_none() && paused_at.is_none() {
            return Err(SessionError::InvalidState);
        }
        Ok(Self {
            id,
            routine_id,
            plan_id,
            date,
            started_at,
            ended_at,
            accumulated_millis,
            active_started_at,
            paused_at,
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

    pub const fn accumulated_millis(&self) -> u64 {
        self.accumulated_millis
    }

    pub const fn active_started_at(&self) -> Option<Timestamp> {
        self.active_started_at
    }

    pub const fn paused_at(&self) -> Option<Timestamp> {
        self.paused_at
    }

    pub const fn is_running(&self) -> bool {
        self.ended_at.is_none() && self.active_started_at.is_some()
    }

    pub const fn is_paused(&self) -> bool {
        self.ended_at.is_none() && self.paused_at.is_some()
    }

    pub const fn is_open(&self) -> bool {
        self.ended_at.is_none()
    }

    fn transition_baseline(&self) -> Timestamp {
        self.active_started_at
            .or(self.paused_at)
            .unwrap_or(self.started_at)
    }

    fn ensure_transition_time(&self, timestamp: Timestamp) -> Result<(), SessionError> {
        if timestamp < self.transition_baseline() {
            return Err(SessionError::ClockMovedBackwards);
        }
        Ok(())
    }

    fn accumulate_active_time_until(&mut self, timestamp: Timestamp) -> Result<(), SessionError> {
        let Some(active_started_at) = self.active_started_at else {
            return Ok(());
        };
        if timestamp < active_started_at {
            return Err(SessionError::ClockMovedBackwards);
        }
        self.accumulated_millis = self
            .accumulated_millis
            .saturating_add(active_started_at.elapsed_millis_until(timestamp));
        self.active_started_at = None;
        Ok(())
    }

    pub fn pause(&mut self, paused_at: Timestamp) -> Result<ActualDuration, SessionError> {
        if self.ended_at.is_some() {
            return Err(SessionError::AlreadyStopped);
        }
        if !self.is_running() {
            return Err(SessionError::AlreadyPaused);
        }
        self.ensure_transition_time(paused_at)?;
        self.accumulate_active_time_until(paused_at)?;
        self.paused_at = Some(paused_at);
        Ok(self.actual_duration_at(paused_at))
    }

    pub fn resume(&mut self, resumed_at: Timestamp) -> Result<(), SessionError> {
        if self.ended_at.is_some() {
            return Err(SessionError::AlreadyStopped);
        }
        let Some(paused_at) = self.paused_at else {
            return Err(SessionError::NotPaused);
        };
        if resumed_at < paused_at {
            return Err(SessionError::ClockMovedBackwards);
        }
        self.paused_at = None;
        self.active_started_at = Some(resumed_at);
        Ok(())
    }

    pub fn finish(&mut self, ended_at: Timestamp) -> Result<ActualDuration, SessionError> {
        if self.ended_at.is_some() {
            return Err(SessionError::AlreadyStopped);
        }
        self.ensure_transition_time(ended_at)?;
        self.accumulate_active_time_until(ended_at)?;
        self.paused_at = None;
        self.ended_at = Some(ended_at);
        Ok(self.actual_duration_at(ended_at))
    }

    /// Backwards-compatible name for adapters that still call finish "stop".
    pub fn stop(&mut self, ended_at: Timestamp) -> Result<ActualDuration, SessionError> {
        self.finish(ended_at)
    }

    pub fn actual_duration(&self) -> Option<ActualDuration> {
        self.ended_at
            .map(|ended_at| self.actual_duration_at(ended_at))
    }

    pub fn actual_duration_at(&self, now: Timestamp) -> ActualDuration {
        let active_millis = self
            .active_started_at
            .map(|started| started.elapsed_millis_until(now))
            .unwrap_or(0);
        ActualDuration::from_minutes(self.accumulated_millis.saturating_add(active_millis) / 60_000)
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

pub fn open_session(sessions: &[Session]) -> Option<&Session> {
    sessions.iter().find(|session| session.is_open())
}

/// Start a session using the desktop timer policy: the currently running
/// session is finished at `started_at`, then the new session is inserted. A
/// routine cannot be started twice without stopping it first.
pub fn start_session(
    sessions: &[Session],
    new_session: Session,
    started_at: Timestamp,
) -> Result<Vec<Session>, SessionError> {
    if started_at < new_session.started_at() {
        return Err(SessionError::EndBeforeStart);
    }
    if !new_session.is_running() {
        return Err(SessionError::AlreadyStopped);
    }

    let mut ledger = SessionLedger::try_from_sessions(sessions.to_vec())?;
    if ledger.sessions().iter().any(|session| {
        session.is_running()
            && new_session
                .routine_id()
                .is_some_and(|routine_id| session.routine_id() == Some(routine_id))
    }) {
        return Err(SessionError::RoutineAlreadyRunning);
    }

    for session in &mut ledger.sessions {
        if session.is_running() {
            session.finish(started_at)?;
        }
    }

    ledger.insert(new_session)?;
    Ok(ledger.sessions)
}

/// Finish the first open session for a routine whose local tracking date is
/// not later than `date`. This keeps sessions started before midnight
/// controllable from the following local day.
pub fn stop_session_for_routine(
    sessions: &[Session],
    routine_id: &RoutineId,
    date: LocalDate,
    ended_at: Timestamp,
) -> Result<Vec<Session>, SessionError> {
    let mut ledger = SessionLedger::try_from_sessions(sessions.to_vec())?;
    let session = ledger
        .sessions
        .iter_mut()
        .find(|session| {
            session.is_open() && session.routine_id() == Some(routine_id) && session.date() <= date
        })
        .ok_or(SessionError::NoOpenSession)?;
    session.finish(ended_at)?;
    Ok(ledger.sessions)
}

pub fn pause_session_for_routine(
    sessions: &[Session],
    routine_id: &RoutineId,
    date: LocalDate,
    paused_at: Timestamp,
) -> Result<Vec<Session>, SessionError> {
    let mut ledger = SessionLedger::try_from_sessions(sessions.to_vec())?;
    let session = ledger
        .sessions
        .iter_mut()
        .find(|session| {
            session.is_running()
                && session.routine_id() == Some(routine_id)
                && session.date() <= date
        })
        .ok_or(SessionError::NoRunningSession)?;
    session.pause(paused_at)?;
    Ok(ledger.sessions)
}

pub fn resume_session_for_routine(
    sessions: &[Session],
    routine_id: &RoutineId,
    date: LocalDate,
    resumed_at: Timestamp,
) -> Result<Vec<Session>, SessionError> {
    let mut ledger = SessionLedger::try_from_sessions(sessions.to_vec())?;
    let session = ledger
        .sessions
        .iter_mut()
        .find(|session| {
            session.is_paused()
                && session.routine_id() == Some(routine_id)
                && session.date() <= date
        })
        .ok_or(SessionError::NoOpenSession)?;
    session.resume(resumed_at)?;
    Ok(ledger.sessions)
}

pub fn running_routine_id(sessions: &[Session]) -> Option<&RoutineId> {
    running_session(sessions).and_then(Session::routine_id)
}

/// A small aggregate for adapters that keep sessions in memory. It makes the
/// one-open-session invariant enforceable at insertion time.
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
        if session.is_open() && self.sessions.iter().any(Session::is_open) {
            return Err(SessionError::OpenSessionAlreadyExists);
        }
        self.sessions.push(session);
        Ok(())
    }

    fn validate(&self) -> Result<(), SessionError> {
        let mut ids = HashSet::with_capacity(self.sessions.len());
        for session in &self.sessions {
            if !ids.insert(session.id()) {
                return Err(SessionError::DuplicateSessionId);
            }
        }
        validate_no_concurrent_sessions(&self.sessions)?;
        if self
            .sessions
            .iter()
            .filter(|session| session.is_open())
            .count()
            > 1
        {
            return Err(SessionError::OpenSessionAlreadyExists);
        }
        Ok(())
    }
}
