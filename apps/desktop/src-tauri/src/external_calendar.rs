use std::{collections::HashSet, fmt};

use frilday_core::{
    Completion, ExternalPlanAvailability, ExternalPlanIdentity, LocalDate, Plan, PlanId,
    PlanSource, PlanSourceError, PlanStatus, PlannedDuration, Session, SessionId, Timestamp,
};
use serde::Deserialize;

use crate::persistence::{CompletionRecord, PlanRecord, TimeEntryRecord};

/// Provider-neutral event data produced by a calendar adapter.
///
/// A Google, CalDAV, or other provider integration belongs outside this
/// module. It should translate its API DTOs into this shape before calling the
/// reconciliation boundary below.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedExternalEvent {
    pub provider_id: String,
    pub calendar_id: String,
    pub event_id: String,
    #[serde(default)]
    pub occurrence_id: Option<String>,
    pub title: String,
    pub date_ymd: String,
    pub planned_duration_minutes: u32,
}

/// A provider change can either contain the current event snapshot or a
/// tombstone. Tombstones are important for incremental feeds: an event that
/// was cancelled, deleted, or no longer matches the import convention is not
/// present in the provider's current payload, but its stable identity still
/// lets us mark the existing Plan unavailable without deleting its history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalEventChange {
    Upsert(NormalizedExternalEvent),
    Remove {
        provider_id: String,
        calendar_id: String,
        event_id: String,
        occurrence_id: Option<String>,
    },
}

/// Inclusive date range used by an external import. Plans outside this range
/// are not changed when a provider is refreshed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExternalImportWindow {
    pub start: frilday_core::LocalDate,
    pub end: frilday_core::LocalDate,
}

impl ExternalImportWindow {
    pub fn new(
        start: frilday_core::LocalDate,
        end: frilday_core::LocalDate,
    ) -> Result<Self, ExternalReconciliationError> {
        if start > end {
            return Err(ExternalReconciliationError::InvalidWindow);
        }
        Ok(Self { start, end })
    }

    pub fn contains(self, date: frilday_core::LocalDate) -> bool {
        date >= self.start && date <= self.end
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalReconciliationError {
    InvalidIdentity(PlanSourceError),
    InvalidDate(String),
    InvalidDuration,
    DuplicateIdentity(String),
    InvalidWindow,
}

impl fmt::Display for ExternalReconciliationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidIdentity(error) => error.fmt(formatter),
            Self::InvalidDate(error) => write!(formatter, "invalid external event date: {error}"),
            Self::InvalidDuration => {
                formatter.write_str("an external event planned duration must be positive")
            }
            Self::DuplicateIdentity(identity) => {
                write!(formatter, "duplicate external event identity: {identity}")
            }
            Self::InvalidWindow => formatter.write_str("external import window is invalid"),
        }
    }
}

impl std::error::Error for ExternalReconciliationError {}

/// Reconcile normalized external events with persisted Plans.
///
/// The source identity, not a provider-specific payload or a calendar title,
/// decides whether an incoming event updates an existing Plan. Missing events
/// are retained and marked unavailable rather than deleted. That keeps
/// Session/Completion history reviewable and allows a later reappearance to
/// reactivate the same Plan identity.
pub fn reconcile_external_plans(
    existing: &[Plan],
    incoming: &[NormalizedExternalEvent],
    completions: &[Completion],
    sessions: &[Session],
) -> Result<Vec<Plan>, ExternalReconciliationError> {
    reconcile_external_plans_in_window(existing, incoming, completions, sessions, None, None)
}

