use std::{fmt, str::FromStr};

/// Errors raised when an entity would violate a domain invariant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DomainError {
    EmptyId(&'static str),
    EmptyTitle,
    InvalidDate(String),
    InvalidDuration,
    EmptyCustomSchedule,
    DuplicateCustomScheduleDay,
    StartDateBeforeCreation,
    MissingSessionAssociation,
    SessionEndsBeforeItStarts,
    SessionAlreadyEnded,
    MultipleRunningSessions,
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyId(entity) => write!(f, "{entity} id cannot be empty"),
            Self::EmptyTitle => f.write_str("routine title cannot be empty"),
            Self::InvalidDate(value) => write!(f, "invalid local date: {value}"),
            Self::InvalidDuration => f.write_str("planned duration must be positive"),
            Self::EmptyCustomSchedule => f.write_str("custom schedule needs at least one day"),
            Self::DuplicateCustomScheduleDay => {
                f.write_str("custom schedule cannot contain duplicate days")
            }
            Self::StartDateBeforeCreation => {
                f.write_str("routine start date cannot be before its creation date")
            }
            Self::MissingSessionAssociation => {
                f.write_str("session must be associated with a routine or plan")
            }
            Self::SessionEndsBeforeItStarts => {
                f.write_str("session end timestamp cannot be before its start timestamp")
            }
            Self::SessionAlreadyEnded => f.write_str("session has already ended"),
            Self::MultipleRunningSessions => f.write_str("only one session may be running"),
        }
    }
}

impl std::error::Error for DomainError {}

