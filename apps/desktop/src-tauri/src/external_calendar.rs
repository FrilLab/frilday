use std::{collections::HashSet, fmt};

use frilday_core::{
    Completion, ExternalPlanIdentity, Plan, PlanId, PlanSourceError, PlannedDuration, Session,
};
use serde::Deserialize;

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
    pub date_ymd: String,
    pub planned_duration_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalReconciliationError {
    InvalidIdentity(PlanSourceError),
    InvalidDate(String),
    InvalidDuration,
    DuplicateIdentity(String),
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
        let incoming_plan = Plan::from_external(identity.clone(), date, duration);

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
                current.refresh_external_snapshot(
                    incoming_plan.date(),
                    incoming_plan.baseline_duration(),
                );
            }
        } else {
            next.push(incoming_plan);
        }
    }

    for plan in &mut next {
        if plan.source().is_external() && !incoming_ids.contains(plan.id()) {
            plan.mark_source_unavailable();
        }
    }

    Ok(next)
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
        Plan::from_external(
            identity,
            LocalDate::parse(&event.date_ymd).unwrap(),
            PlannedDuration::from_minutes(event.planned_duration_minutes).unwrap(),
        )
    }

    #[test]
    fn same_source_identity_updates_one_plan_without_duplicates() {
        let initial = event("2026-01-05", 30);
        let mut updated = event("2026-01-06", 45);
        updated.event_id = initial.event_id.clone();
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
}