/// Reconcile imported Plans while limiting disappearance handling to one
/// provider and an inclusive date range. This prevents a refresh of one
/// calendar window from making unrelated imported Plans unavailable.
pub fn reconcile_external_plans_in_window(
    existing: &[Plan],
    incoming: &[NormalizedExternalEvent],
    completions: &[Completion],
    sessions: &[Session],
    provider_id: Option<&str>,
    window: Option<ExternalImportWindow>,
) -> Result<Vec<Plan>, ExternalReconciliationError> {
    let mut incoming_ids = HashSet::<PlanId>::new();
    let mut next = existing.to_vec();

    for event in incoming {
        let identity = ExternalPlanIdentity::new(
            event.provider_id.clone(),
            event.calendar_id.clone(),
            event.event_id.clone(),
            event.occurrence_id.clone(),
        )
        .map_err(ExternalReconciliationError::InvalidIdentity)?;
        let date = frilday_core::LocalDate::parse(&event.date_ymd)
            .map_err(|error| ExternalReconciliationError::InvalidDate(error.to_string()))?;
        let duration = PlannedDuration::from_minutes(event.planned_duration_minutes)
            .ok_or(ExternalReconciliationError::InvalidDuration)?;
        let incoming_plan = Plan::from_external_with_title(
            identity.clone(),
            normalize_title(&event.title),
            date,
            duration,
        );

        if !incoming_ids.insert(incoming_plan.id().clone()) {
            return Err(ExternalReconciliationError::DuplicateIdentity(
                identity.stable_key(),
            ));
        }

        if let Some(current) = next
            .iter_mut()
            .find(|plan| plan.external_identity() == Some(&identity))
        {
            let has_history = current.has_history(completions, sessions);
            current.mark_source_available();
            if !has_history {
                current.refresh_external_snapshot_with_title(
                    incoming_plan.date(),
                    incoming_plan.baseline_duration(),
                    incoming_plan.title().map(str::to_owned),
                );
            }
        } else {
            next.push(incoming_plan);
        }
    }

    for plan in &mut next {
        let should_reconcile_disappearance = plan.source().is_external()
            && provider_id.is_none_or(|provider| {
                plan.external_identity()
                    .is_some_and(|identity| identity.provider_id() == provider)
            })
            && window.is_none_or(|import_window| import_window.contains(plan.date()));
        if should_reconcile_disappearance && !incoming_ids.contains(plan.id()) {
            plan.mark_source_unavailable();
        }
    }

    Ok(next)
}

/// Reconcile a complete or incremental provider response.
///
/// `full_rescan_calendar_ids` identifies calendars for which the provider
/// returned a complete collection. Only those calendars receive missing-item
/// reconciliation; incremental responses must never make unrelated Plans
/// unavailable merely because they were not included in a change feed.
pub fn reconcile_external_plans_with_changes(
    existing: &[Plan],
    changes: &[ExternalEventChange],
    completions: &[Completion],
    sessions: &[Session],
    provider_id: &str,
    selected_calendar_ids: &HashSet<String>,
    full_rescan_calendar_ids: &HashSet<String>,
    window: ExternalImportWindow,
) -> Result<Vec<Plan>, ExternalReconciliationError> {
    let mut seen_ids = HashSet::<PlanId>::new();
    let mut next = existing.to_vec();

    for change in changes {
        let (identity, incoming_plan) = match change {
            ExternalEventChange::Upsert(event) => {
                let identity = ExternalPlanIdentity::new(
                    event.provider_id.clone(),
                    event.calendar_id.clone(),
                    event.event_id.clone(),
                    event.occurrence_id.clone(),
                )
                .map_err(ExternalReconciliationError::InvalidIdentity)?;
                let date = LocalDate::parse(&event.date_ymd)
                    .map_err(|error| ExternalReconciliationError::InvalidDate(error.to_string()))?;
                let duration = PlannedDuration::from_minutes(event.planned_duration_minutes)
                    .ok_or(ExternalReconciliationError::InvalidDuration)?;
                (
                    identity.clone(),
                    Some(Plan::from_external_with_title(
                        identity,
                        normalize_title(&event.title),
                        date,
                        duration,
                    )),
                )
            }
            ExternalEventChange::Remove {
                provider_id,
                calendar_id,
                event_id,
                occurrence_id,
            } => {
                let identity = ExternalPlanIdentity::new(
                    provider_id.clone(),
                    calendar_id.clone(),
                    event_id.clone(),
                    occurrence_id.clone(),
                )
                .map_err(ExternalReconciliationError::InvalidIdentity)?;
                (identity, None)
            }
        };
        let plan_id = Plan::id_for_external_source(&identity);
        if !seen_ids.insert(plan_id.clone()) {
            return Err(ExternalReconciliationError::DuplicateIdentity(
                identity.stable_key(),
            ));
        }

        if let Some(incoming_plan) = incoming_plan {
            if !window.contains(incoming_plan.date()) {
                continue;
            }
            if let Some(current) = next
                .iter_mut()
                .find(|plan| plan.external_identity() == Some(&identity))
            {
                let has_history = current.has_history(completions, sessions);
                current.mark_source_available();
                if !has_history {
                    current.refresh_external_snapshot_with_title(
                        incoming_plan.date(),
                        incoming_plan.baseline_duration(),
                        incoming_plan.title().map(str::to_owned),
                    );
                }
            } else {
                next.push(incoming_plan);
            }
        } else if let Some(current) = next
            .iter_mut()
            .find(|plan| plan.external_identity() == Some(&identity))
        {
            current.mark_source_unavailable();
        }
    }

    for plan in &mut next {
        let Some(identity) = plan.external_identity() else {
            continue;
        };
        if identity.provider_id() != provider_id {
            continue;
        }

        // A calendar that is no longer selected is never allowed to keep an
        // executable imported Plan. The record stays in place for review and
        // can be reactivated if the calendar is selected again later.
        if !selected_calendar_ids.contains(identity.calendar_id()) {
            plan.mark_source_unavailable();
            continue;
        }

        if full_rescan_calendar_ids.contains(identity.calendar_id())
            && window.contains(plan.date())
            && !seen_ids.contains(plan.id())
        {
            plan.mark_source_unavailable();
        }
    }

    Ok(next)
}