macro_rules! entity_id {
    ($name:ident, $label:literal) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, DomainError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(DomainError::EmptyId($label));
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

entity_id!(RoutineId, "routine");
entity_id!(PlanId, "plan");
entity_id!(SessionId, "session");

/// A calendar date in the user's local desktop timezone.
///
/// Dates are intentionally separate from instants. They are persisted and
/// compared in canonical `YYYY-MM-DD` form and must not be calculated by
/// converting through UTC.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct LocalDate(String);

/// Short alias used by the domain documentation and adapters.
pub type Date = LocalDate;

impl LocalDate {
    pub fn new(value: impl Into<String>) -> Result<Self, DomainError> {
        let value = value.into();
        let bytes = value.as_bytes();
        let valid_shape = bytes.len() == 10
            && bytes[4] == b'-'
            && bytes[7] == b'-'
            && bytes
                .iter()
                .enumerate()
                .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit());

        if !valid_shape {
            return Err(DomainError::InvalidDate(value));
        }

        let year = value[0..4]
            .parse::<u32>()
            .map_err(|_| DomainError::InvalidDate(value.clone()))?;
        let month = value[5..7]
            .parse::<u32>()
            .map_err(|_| DomainError::InvalidDate(value.clone()))?;
        let day = value[8..10]
            .parse::<u32>()
            .map_err(|_| DomainError::InvalidDate(value.clone()))?;

        let days_in_month = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if is_leap_year(year) => 29,
            2 => 28,
            _ => 0,
        };

        if year == 0 || days_in_month == 0 || day == 0 || day > days_in_month {
            return Err(DomainError::InvalidDate(value));
        }

        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Return the weekday for this local calendar date without timezone
    /// conversion. The core owns this calculation so callers cannot pass a
    /// weekday that disagrees with the date.
    pub fn weekday(&self) -> Weekday {
        let year = self.0[0..4].parse::<u32>().expect("LocalDate is validated");
        let month = self.0[5..7]
            .parse::<usize>()
            .expect("LocalDate is validated");
        let day = self.0[8..10]
            .parse::<u32>()
            .expect("LocalDate is validated");
        let offsets = [0_u32, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
        let adjusted_year = year - u32::from(month < 3);
        let sunday_first = (adjusted_year + adjusted_year / 4 - adjusted_year / 100
            + adjusted_year / 400
            + offsets[month - 1]
            + day)
            % 7;

        match sunday_first {
            0 => Weekday::Sunday,
            1 => Weekday::Monday,
            2 => Weekday::Tuesday,
            3 => Weekday::Wednesday,
            4 => Weekday::Thursday,
            5 => Weekday::Friday,
            6 => Weekday::Saturday,
            _ => unreachable!("weekday is modulo seven"),
        }
    }
}

impl fmt::Display for LocalDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for LocalDate {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

fn is_leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

/// An instant represented as signed Unix seconds.
///
/// ISO-8601 parsing and formatting belong in an adapter. Keeping the core
/// representation numeric makes duration calculations deterministic and free
/// of timezone/database dependencies.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Timestamp(i64);

impl Timestamp {
    pub const fn from_unix_seconds(seconds: i64) -> Self {
        Self(seconds)
    }

    pub const fn unix_seconds(self) -> i64 {
        self.0
    }
}

/// A routine's planned duration, expressed in whole minutes.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct PlannedDuration(u32);

impl PlannedDuration {
    pub const fn new(minutes: u32) -> Result<Self, DomainError> {
        if minutes == 0 {
            Err(DomainError::InvalidDuration)
        } else {
            Ok(Self(minutes))
        }
    }

    pub const fn minutes(self) -> u32 {
        self.0
    }
}

/// Actual tracked time. It may be zero for a session shorter than one minute.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct TrackedDuration {
    seconds: u64,
}

impl TrackedDuration {
    pub const fn from_seconds(seconds: u64) -> Self {
        Self { seconds }
    }

    pub const fn seconds(self) -> u64 {
        self.seconds
    }

    pub const fn whole_minutes(self) -> u64 {
        self.seconds / 60
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Weekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

/// A validated recurring schedule. Custom days are private so callers cannot
/// construct an empty or duplicate schedule without going through validation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduleRule {
    days: Vec<Weekday>,
}

impl ScheduleRule {
    pub fn daily() -> Self {
        Self {
            days: vec![
                Weekday::Monday,
                Weekday::Tuesday,
                Weekday::Wednesday,
                Weekday::Thursday,
                Weekday::Friday,
                Weekday::Saturday,
                Weekday::Sunday,
            ],
        }
    }

    pub fn weekdays() -> Self {
        Self {
            days: vec![
                Weekday::Monday,
                Weekday::Tuesday,
                Weekday::Wednesday,
                Weekday::Thursday,
                Weekday::Friday,
            ],
        }
    }

    pub fn weekends() -> Self {
        Self {
            days: vec![Weekday::Saturday, Weekday::Sunday],
        }
    }

    pub fn custom(days: impl Into<Vec<Weekday>>) -> Result<Self, DomainError> {
        let days = days.into();
        if days.is_empty() {
            return Err(DomainError::EmptyCustomSchedule);
        }

        for (index, day) in days.iter().enumerate() {
            if days[..index].contains(day) {
                return Err(DomainError::DuplicateCustomScheduleDay);
            }
        }

        Ok(Self { days })
    }

    pub fn includes(&self, weekday: Weekday) -> bool {
        self.days.contains(&weekday)
    }

    pub fn days(&self) -> &[Weekday] {
        &self.days
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoutineState {
    Active,
    Archived,
}

/// A reusable intention/rule. A routine is not a record of work on a date.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Routine {
    id: RoutineId,
    title: String,
    description: String,
    default_planned_duration: PlannedDuration,
    schedule: ScheduleRule,
    created_at: Timestamp,
    created_on: LocalDate,
    starts_on: Option<LocalDate>,
    state: RoutineState,
    archive_after_completions: Option<u32>,
    max_planned_occurrences: Option<u32>,
}

impl Routine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: RoutineId,
        title: impl Into<String>,
        description: impl Into<String>,
        default_planned_duration: PlannedDuration,
        schedule: ScheduleRule,
        created_at: Timestamp,
        created_on: LocalDate,
        starts_on: Option<LocalDate>,
    ) -> Result<Self, DomainError> {
        let title = title.into().trim().to_owned();
        if title.is_empty() {
            return Err(DomainError::EmptyTitle);
        }
        if starts_on.as_ref().is_some_and(|date| date < &created_on) {
            return Err(DomainError::StartDateBeforeCreation);
        }

        Ok(Self {
            id,
            title,
            description: description.into().trim().to_owned(),
            default_planned_duration,
            schedule,
            created_at,
            created_on,
            starts_on,
            state: RoutineState::Active,
            archive_after_completions: None,
            max_planned_occurrences: None,
        })
    }

    pub fn with_archive_after_completions(
        mut self,
        count: Option<u32>,
    ) -> Result<Self, DomainError> {
        if count == Some(0) {
            return Err(DomainError::InvalidDuration);
        }
        self.archive_after_completions = count;
        Ok(self)
    }

    pub fn with_max_planned_occurrences(mut self, count: Option<u32>) -> Result<Self, DomainError> {
        if count == Some(0) {
            return Err(DomainError::InvalidDuration);
        }
        self.max_planned_occurrences = count;
        Ok(self)
    }

    pub fn archive(&mut self) {
        self.state = RoutineState::Archived;
    }

    pub fn restore(&mut self) {
        self.state = RoutineState::Active;
    }

    pub fn is_active(&self) -> bool {
        self.state == RoutineState::Active
    }

    pub fn is_eligible_on(&self, date: &LocalDate) -> bool {
        self.is_active()
            && self
                .starts_on
                .as_ref()
                .is_none_or(|starts_on| date >= starts_on)
            && self.schedule.includes(date.weekday())
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

    pub fn default_planned_duration(&self) -> PlannedDuration {
        self.default_planned_duration
    }

    pub fn schedule(&self) -> &ScheduleRule {
        &self.schedule
    }

    pub fn created_at(&self) -> Timestamp {
        self.created_at
    }

    pub fn created_on(&self) -> &LocalDate {
        &self.created_on
    }

    pub fn starts_on(&self) -> Option<&LocalDate> {
        self.starts_on.as_ref()
    }

    pub fn state(&self) -> RoutineState {
        self.state
    }

    pub fn archive_after_completions(&self) -> Option<u32> {
        self.archive_after_completions
    }

    pub fn max_planned_occurrences(&self) -> Option<u32> {
        self.max_planned_occurrences
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PlanState {
    Planned,
    Skipped,
    Moved { to: LocalDate },
}

/// A date-specific intention. Its duration is a snapshot for that date.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Plan {
    id: PlanId,
    routine_id: Option<RoutineId>,
    date: LocalDate,
    planned_duration: PlannedDuration,
    duration_override: Option<PlannedDuration>,
    state: PlanState,
}

impl Plan {
    pub fn new(
        id: PlanId,
        routine_id: Option<RoutineId>,
        date: LocalDate,
        routine_default_duration: PlannedDuration,
        duration_override: Option<PlannedDuration>,
    ) -> Self {
        let planned_duration = duration_override.unwrap_or(routine_default_duration);
        Self {
            id,
            routine_id,
            date,
            planned_duration,
            duration_override,
            state: PlanState::Planned,
        }
    }

    pub fn skip(&mut self) {
        self.state = PlanState::Skipped;
    }

    pub fn move_to(&mut self, date: LocalDate) {
        self.state = PlanState::Moved { to: date };
    }

    pub fn id(&self) -> &PlanId {
        &self.id
    }

    pub fn routine_id(&self) -> Option<&RoutineId> {
        self.routine_id.as_ref()
    }

    pub fn date(&self) -> &LocalDate {
        &self.date
    }

    pub fn planned_duration(&self) -> PlannedDuration {
        self.planned_duration
    }

    pub fn duration_override(&self) -> Option<PlannedDuration> {
        self.duration_override
    }

    pub fn state(&self) -> &PlanState {
        &self.state
    }
}

/// A real interval of tracked work. Duration is always derived from timestamps;
/// no mutable cached minute field is part of the entity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Session {
    id: SessionId,
    routine_id: Option<RoutineId>,
    plan_id: Option<PlanId>,
    started_at: Timestamp,
    ended_at: Option<Timestamp>,
}

impl Session {
    pub fn new(
        id: SessionId,
        routine_id: Option<RoutineId>,
        plan_id: Option<PlanId>,
        started_at: Timestamp,
        ended_at: Option<Timestamp>,
    ) -> Result<Self, DomainError> {
        if routine_id.is_none() && plan_id.is_none() {
            return Err(DomainError::MissingSessionAssociation);
        }
        if ended_at.is_some_and(|ended_at| ended_at < started_at) {
            return Err(DomainError::SessionEndsBeforeItStarts);
        }

        Ok(Self {
            id,
            routine_id,
            plan_id,
            started_at,
            ended_at,
        })
    }

    pub fn finish(&mut self, ended_at: Timestamp) -> Result<(), DomainError> {
        if self.ended_at.is_some() {
            return Err(DomainError::SessionAlreadyEnded);
        }
        if ended_at < self.started_at {
            return Err(DomainError::SessionEndsBeforeItStarts);
        }
        self.ended_at = Some(ended_at);
        Ok(())
    }

    pub fn actual_duration_at(&self, now: Timestamp) -> Result<TrackedDuration, DomainError> {
        let end = self.ended_at.unwrap_or(now);
        let seconds = end
            .unix_seconds()
            .checked_sub(self.started_at.unix_seconds())
            .ok_or(DomainError::SessionEndsBeforeItStarts)?;
        if seconds < 0 {
            return Err(DomainError::SessionEndsBeforeItStarts);
        }
        Ok(TrackedDuration::from_seconds(seconds as u64))
    }

    pub fn is_running(&self) -> bool {
        self.ended_at.is_none()
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

    pub fn started_at(&self) -> Timestamp {
        self.started_at
    }

    pub fn ended_at(&self) -> Option<Timestamp> {
        self.ended_at
    }
}

/// Validate the aggregate-level invariant that there is at most one running
/// session in the local desktop application.
pub fn ensure_single_running_session(sessions: &[Session]) -> Result<(), DomainError> {
    if sessions
        .iter()
        .filter(|session| session.is_running())
        .count()
        > 1
    {
        return Err(DomainError::MultipleRunningSessions);
    }
    Ok(())
}

/// Start a running session while enforcing the desktop's single-running-
/// session invariant atomically for the supplied collection.
pub fn start_session(sessions: &mut Vec<Session>, session: Session) -> Result<(), DomainError> {
    ensure_single_running_session(sessions)?;
    if !session.is_running() || sessions.iter().any(Session::is_running) {
        return Err(if session.is_running() {
            DomainError::MultipleRunningSessions
        } else {
            DomainError::SessionAlreadyEnded
        });
    }
    sessions.push(session);
    Ok(())
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum CompletionKey {
    RoutineDate {
        routine_id: RoutineId,
        date: LocalDate,
    },
    PlanDate {
        plan_id: PlanId,
        date: LocalDate,
    },
}

/// A binary signal for a routine/date or plan/date. It intentionally has no
/// session reference: completion and time investment are independent facts.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
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

    pub fn for_routine_plan(routine_id: RoutineId, plan_id: PlanId, date: LocalDate) -> Self {
        Self {
            routine_id: Some(routine_id),
            plan_id: Some(plan_id),
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

    /// Return the canonical toggle key. A historical completion may retain
    /// both IDs, but a routine/date key remains canonical when present.
    pub fn key(&self) -> CompletionKey {
        match (&self.routine_id, &self.plan_id) {
            (Some(routine_id), _) => CompletionKey::RoutineDate {
                routine_id: routine_id.clone(),
                date: self.date.clone(),
            },
            (None, Some(plan_id)) => CompletionKey::PlanDate {
                plan_id: plan_id.clone(),
                date: self.date.clone(),
            },
            (None, None) => unreachable!("Completion constructors always set a target"),
        }
    }

    pub fn routine_id(&self) -> Option<&RoutineId> {
        self.routine_id.as_ref()
    }

    pub fn plan_id(&self) -> Option<&PlanId> {
        self.plan_id.as_ref()
    }

    pub fn date(&self) -> &LocalDate {
        &self.date
    }
}

/// Toggle one completion without touching sessions or other completion keys.
pub fn toggle_completion(completions: &[Completion], completion: Completion) -> Vec<Completion> {
    let key = completion.key();
    let exists = completions.iter().any(|current| current.key() == key);
    if exists {
        completions
            .iter()
            .filter(|current| current.key() != key)
            .cloned()
            .collect()
    } else {
        if completions.iter().any(|current| current.key() == key) {
            return completions.to_vec();
        }
        let mut next = completions.to_vec();
        next.push(completion);
        next
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> RoutineId {
        RoutineId::new(value).unwrap()
    }

    fn plan_id(value: &str) -> PlanId {
        PlanId::new(value).unwrap()
    }

    fn session_id(value: &str) -> SessionId {
        SessionId::new(value).unwrap()
    }

    fn date(value: &str) -> LocalDate {
        LocalDate::new(value).unwrap()
    }

    fn minutes(value: u32) -> PlannedDuration {
        PlannedDuration::new(value).unwrap()
    }

    #[test]
    fn validates_stable_ids_and_calendar_dates() {
        assert_eq!(RoutineId::new("  "), Err(DomainError::EmptyId("routine")));
        assert!(LocalDate::new("2026-02-29").is_err());
        assert!(LocalDate::new("2028-02-29").is_ok());
        assert!(LocalDate::new("2026-02-30").is_err());
    }

    #[test]
    fn planned_duration_is_positive_and_actual_duration_can_be_zero() {
        assert_eq!(PlannedDuration::new(0), Err(DomainError::InvalidDuration));
        assert_eq!(TrackedDuration::from_seconds(59).whole_minutes(), 0);
    }

    #[test]
    fn routine_rejects_a_start_before_creation_and_can_be_archived_without_losing_identity() {
        let created_on = date("2026-01-10");
        let result = Routine::new(
            id("routine-1"),
            "English study",
            "",
            minutes(30),
            ScheduleRule::daily(),
            Timestamp::from_unix_seconds(1),
            created_on.clone(),
            Some(date("2026-01-09")),
        );
        assert_eq!(result, Err(DomainError::StartDateBeforeCreation));

        let mut routine = Routine::new(
            id("routine-1"),
            " English study ",
            " description ",
            minutes(30),
            ScheduleRule::weekdays(),
            Timestamp::from_unix_seconds(1),
            created_on,
            None,
        )
        .unwrap();
        routine.archive();
        assert_eq!(routine.state(), RoutineState::Archived);
        assert_eq!(routine.id().as_str(), "routine-1");
        assert!(!routine.is_eligible_on(&date("2026-01-12")));
    }

    #[test]
    fn custom_schedule_rejects_empty_and_duplicate_days() {
        assert_eq!(
            ScheduleRule::custom(Vec::new()),
            Err(DomainError::EmptyCustomSchedule)
        );
        assert_eq!(
            ScheduleRule::custom(vec![Weekday::Monday, Weekday::Monday]),
            Err(DomainError::DuplicateCustomScheduleDay)
        );
    }

    #[test]
    fn plan_keeps_effective_planned_duration_and_override_separate() {
        let plan = Plan::new(
            plan_id("plan-1"),
            Some(id("routine-1")),
            date("2026-01-12"),
            minutes(30),
            Some(minutes(45)),
        );
        assert_eq!(plan.planned_duration().minutes(), 45);
        assert_eq!(plan.duration_override().unwrap().minutes(), 45);
        assert_eq!(plan.state(), &PlanState::Planned);
    }

    #[test]
    fn plan_can_be_skipped_or_moved_without_changing_its_original_date() {
        let mut plan = Plan::new(
            plan_id("plan-1"),
            None,
            date("2026-01-12"),
            minutes(30),
            None,
        );
        plan.move_to(date("2026-01-13"));
        assert_eq!(plan.date().as_str(), "2026-01-12");
        assert_eq!(
            plan.state(),
            &PlanState::Moved {
                to: date("2026-01-13")
            }
        );
        plan.skip();
        assert_eq!(plan.state(), &PlanState::Skipped);
    }

    #[test]
    fn session_derives_actual_time_from_timestamps_and_supports_running_state() {
        let session = Session::new(
            session_id("session-1"),
            Some(id("routine-1")),
            None,
            Timestamp::from_unix_seconds(10 * 60),
            Some(Timestamp::from_unix_seconds(95 * 60)),
        )
        .unwrap();
        assert_eq!(
            session
                .actual_duration_at(Timestamp::from_unix_seconds(120 * 60))
                .unwrap()
                .whole_minutes(),
            85
        );
        assert!(!session.is_running());

        let running = Session::new(
            session_id("session-2"),
            Some(id("routine-1")),
            None,
            Timestamp::from_unix_seconds(10 * 60),
            None,
        )
        .unwrap();
        assert_eq!(
            running
                .actual_duration_at(Timestamp::from_unix_seconds(12 * 60))
                .unwrap()
                .whole_minutes(),
            2
        );
    }

    #[test]
    fn session_rejects_missing_association_and_backwards_time() {
        assert_eq!(
            Session::new(
                session_id("session-1"),
                None,
                None,
                Timestamp::from_unix_seconds(10),
                None,
            ),
            Err(DomainError::MissingSessionAssociation)
        );
        assert_eq!(
            Session::new(
                session_id("session-1"),
                Some(id("routine-1")),
                None,
                Timestamp::from_unix_seconds(20),
                Some(Timestamp::from_unix_seconds(10)),
            ),
            Err(DomainError::SessionEndsBeforeItStarts)
        );
    }

    #[test]
    fn only_one_running_session_is_allowed() {
        let first = Session::new(
            session_id("session-1"),
            Some(id("routine-1")),
            None,
            Timestamp::from_unix_seconds(10),
            None,
        )
        .unwrap();
        let second = Session::new(
            session_id("session-2"),
            Some(id("routine-2")),
            None,
            Timestamp::from_unix_seconds(20),
            None,
        )
        .unwrap();
        assert_eq!(
            ensure_single_running_session(&[first.clone(), second]),
            Err(DomainError::MultipleRunningSessions)
        );
        assert!(ensure_single_running_session(&[first]).is_ok());
    }

    #[test]
    fn starting_a_second_running_session_is_rejected_before_insertion() {
        let first = Session::new(
            session_id("session-1"),
            Some(id("routine-1")),
            None,
            Timestamp::from_unix_seconds(10),
            None,
        )
        .unwrap();
        let second = Session::new(
            session_id("session-2"),
            Some(id("routine-2")),
            None,
            Timestamp::from_unix_seconds(20),
            None,
        )
        .unwrap();
        let mut sessions = vec![first];
        assert_eq!(
            start_session(&mut sessions, second),
            Err(DomainError::MultipleRunningSessions)
        );
        assert_eq!(sessions.len(), 1);
    }

    #[test]
    fn completion_keeps_historical_plan_association_but_toggles_by_routine_date() {
        let completion =
            Completion::for_routine_plan(id("routine-1"), plan_id("plan-1"), date("2026-01-12"));
        let other = Completion::for_plan(plan_id("plan-2"), date("2026-01-12"));
        assert_eq!(completion.routine_id().unwrap().as_str(), "routine-1");
        assert_eq!(completion.plan_id().unwrap().as_str(), "plan-1");

        let one = toggle_completion(&[], completion.clone());
        let two = toggle_completion(&one, other.clone());
        assert_eq!(two, vec![completion.clone(), other.clone()]);
        assert_eq!(
            toggle_completion(
                &two,
                Completion::for_routine(id("routine-1"), date("2026-01-12"))
            ),
            vec![other]
        );
    }

    #[test]
    fn eligibility_derives_weekday_from_local_date() {
        let routine = Routine::new(
            id("routine-1"),
            "Weekend",
            "",
            minutes(30),
            ScheduleRule::weekends(),
            Timestamp::from_unix_seconds(1),
            date("2026-01-01"),
            None,
        )
        .unwrap();

        assert!(routine.is_eligible_on(&date("2026-01-11"))); // Sunday
        assert!(!routine.is_eligible_on(&date("2026-01-12"))); // Monday
    }
}
