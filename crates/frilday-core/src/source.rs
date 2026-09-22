use std::fmt;

/// Provider-neutral identity for an event imported from an external calendar.
///
/// The adapter that talks to a calendar provider is responsible for mapping
/// provider API data into these opaque identifiers. Keeping the values opaque
/// means the core does not need to know about OAuth, HTTP, or provider SDKs.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ExternalPlanIdentity {
    provider_id: String,
    calendar_id: String,
    event_id: String,
    occurrence_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanSourceError {
    EmptyProviderId,
    EmptyCalendarId,
    EmptyEventId,
    EmptyOccurrenceId,
}

impl fmt::Display for PlanSourceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::EmptyProviderId => "an external plan provider id must not be empty",
            Self::EmptyCalendarId => "an external plan calendar id must not be empty",
            Self::EmptyEventId => "an external plan event id must not be empty",
            Self::EmptyOccurrenceId => "an external plan occurrence id must not be empty",
        })
    }
}

impl std::error::Error for PlanSourceError {}

impl ExternalPlanIdentity {
    pub fn new(
        provider_id: impl Into<String>,
        calendar_id: impl Into<String>,
        event_id: impl Into<String>,
        occurrence_id: Option<impl Into<String>>,
    ) -> Result<Self, PlanSourceError> {
        let provider_id = provider_id.into();
        if provider_id.is_empty() {
            return Err(PlanSourceError::EmptyProviderId);
        }
        let calendar_id = calendar_id.into();
        if calendar_id.is_empty() {
            return Err(PlanSourceError::EmptyCalendarId);
        }
        let event_id = event_id.into();
        if event_id.is_empty() {
            return Err(PlanSourceError::EmptyEventId);
        }
        let occurrence_id = occurrence_id.map(Into::into);
        if occurrence_id.as_deref() == Some("") {
            return Err(PlanSourceError::EmptyOccurrenceId);
        }

        Ok(Self {
            provider_id,
            calendar_id,
            event_id,
            occurrence_id,
        })
    }

    pub fn provider_id(&self) -> &str {
        &self.provider_id
    }

    pub fn calendar_id(&self) -> &str {
        &self.calendar_id
    }

    pub fn event_id(&self) -> &str {
        &self.event_id
    }

    pub fn occurrence_id(&self) -> Option<&str> {
        self.occurrence_id.as_deref()
    }

    /// Return a deterministic, injective key for reconciliation and storage.
    ///
    /// Length-prefixing each UTF-8 component keeps the key unambiguous even
    /// when provider-owned identifiers contain the separator character.
    pub fn stable_key(&self) -> String {
        let occurrence = self
            .occurrence_id
            .as_deref()
            .map(|value| format!("1:{}:{}", value.len(), value))
            .unwrap_or_else(|| "0".to_owned());
        format!(
            "external-calendar:{}:{}:{}:{}:{}:{}",
            self.provider_id.len(),
            self.provider_id,
            self.calendar_id.len(),
            self.calendar_id,
            self.event_id.len(),
            self.event_id,
        ) + &format!(":{occurrence}")
    }
}

/// Whether an external source currently reports the event.
///
/// `Unavailable` is deliberately retained on the Plan instead of deleting the
/// record. That prevents an upstream calendar deletion from erasing FrilDay
/// execution history and lets a later reconciliation restore the event by the
/// same stable identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalPlanAvailability {
    Present,
    Unavailable,
}

/// Where a Plan originated. This is intentionally provider-neutral.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanSource {
    Local,
    ExternalCalendar {
        identity: ExternalPlanIdentity,
        availability: ExternalPlanAvailability,
    },
}

impl PlanSource {
    pub fn external(identity: ExternalPlanIdentity) -> Self {
        Self::ExternalCalendar {
            identity,
            availability: ExternalPlanAvailability::Present,
        }
    }

    pub fn external_unavailable(identity: ExternalPlanIdentity) -> Self {
        Self::ExternalCalendar {
            identity,
            availability: ExternalPlanAvailability::Unavailable,
        }
    }

    pub const fn is_local(&self) -> bool {
        matches!(self, Self::Local)
    }

    pub const fn is_external(&self) -> bool {
        matches!(self, Self::ExternalCalendar { .. })
    }

    pub fn external_identity(&self) -> Option<&ExternalPlanIdentity> {
        match self {
            Self::Local => None,
            Self::ExternalCalendar { identity, .. } => Some(identity),
        }
    }

    pub const fn external_availability(&self) -> Option<ExternalPlanAvailability> {
        match self {
            Self::Local => None,
            Self::ExternalCalendar { availability, .. } => Some(*availability),
        }
    }

    pub const fn is_available(&self) -> bool {
        match self {
            Self::Local => true,
            Self::ExternalCalendar { availability, .. } => {
                matches!(availability, ExternalPlanAvailability::Present)
            }
        }
    }

    pub fn mark_available(&mut self) {
        if let Self::ExternalCalendar { availability, .. } = self {
            *availability = ExternalPlanAvailability::Present;
        }
    }

    pub fn mark_unavailable(&mut self) {
        if let Self::ExternalCalendar { availability, .. } = self {
            *availability = ExternalPlanAvailability::Unavailable;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_key_distinguishes_occurrences_and_separator_values() {
        let event =
            ExternalPlanIdentity::new("provider", "calendar", "event", None::<String>).unwrap();
        let occurrence =
            ExternalPlanIdentity::new("provider", "calendar", "event", Some("occurrence")).unwrap();
        let separator =
            ExternalPlanIdentity::new("provider:calendar", "event", "occurrence", None::<String>)
                .unwrap();

        assert_ne!(event, occurrence);
        assert_ne!(event.stable_key(), occurrence.stable_key());
        assert_ne!(event.stable_key(), separator.stable_key());
    }

    #[test]
    fn empty_identity_parts_are_rejected() {
        assert_eq!(
            ExternalPlanIdentity::new("", "calendar", "event", None::<String>),
            Err(PlanSourceError::EmptyProviderId)
        );
        assert_eq!(
            ExternalPlanIdentity::new("provider", "calendar", "event", Some("")),
            Err(PlanSourceError::EmptyOccurrenceId)
        );
    }
}