fn normalize_title(title: &str) -> Option<String> {
    let title = title.trim();
    (!title.is_empty()).then(|| title.to_owned())
}

/// Apply the core reconciliation rules to persisted desktop records and
/// return records ready for one SQLite transaction. Calendar duration only
/// changes Plan intent; no Completion or Session record is created here.
pub fn reconcile_external_plan_records(
    existing: &[PlanRecord],
    incoming: &[NormalizedExternalEvent],
    completions: &[CompletionRecord],
    time_entries: &[TimeEntryRecord],
    provider_id: &str,
    window: ExternalImportWindow,
) -> Result<Vec<PlanRecord>, String> {
    let mut selected_calendar_ids = HashSet::new();
    for record in existing {
        if let (Some(provider), Some(calendar)) = (
            record.source.provider_id.as_deref(),
            record.source.calendar_id.as_deref(),
        ) {
            if provider == provider_id {
                selected_calendar_ids.insert(calendar.to_owned());
            }
        }
    }
    for event in incoming {
        if event.provider_id == provider_id {
            selected_calendar_ids.insert(event.calendar_id.clone());
        }
    }
    let full_rescan_calendar_ids = selected_calendar_ids.clone();
    let changes = incoming
        .iter()
        .cloned()
        .map(ExternalEventChange::Upsert)
        .collect::<Vec<_>>();
    reconcile_external_plan_records_with_changes(
        existing,
        &changes,
        completions,
        time_entries,
        provider_id,
        &selected_calendar_ids,
        &full_rescan_calendar_ids,
        window,
    )
}

/// Apply the same reconciliation rules to persisted desktop records.
pub fn reconcile_external_plan_records_with_changes(
    existing: &[PlanRecord],
    changes: &[ExternalEventChange],
    completions: &[CompletionRecord],
    time_entries: &[TimeEntryRecord],
    provider_id: &str,
    selected_calendar_ids: &HashSet<String>,
    full_rescan_calendar_ids: &HashSet<String>,
    window: ExternalImportWindow,
) -> Result<Vec<PlanRecord>, String> {
    let existing_plans = existing
        .iter()
        .map(plan_from_record)
        .collect::<Result<Vec<_>, _>>()?;
    let history_completions = completions
        .iter()
        .filter_map(|completion| {
            completion
                .plan_id
                .as_ref()
                .map(|plan_id| (plan_id, completion))
        })
        .map(|(plan_id, completion)| {
            Ok(Completion::for_plan(
                PlanId::new(plan_id.clone()).map_err(|error| error.to_string())?,
                LocalDate::parse(&completion.date).map_err(|error| error.to_string())?,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let history_sessions = time_entries
        .iter()
        .filter_map(|entry| entry.plan_id.as_ref().map(|plan_id| (plan_id, entry)))
        .map(|(plan_id, entry)| {
            Session::start(
                SessionId::new(entry.id.clone()).map_err(|error| error.to_string())?,
                None,
                Some(PlanId::new(plan_id.clone()).map_err(|error| error.to_string())?),
                LocalDate::parse(&entry.date).map_err(|error| error.to_string())?,
                Timestamp::from_unix_millis(0),
            )
            .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, String>>()?;

    let reconciled = reconcile_external_plans_with_changes(
        &existing_plans,
        changes,
        &history_completions,
        &history_sessions,
        provider_id,
        selected_calendar_ids,
        full_rescan_calendar_ids,
        window,
    )
    .map_err(|error| error.to_string())?;
    reconciled.iter().map(plan_to_record).collect()
}

/// Mark imported Plans whose calendar is no longer selected as unavailable.
/// This is used when selection changes or the account is disconnected; it
/// intentionally does not delete Plans, Sessions, or Completions.
pub fn mark_external_plan_records_unavailable_for_selection(
    existing: &[PlanRecord],
    provider_id: &str,
    selected_calendar_ids: &HashSet<String>,
) -> Result<Vec<PlanRecord>, String> {
    existing
        .iter()
        .map(plan_from_record)
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut plan| {
            if plan.external_identity().is_some_and(|identity| {
                identity.provider_id() == provider_id
                    && !selected_calendar_ids.contains(identity.calendar_id())
            }) {
                plan.mark_source_unavailable();
            }
            plan_to_record(&plan)
        })
        .collect()
}

fn plan_from_record(record: &PlanRecord) -> Result<Plan, String> {
    let source = match record.source.kind.as_str() {
        "local" => PlanSource::Local,
        "externalCalendar" => {
            let identity = ExternalPlanIdentity::new(
                record
                    .source
                    .provider_id
                    .clone()
                    .ok_or_else(|| "external Plan is missing a provider id".to_owned())?,
                record
                    .source
                    .calendar_id
                    .clone()
                    .ok_or_else(|| "external Plan is missing a calendar id".to_owned())?,
                record
                    .source
                    .event_id
                    .clone()
                    .ok_or_else(|| "external Plan is missing an event id".to_owned())?,
                record.source.occurrence_id.clone(),
            )
            .map_err(|error| error.to_string())?;
            match record.source.availability.as_str() {
                "present" => PlanSource::external(identity),
                "unavailable" => PlanSource::external_unavailable(identity),
                other => return Err(format!("unknown external Plan availability: {other}")),
            }
        }
        other => return Err(format!("unknown Plan source kind: {other}")),
    };
    let baseline = PlannedDuration::from_minutes(record.baseline_duration_minutes)
        .ok_or_else(|| "external Plan duration must be positive".to_owned())?;
    let override_duration = record
        .duration_override_minutes
        .map(|minutes| {
            PlannedDuration::from_minutes(minutes)
                .ok_or_else(|| "external Plan duration override must be positive".to_owned())
        })
        .transpose()?;
    let status = match record.status.as_str() {
        "planned" => PlanStatus::Planned,
        "skipped" => PlanStatus::Skipped,
        "moved" => PlanStatus::MovedTo(
            record
                .moved_to_ymd
                .as_deref()
                .ok_or_else(|| "moved Plan is missing its destination date".to_owned())
                .and_then(|date| LocalDate::parse(date).map_err(|error| error.to_string()))?,
        ),
        other => return Err(format!("unknown Plan status: {other}")),
    };
    Plan::from_persisted_with_source_and_title(
        PlanId::new(record.id.clone()).map_err(|error| error.to_string())?,
        record
            .routine_id
            .clone()
            .map(frilday_core::RoutineId::new)
            .transpose()
            .map_err(|error| error.to_string())?,
        record.title.clone(),
        LocalDate::parse(&record.date).map_err(|error| error.to_string())?,
        baseline,
        override_duration,
        status,
        source,
    )
    .map_err(|error| error.to_string())
}

fn plan_to_record(plan: &Plan) -> Result<PlanRecord, String> {
    let source = match plan.source() {
        PlanSource::Local => crate::persistence::PlanSourceRecord::default(),
        PlanSource::ExternalCalendar {
            identity,
            availability,
        } => crate::persistence::PlanSourceRecord {
            kind: "externalCalendar".to_owned(),
            provider_id: Some(identity.provider_id().to_owned()),
            calendar_id: Some(identity.calendar_id().to_owned()),
            event_id: Some(identity.event_id().to_owned()),
            occurrence_id: identity.occurrence_id().map(str::to_owned),
            availability: match availability {
                ExternalPlanAvailability::Present => "present".to_owned(),
                ExternalPlanAvailability::Unavailable => "unavailable".to_owned(),
            },
        },
    };
    let (status, moved_to_ymd) = match plan.status() {
        PlanStatus::Planned => ("planned", None),
        PlanStatus::Skipped => ("skipped", None),
        PlanStatus::MovedTo(date) => ("moved", Some(date.to_string())),
    };
    Ok(PlanRecord {
        id: plan.id().to_string(),
        routine_id: plan.routine_id().map(ToString::to_string),
        title: plan.title().map(str::to_owned),
        date: plan.date().to_string(),
        baseline_duration_minutes: plan.baseline_duration().minutes(),
        duration_override_minutes: plan.duration_override().map(PlannedDuration::minutes),
        status: status.to_owned(),
        moved_to_ymd,
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use frilday_core::{LocalDate, Timestamp};

    fn event(date_ymd: &str, planned_duration_minutes: u32) -> NormalizedExternalEvent {
        NormalizedExternalEvent {
            provider_id: "calendar-provider".to_owned(),
            calendar_id: "calendar-1".to_owned(),
            event_id: "event-1".to_owned(),
            occurrence_id: Some("occurrence-1".to_owned()),
            title: "Rust study".to_owned(),
            date_ymd: date_ymd.to_owned(),
            planned_duration_minutes,
        }
    }

    fn plan_for(event: &NormalizedExternalEvent) -> Plan {
        let identity = ExternalPlanIdentity::new(
            event.provider_id.clone(),
            event.calendar_id.clone(),
            event.event_id.clone(),
            event.occurrence_id.clone(),
        )
        .unwrap();
        Plan::from_external_with_title(
            identity,
            Some(event.title.clone()),
            LocalDate::parse(&event.date_ymd).unwrap(),
            PlannedDuration::from_minutes(event.planned_duration_minutes).unwrap(),
        )
    }

    #[test]
    fn same_source_identity_updates_one_plan_without_duplicates() {
        let initial = event("2026-01-05", 30);
        let mut updated = event("2026-01-06", 45);
        updated.event_id = initial.event_id.clone();
        updated.title = "Updated study".to_owned();
        let existing = plan_for(&initial);

        let reconciled =
            reconcile_external_plans(std::slice::from_ref(&existing), &[updated], &[], &[])
                .unwrap();

        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].id(), existing.id());
        assert_eq!(
            reconciled[0].date(),
            LocalDate::parse("2026-01-06").unwrap()
        );
        assert_eq!(reconciled[0].baseline_duration().minutes(), 45);
        assert_eq!(reconciled[0].title(), Some("Updated study"));
        assert!(reconciled[0].source().is_available());
    }

    #[test]
    fn disappeared_event_is_retained_and_history_is_not_deleted() {
        let input = event("2026-01-05", 30);
        let existing = plan_for(&input);
        let session = Session::new(
            frilday_core::SessionId::new("session-1").unwrap(),
            None,
            Some(existing.id().clone()),
            LocalDate::parse("2026-01-05").unwrap(),
            Timestamp::from_unix_seconds(1_767_600_000),
            Some(Timestamp::from_unix_seconds(1_767_601_800)),
        )
        .unwrap();

        let reconciled = reconcile_external_plans(
            std::slice::from_ref(&existing),
            &[],
            &[],
            std::slice::from_ref(&session),
        )
        .unwrap();

        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].id(), existing.id());
        assert!(!reconciled[0].is_executable());
        assert!(reconciled[0].has_history(&[], std::slice::from_ref(&session)));
    }

    #[test]
    fn historical_snapshot_is_not_rewritten_by_an_upstream_update() {
        let initial = event("2026-01-05", 30);
        let existing = plan_for(&initial);
        let completion = Completion::for_plan(
            existing.id().clone(),
            LocalDate::parse("2026-01-05").unwrap(),
        );
        let updated = event("2026-01-06", 45);

        let reconciled = reconcile_external_plans(
            std::slice::from_ref(&existing),
            &[updated],
            std::slice::from_ref(&completion),
            &[],
        )
        .unwrap();

        assert_eq!(reconciled[0].date(), existing.date());
        assert_eq!(
            reconciled[0].baseline_duration(),
            existing.baseline_duration()
        );
        assert!(reconciled[0].source().is_available());
    }

    #[test]
    fn duplicate_incoming_identity_is_rejected() {
        let input = event("2026-01-05", 30);
        let error = reconcile_external_plans(&[], &[input.clone(), input], &[], &[]).unwrap_err();

        assert!(matches!(
            error,
            ExternalReconciliationError::DuplicateIdentity(_)
        ));
    }

    #[test]
    fn incremental_tombstone_only_marks_the_changed_identity_unavailable() {
        let first = event("2026-01-05", 30);
        let mut second = event("2026-01-06", 45);
        second.event_id = "event-2".to_owned();
        let existing = vec![plan_for(&first), plan_for(&second)];
        let changes = vec![ExternalEventChange::Remove {
            provider_id: first.provider_id.clone(),
            calendar_id: first.calendar_id.clone(),
            event_id: first.event_id.clone(),
            occurrence_id: first.occurrence_id.clone(),
        }];
        let selected = HashSet::from(["calendar-1".to_owned()]);

        let reconciled = reconcile_external_plans_with_changes(
            &existing,
            &changes,
            &[],
            &[],
            "calendar-provider",
            &selected,
            &HashSet::new(),
            ExternalImportWindow::new(
                LocalDate::parse("2026-01-01").unwrap(),
                LocalDate::parse("2026-01-31").unwrap(),
            )
            .unwrap(),
        )
        .unwrap();

        assert!(!reconciled[0].source().is_available());
        assert!(reconciled[1].source().is_available());
    }

    #[test]
    fn deselected_calendar_is_retained_but_not_executable() {
        let input = event("2026-01-05", 30);
        let existing = plan_for(&input);

        let reconciled = reconcile_external_plans_with_changes(
            std::slice::from_ref(&existing),
            &[],
            &[],
            &[],
            "calendar-provider",
            &HashSet::new(),
            &HashSet::new(),
            ExternalImportWindow::new(
                LocalDate::parse("2026-01-01").unwrap(),
                LocalDate::parse("2026-01-31").unwrap(),
            )
            .unwrap(),
        )
        .unwrap();

        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].id(), existing.id());
        assert!(!reconciled[0].is_executable());
    }

    #[test]
    fn scoped_reconciliation_does_not_touch_plans_outside_the_import_window() {
        let existing_event = event("2026-02-01", 30);
        let existing = plan_for(&existing_event);
        let window = ExternalImportWindow::new(
            LocalDate::parse("2026-01-01").unwrap(),
            LocalDate::parse("2026-01-31").unwrap(),
        )
        .unwrap();

        let reconciled = reconcile_external_plans_in_window(
            std::slice::from_ref(&existing),
            &[],
            &[],
            &[],
            Some("calendar-provider"),
            Some(window),
        )
        .unwrap();

        assert!(reconciled[0].source().is_available());
    }

    #[test]
    fn persisted_import_is_repeat_safe_and_does_not_create_actual_time() {
        let incoming = event("2026-01-05", 90);
        let window = ExternalImportWindow::new(
            LocalDate::parse("2026-01-01").unwrap(),
            LocalDate::parse("2026-01-31").unwrap(),
        )
        .unwrap();
        let first = reconcile_external_plan_records(
            &[],
            std::slice::from_ref(&incoming),
            &[],
            &[],
            "calendar-provider",
            window,
        )
        .unwrap();
        let second = reconcile_external_plan_records(
            &first,
            std::slice::from_ref(&incoming),
            &[],
            &[],
            "calendar-provider",
            window,
        )
        .unwrap();

        assert_eq!(first, second);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].title.as_deref(), Some("Rust study"));
        assert_eq!(second[0].baseline_duration_minutes, 90);
    }

    #[test]
    fn persisted_history_protects_the_external_snapshot() {
        let initial = event("2026-01-05", 30);
        let window = ExternalImportWindow::new(
            LocalDate::parse("2026-01-01").unwrap(),
            LocalDate::parse("2026-01-31").unwrap(),
        )
        .unwrap();
        let existing = reconcile_external_plan_records(
            &[],
            std::slice::from_ref(&initial),
            &[],
            &[],
            "calendar-provider",
            window,
        )
        .unwrap();
        let completion = CompletionRecord {
            task_id: "external".to_owned(),
            plan_id: Some(existing[0].id.clone()),
            date: initial.date_ymd.clone(),
        };
        let mut updated = initial.clone();
        updated.date_ymd = "2026-01-06".to_owned();
        updated.planned_duration_minutes = 60;
        updated.title = "Changed upstream".to_owned();

        let reconciled = reconcile_external_plan_records(
            &existing,
            &[updated],
            &[completion],
            &[],
            "calendar-provider",
            window,
        )
        .unwrap();

        assert_eq!(reconciled[0].date, "2026-01-05");
        assert_eq!(reconciled[0].baseline_duration_minutes, 30);
        assert_eq!(reconciled[0].title.as_deref(), Some("Rust study"));
    }
}
