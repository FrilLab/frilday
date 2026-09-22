use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, FixedOffset};
use frilday_core::LocalDate;
use keyring::Entry;
use rand::RngCore;
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tauri::State;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::DbInstances;
use url::Url;

use crate::{
    external_calendar::{
        mark_external_plan_records_unavailable_for_selection,
        reconcile_external_plan_records_with_changes, ExternalEventChange, ExternalImportWindow,
        NormalizedExternalEvent,
    },
    persistence::{database_pool, load_app_data_from_pool, save_plan_records},
};

const GOOGLE_CLIENT_ID_ENV: &str = "FRILDAY_GOOGLE_CLIENT_ID";
const GOOGLE_CALENDAR_READONLY_SCOPES: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_LIST_ENDPOINT: &str =
    "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_CALENDAR_EVENTS_ENDPOINT: &str = "https://www.googleapis.com/calendar/v3/calendars/";
const GOOGLE_PROVIDER_ID: &str = "googleCalendar";
const GOOGLE_CALENDAR_CONFIG_KEY: &str = "integration.googleCalendar.config.v1";
const KEYRING_SERVICE: &str = "com.frillab.frilday.google-calendar";
const KEYRING_ACCOUNT: &str = "oauth-token";
const CALLBACK_PATH: &str = "/oauth2/callback";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarSummary {
    pub id: String,
    pub summary: String,
    pub description: Option<String>,
    pub primary: bool,
    pub access_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarViewState {
    pub client_configured: bool,
    pub connected: bool,
    pub reauthorization_required: bool,
    pub selected_calendar_ids: Vec<String>,
    pub calendars: Vec<GoogleCalendarSummary>,
    pub last_sync_at: Option<String>,
    pub last_sync_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarSelectionRequest {
    pub selected_calendar_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarImportRequest {
    pub start_ymd: String,
    pub end_ymd: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarImportOutput {
    pub imported_event_count: usize,
    pub skipped_event_count: usize,
    pub plan_count: usize,
    pub start_ymd: String,
    pub end_ymd: String,
    pub incremental_calendar_count: usize,
    pub full_rescan_calendar_count: usize,
    pub removed_event_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarSyncState {
    #[serde(default)]
    next_sync_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarConfig {
    #[serde(default)]
    selected_calendar_ids: Vec<String>,
    #[serde(default = "default_import_mode")]
    import_mode: String,
    #[serde(default)]
    calendars: Vec<GoogleCalendarSummary>,
    #[serde(default = "default_auth_status")]
    auth_status: String,
    #[serde(default)]
    sync_states: HashMap<String, GoogleCalendarSyncState>,
    #[serde(default)]
    last_sync_at: Option<String>,
    #[serde(default)]
    last_sync_error: Option<String>,
}

impl Default for GoogleCalendarConfig {
    fn default() -> Self {
        Self {
            selected_calendar_ids: Vec::new(),
            import_mode: default_import_mode(),
            calendars: Vec::new(),
            auth_status: default_auth_status(),
            sync_states: HashMap::new(),
            last_sync_at: None,
            last_sync_error: None,
        }
    }
}

fn default_import_mode() -> String {
    "selectedCalendars".to_owned()
}

fn default_auth_status() -> String {
    "disconnected".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredGoogleToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_at_unix_seconds: i64,
    token_type: String,
}

impl StoredGoogleToken {
    fn is_expired(&self) -> bool {
        unix_now() + 60 >= self.expires_at_unix_seconds
    }
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    expires_in: u64,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default = "default_token_type")]
    token_type: String,
}

fn default_token_type() -> String {
    "Bearer".to_owned()
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarListResponse {
    #[serde(default)]
    items: Vec<GoogleCalendarDto>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarEventDateTime {
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    date_time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarEventDto {
    id: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    start: Option<GoogleCalendarEventDateTime>,
    #[serde(default)]
    end: Option<GoogleCalendarEventDateTime>,
    #[serde(default)]
    recurring_event_id: Option<String>,
    #[serde(default)]
    original_start_time: Option<GoogleCalendarEventDateTime>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarEventsResponse {
    #[serde(default)]
    items: Vec<GoogleCalendarEventDto>,
    #[serde(default)]
    next_page_token: Option<String>,
    #[serde(default)]
    next_sync_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarDto {
    id: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    access_role: Option<String>,
}

impl From<GoogleCalendarDto> for GoogleCalendarSummary {
    fn from(calendar: GoogleCalendarDto) -> Self {
        Self {
            id: calendar.id,
            summary: if calendar.summary.trim().is_empty() {
                "Untitled calendar".to_owned()
            } else {
                calendar.summary
            },
            description: calendar.description,
            primary: calendar.primary,
            access_role: calendar.access_role,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum GoogleCalendarError {
    NotConfigured,
    SecureStorage,
    NotConnected,
    ReauthorizationRequired,
    AuthorizationCancelled,
    AuthorizationFailed,
    NetworkUnavailable,
    PermissionDenied,
    ProviderUnavailable,
    InvalidProviderResponse,
    SyncTokenExpired,
    InvalidSelection,
    CallbackFailed,
    Database(String),
    Browser(String),
}

impl std::fmt::Display for GoogleCalendarError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::NotConfigured => {
                "Google Calendar is not configured. Set FRILDAY_GOOGLE_CLIENT_ID when building FrilDay."
            }
            Self::SecureStorage => {
                "The operating system secure credential store is unavailable."
            }
            Self::NotConnected => "Connect a Google account before loading calendars.",
            Self::ReauthorizationRequired => {
                "Google authorization expired or was revoked. Reconnect Google Calendar."
            }
            Self::AuthorizationCancelled => {
                "Google authorization was cancelled. FrilDay local data is unchanged."
            }
            Self::AuthorizationFailed => {
                "Google authorization could not be completed. Check the account and try again."
            }
            Self::NetworkUnavailable => {
                "Google Calendar could not be reached. Check the network and try again."
            }
            Self::PermissionDenied => {
                "Google Calendar permission was denied. Reconnect and allow read-only access."
            }
            Self::ProviderUnavailable => {
                "Google Calendar is temporarily unavailable. Try again later."
            }
            Self::InvalidProviderResponse => {
                "Google Calendar returned an unexpected response. Try reconnecting."
            }
            Self::SyncTokenExpired => "Google Calendar sync state expired. FrilDay will rescan it.",
            Self::InvalidSelection => {
                "Select only calendars that are available for Google Calendar import."
            }
            Self::CallbackFailed => {
                "FrilDay could not receive the Google authorization callback. Try again."
            }
            Self::Database(error) => return write!(formatter, "{error}"),
            Self::Browser(error) => return write!(formatter, "Could not open the browser: {error}"),
        })
    }
}

impl std::error::Error for GoogleCalendarError {}

#[derive(Debug)]
struct PreparedAuthorization {
    listener: TcpListener,
    state: String,
    code_verifier: String,
    redirect_uri: String,
    authorization_url: Url,
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn configured_client_id() -> Option<String> {
    std::env::var(GOOGLE_CLIENT_ID_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("FRILDAY_GOOGLE_CLIENT_ID").map(str::to_owned))
}

fn random_urlsafe_value(byte_length: usize) -> String {
    let mut bytes = vec![0_u8; byte_length];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn prepare_authorization(client_id: &str) -> Result<PreparedAuthorization, GoogleCalendarError> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|_| GoogleCalendarError::CallbackFailed)?;
    let port = listener
        .local_addr()
        .map_err(|_| GoogleCalendarError::CallbackFailed)?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let state = random_urlsafe_value(32);
    let code_verifier = random_urlsafe_value(64);
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    let mut authorization_url = Url::parse(GOOGLE_AUTH_ENDPOINT)
        .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
    authorization_url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("redirect_uri", redirect_uri.as_str()),
        ("response_type", "code"),
        ("scope", GOOGLE_CALENDAR_READONLY_SCOPES),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("code_challenge", code_challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state.as_str()),
    ]);

    Ok(PreparedAuthorization {
        listener,
        state,
        code_verifier,
        redirect_uri,
        authorization_url,
    })
}

fn secure_token_entry() -> Result<Entry, GoogleCalendarError> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|_| GoogleCalendarError::SecureStorage)
}

fn load_stored_token() -> Result<Option<StoredGoogleToken>, GoogleCalendarError> {
    let entry = secure_token_entry()?;
    match entry.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|_| GoogleCalendarError::SecureStorage),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(GoogleCalendarError::SecureStorage),
    }
}

fn store_token(token: &StoredGoogleToken) -> Result<(), GoogleCalendarError> {
    let entry = secure_token_entry()?;
    let value = serde_json::to_string(token).map_err(|_| GoogleCalendarError::SecureStorage)?;
    entry
        .set_password(&value)
        .map_err(|_| GoogleCalendarError::SecureStorage)
}

fn delete_stored_token() -> Result<(), GoogleCalendarError> {
    let entry = secure_token_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(GoogleCalendarError::SecureStorage),
    }
}

async fn load_config(pool: &SqlitePool) -> Result<GoogleCalendarConfig, GoogleCalendarError> {
    let row: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings_kv WHERE key = ? LIMIT 1")
            .bind(GOOGLE_CALENDAR_CONFIG_KEY)
            .fetch_optional(pool)
            .await
            .map_err(|error| {
                GoogleCalendarError::Database(format!("Failed to load calendar settings: {error}"))
            })?;

    match row {
        Some(value) => serde_json::from_str(&value).map_err(|_| {
            GoogleCalendarError::Database("Saved Google Calendar settings are invalid.".to_owned())
        }),
        None => Ok(GoogleCalendarConfig::default()),
    }
}

async fn save_config(
    pool: &SqlitePool,
    config: &GoogleCalendarConfig,
) -> Result<(), GoogleCalendarError> {
    let value = serde_json::to_string(config).map_err(|_| {
        GoogleCalendarError::Database("Failed to encode calendar settings.".to_owned())
    })?;
    sqlx::query(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(GOOGLE_CALENDAR_CONFIG_KEY)
    .bind(value)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| {
        GoogleCalendarError::Database(format!("Failed to save calendar settings: {error}"))
    })
}

fn view_state(
    config: GoogleCalendarConfig,
    token: Option<&StoredGoogleToken>,
) -> GoogleCalendarViewState {
    let connected = token.is_some() && config.auth_status != "reauthorizationRequired";
    GoogleCalendarViewState {
        client_configured: configured_client_id().is_some(),
        connected,
        reauthorization_required: config.auth_status == "reauthorizationRequired"
            || (token.is_none() && config.auth_status == "connected"),
        selected_calendar_ids: config.selected_calendar_ids,
        calendars: config.calendars,
        last_sync_at: config.last_sync_at,
        last_sync_error: config.last_sync_error,
    }
}

async fn mark_reauthorization_required(pool: &SqlitePool) -> Result<(), GoogleCalendarError> {
    let mut config = load_config(pool).await?;
    config.auth_status = "reauthorizationRequired".to_owned();
    save_config(pool, &config).await
}

async fn exchange_authorization_code(
    client: &Client,
    client_id: &str,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<StoredGoogleToken, GoogleCalendarError> {
    let response = client
        .post(GOOGLE_TOKEN_ENDPOINT)
        .form(&[
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", code_verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|_| GoogleCalendarError::NetworkUnavailable)?;

    if response.status() == StatusCode::BAD_REQUEST {
        return Err(GoogleCalendarError::AuthorizationFailed);
    }
    if !response.status().is_success() {
        return Err(provider_error(&response));
    }

    let token = response
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
    Ok(StoredGoogleToken {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at_unix_seconds: unix_now() + i64::try_from(token.expires_in).unwrap_or(i64::MAX),
        token_type: token.token_type,
    })
}

async fn refresh_access_token(
    client: &Client,
    client_id: &str,
    token: &StoredGoogleToken,
) -> Result<StoredGoogleToken, GoogleCalendarError> {
    let refresh_token = token
        .refresh_token
        .as_deref()
        .ok_or(GoogleCalendarError::ReauthorizationRequired)?;
    let response = client
        .post(GOOGLE_TOKEN_ENDPOINT)
        .form(&[
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| GoogleCalendarError::NetworkUnavailable)?;

    if response.status() == StatusCode::BAD_REQUEST || response.status() == StatusCode::UNAUTHORIZED
    {
        return Err(GoogleCalendarError::ReauthorizationRequired);
    }
    if !response.status().is_success() {
        return Err(provider_error(&response));
    }

    let refreshed = response
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
    Ok(StoredGoogleToken {
        access_token: refreshed.access_token,
        refresh_token: refreshed
            .refresh_token
            .or_else(|| token.refresh_token.clone()),
        expires_at_unix_seconds: unix_now()
            + i64::try_from(refreshed.expires_in).unwrap_or(i64::MAX),
        token_type: refreshed.token_type,
    })
}

async fn access_token_for_api(client: &Client) -> Result<String, GoogleCalendarError> {
    let token = load_stored_token()?.ok_or(GoogleCalendarError::NotConnected)?;
    if !token.is_expired() {
        return Ok(token.access_token);
    }

    let client_id = configured_client_id().ok_or(GoogleCalendarError::NotConfigured)?;
    let refreshed = match refresh_access_token(client, &client_id, &token).await {
        Ok(value) => value,
        Err(GoogleCalendarError::ReauthorizationRequired) => {
            let _ = delete_stored_token();
            return Err(GoogleCalendarError::ReauthorizationRequired);
        }
        Err(error) => return Err(error),
    };
    let access_token = refreshed.access_token.clone();
    store_token(&refreshed)?;
    Ok(access_token)
}

fn provider_error(response: &Response) -> GoogleCalendarError {
    match response.status() {
        StatusCode::FORBIDDEN => GoogleCalendarError::PermissionDenied,
        status if status.is_server_error() => GoogleCalendarError::ProviderUnavailable,
        _ => GoogleCalendarError::InvalidProviderResponse,
    }
}

async fn list_calendars(
    client: &Client,
    access_token: &str,
) -> Result<Vec<GoogleCalendarSummary>, GoogleCalendarError> {
    let mut calendars = Vec::new();
    let mut page_token: Option<String> = None;

    for _ in 0..20 {
        let mut request = client
            .get(GOOGLE_CALENDAR_LIST_ENDPOINT)
            .bearer_auth(access_token)
            .query(&[("minAccessRole", "reader"), ("showDeleted", "false")]);
        if let Some(token) = page_token.as_deref() {
            request = request.query(&[("pageToken", token)]);
        }

        let response = request
            .send()
            .await
            .map_err(|_| GoogleCalendarError::NetworkUnavailable)?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(GoogleCalendarError::ReauthorizationRequired);
        }
        if !response.status().is_success() {
            return Err(provider_error(&response));
        }

        let page = response
            .json::<GoogleCalendarListResponse>()
            .await
            .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
        calendars.extend(page.items.into_iter().map(Into::into));
        page_token = page.next_page_token;
        if page_token.is_none() {
            return Ok(calendars);
        }
    }

    Err(GoogleCalendarError::InvalidProviderResponse)
}

fn event_endpoint(calendar_id: &str) -> Result<Url, GoogleCalendarError> {
    let mut endpoint = Url::parse(GOOGLE_CALENDAR_EVENTS_ENDPOINT)
        .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
    endpoint
        .path_segments_mut()
        .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?
        .push(calendar_id)
        .push("events");
    Ok(endpoint)
}

#[derive(Debug)]
struct GoogleCalendarEventBatch {
    events: Vec<GoogleCalendarEventDto>,
    next_sync_token: String,
}

async fn list_events(
    client: &Client,
    access_token: &str,
    calendar_id: &str,
    sync_token: Option<&str>,
) -> Result<GoogleCalendarEventBatch, GoogleCalendarError> {
    let endpoint = event_endpoint(calendar_id)?;
    let mut events = Vec::new();
    let mut page_token: Option<String> = None;

    for _ in 0..20 {
        let mut request = client
            .get(endpoint.clone())
            .bearer_auth(access_token)
            .query(&[
                ("singleEvents", "true"),
                ("showDeleted", "true"),
                ("maxResults", "2500"),
            ]);
        if let Some(token) = sync_token {
            request = request.query(&[("syncToken", token)]);
        }
        if let Some(token) = page_token.as_deref() {
            request = request.query(&[("pageToken", token)]);
        }

        let response = request
            .send()
            .await
            .map_err(|_| GoogleCalendarError::NetworkUnavailable)?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(GoogleCalendarError::ReauthorizationRequired);
        }
        if response.status() == StatusCode::GONE {
            return Err(GoogleCalendarError::SyncTokenExpired);
        }
        if !response.status().is_success() {
            return Err(provider_error(&response));
        }

        let page = response
            .json::<GoogleCalendarEventsResponse>()
            .await
            .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
        events.extend(page.items);
        page_token = page.next_page_token;
        if page_token.is_none() {
            return page
                .next_sync_token
                .map(|next_sync_token| GoogleCalendarEventBatch {
                    events,
                    next_sync_token,
                })
                .ok_or(GoogleCalendarError::InvalidProviderResponse);
        }
    }

    Err(GoogleCalendarError::InvalidProviderResponse)
}

async fn sync_calendar_events(
    client: &Client,
    access_token: &str,
    calendar_id: &str,
    sync_token: Option<&str>,
) -> Result<(GoogleCalendarEventBatch, bool), GoogleCalendarError> {
    match list_events(client, access_token, calendar_id, sync_token).await {
        Ok(batch) => Ok((batch, sync_token.is_none())),
        Err(GoogleCalendarError::SyncTokenExpired) if sync_token.is_some() => {
            let batch = list_events(client, access_token, calendar_id, None).await?;
            Ok((batch, true))
        }
        Err(error) => Err(error),
    }
}

fn event_identity(event: &GoogleCalendarEventDto) -> Option<(String, Option<String>)> {
    let event_id = event
        .recurring_event_id
        .clone()
        .unwrap_or_else(|| event.id.clone());
    if event_id.trim().is_empty() {
        return None;
    }
    let occurrence_id = event.recurring_event_id.as_ref().and_then(|_| {
        event
            .original_start_time
            .as_ref()
            .and_then(|start| start.date_time.clone().or_else(|| start.date.clone()))
            .or_else(|| Some(event.id.clone()))
    });
    Some((event_id, occurrence_id))
}

fn remove_change(
    calendar: &GoogleCalendarSummary,
    event: &GoogleCalendarEventDto,
) -> Option<ExternalEventChange> {
    let (event_id, occurrence_id) = event_identity(event)?;
    Some(ExternalEventChange::Remove {
        provider_id: GOOGLE_PROVIDER_ID.to_owned(),
        calendar_id: calendar.id.clone(),
        event_id,
        occurrence_id,
    })
}

fn normalized_event(
    calendar: &GoogleCalendarSummary,
    event: GoogleCalendarEventDto,
) -> Option<ExternalEventChange> {
    let (event_id, occurrence_id) = event_identity(&event)?;
    if event.status.as_deref() == Some("cancelled") {
        return remove_change(calendar, &event);
    }

    let Some(raw_title) = event.summary.as_deref().map(str::trim) else {
        return remove_change(calendar, &event);
    };
    let tagged = raw_title.starts_with("[frilday]");
    let dedicated = calendar.summary.trim() == "FrilDay";
    if !tagged && !dedicated {
        return remove_change(calendar, &event);
    }
    let title = if tagged {
        raw_title["[frilday]".len()..].trim()
    } else {
        raw_title
    };
    if title.is_empty() {
        return remove_change(calendar, &event);
    }

    // All-day events have no finite planned work duration. They are ignored
    // rather than inventing 24h of FrilDay intent.
    let Some(start_value) = event
        .start
        .as_ref()
        .and_then(|start| start.date_time.as_deref())
    else {
        return remove_change(calendar, &event);
    };
    let Some(end_value) = event.end.as_ref().and_then(|end| end.date_time.as_deref()) else {
        return remove_change(calendar, &event);
    };
    let Some(start) = DateTime::<FixedOffset>::parse_from_rfc3339(start_value).ok() else {
        return remove_change(calendar, &event);
    };
    let Some(end) = DateTime::<FixedOffset>::parse_from_rfc3339(end_value).ok() else {
        return remove_change(calendar, &event);
    };
    let duration_minutes = end.signed_duration_since(start).num_seconds() / 60;
    let Some(planned_duration_minutes) = u32::try_from(duration_minutes).ok() else {
        return remove_change(calendar, &event);
    };
    if !(1..=720).contains(&planned_duration_minutes) {
        return remove_change(calendar, &event);
    }

    Some(ExternalEventChange::Upsert(NormalizedExternalEvent {
        provider_id: GOOGLE_PROVIDER_ID.to_owned(),
        calendar_id: calendar.id.clone(),
        event_id,
        occurrence_id,
        title: title.to_owned(),
        date_ymd: start.format("%Y-%m-%d").to_string(),
        planned_duration_minutes,
    }))
}

fn normalize_events(
    calendar: &GoogleCalendarSummary,
    events: Vec<GoogleCalendarEventDto>,
    window: ExternalImportWindow,
) -> (Vec<ExternalEventChange>, usize) {
    let mut normalized = Vec::new();
    let mut skipped = 0;
    for event in events {
        match normalized_event(calendar, event) {
            Some(ExternalEventChange::Remove {
                provider_id,
                calendar_id,
                event_id,
                occurrence_id,
            }) => normalized.push(ExternalEventChange::Remove {
                provider_id,
                calendar_id,
                event_id,
                occurrence_id,
            }),
            Some(ExternalEventChange::Upsert(event))
                if LocalDate::parse(&event.date_ymd).is_ok_and(|date| window.contains(date)) =>
            {
                normalized.push(ExternalEventChange::Upsert(event));
            }
            Some(ExternalEventChange::Upsert(event)) => {
                // A moved event outside the import window must still remove
                // the old date-specific Plan during an incremental sync.
                normalized.push(ExternalEventChange::Remove {
                    provider_id: event.provider_id,
                    calendar_id: event.calendar_id,
                    event_id: event.event_id,
                    occurrence_id: event.occurrence_id,
                });
            }
            None => skipped += 1,
        }
    }
    (normalized, skipped)
}

async fn refresh_calendars_with_pool(
    pool: &SqlitePool,
) -> Result<GoogleCalendarViewState, GoogleCalendarError> {
    let client = Client::builder()
        .user_agent("FrilDay/0.1 Google Calendar adapter")
        .build()
        .map_err(|_| GoogleCalendarError::NetworkUnavailable)?;
    let access_token = match access_token_for_api(&client).await {
        Ok(token) => token,
        Err(GoogleCalendarError::ReauthorizationRequired) => {
            mark_reauthorization_required(pool).await?;
            return Err(GoogleCalendarError::ReauthorizationRequired);
        }
        Err(error) => return Err(error),
    };
    let calendars = match list_calendars(&client, &access_token).await {
        Ok(value) => value,
        Err(GoogleCalendarError::ReauthorizationRequired) => {
            let _ = delete_stored_token();
            mark_reauthorization_required(pool).await?;
            return Err(GoogleCalendarError::ReauthorizationRequired);
        }
        Err(error) => return Err(error),
    };

    let mut config = load_config(pool).await?;
    let previous_selected = config
        .selected_calendar_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let available_ids = calendars
        .iter()
        .map(|calendar| calendar.id.as_str())
        .collect::<HashSet<_>>();
    config
        .selected_calendar_ids
        .retain(|id| available_ids.contains(id.as_str()));
    let selected_calendar_ids = config
        .selected_calendar_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    if previous_selected != selected_calendar_ids {
        let app_data = load_app_data_from_pool(pool)
            .await
            .map_err(GoogleCalendarError::Database)?;
        let reconciled = mark_external_plan_records_unavailable_for_selection(
            &app_data.plans,
            GOOGLE_PROVIDER_ID,
            &selected_calendar_ids,
        )
        .map_err(GoogleCalendarError::Database)?;
        save_plan_records(pool, &reconciled)
            .await
            .map_err(GoogleCalendarError::Database)?;
        for calendar_id in previous_selected.difference(&selected_calendar_ids) {
            config.sync_states.remove(calendar_id);
        }
    }
    config.calendars = calendars;
    config.auth_status = "connected".to_owned();
    save_config(pool, &config).await?;
    let token = load_stored_token()?;
    Ok(view_state(config, token.as_ref()))
}

async fn import_events_with_pool(
    pool: &SqlitePool,
    request: GoogleCalendarImportRequest,
) -> Result<GoogleCalendarImportOutput, GoogleCalendarError> {
    let start = LocalDate::parse(&request.start_ymd)
        .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
    let end = LocalDate::parse(&request.end_ymd)
        .map_err(|_| GoogleCalendarError::InvalidProviderResponse)?;
    let window =
        ExternalImportWindow::new(start, end).map_err(|_| GoogleCalendarError::InvalidSelection)?;
    let mut config = load_config(pool).await?;
    if config.selected_calendar_ids.is_empty() {
        return Err(GoogleCalendarError::InvalidSelection);
    }

    let client = Client::builder()
        .user_agent("FrilDay/0.1 Google Calendar adapter")
        .build()
        .map_err(|_| GoogleCalendarError::NetworkUnavailable)?;
    let access_token = match access_token_for_api(&client).await {
        Ok(token) => token,
        Err(GoogleCalendarError::ReauthorizationRequired) => {
            mark_reauthorization_required(pool).await?;
            return Err(GoogleCalendarError::ReauthorizationRequired);
        }
        Err(error) => return Err(error),
    };

    let selected_calendar_ids = config
        .selected_calendar_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let mut changes = Vec::new();
    let mut full_rescan_calendar_ids = HashSet::new();
    let mut skipped_event_count = 0;
    let mut incremental_calendar_count = 0;
    let mut full_rescan_calendar_count = 0;
    let mut removed_event_count = 0;
    for calendar_id in &config.selected_calendar_ids {
        let calendar = config
            .calendars
            .iter()
            .find(|calendar| &calendar.id == calendar_id)
            .ok_or(GoogleCalendarError::InvalidSelection)?;
        let sync_token = config
            .sync_states
            .get(calendar_id)
            .and_then(|state| state.next_sync_token.as_deref());
        let (batch, full_rescan) =
            match sync_calendar_events(&client, &access_token, calendar_id, sync_token).await {
                Ok(batch) => batch,
                Err(GoogleCalendarError::ReauthorizationRequired) => {
                    let _ = delete_stored_token();
                    mark_reauthorization_required(pool).await?;
                    return Err(GoogleCalendarError::ReauthorizationRequired);
                }
                Err(error) => return Err(error),
            };
        if full_rescan {
            full_rescan_calendar_ids.insert(calendar_id.clone());
            full_rescan_calendar_count += 1;
        } else {
            incremental_calendar_count += 1;
        }
        config.sync_states.insert(
            calendar_id.clone(),
            GoogleCalendarSyncState {
                next_sync_token: Some(batch.next_sync_token),
            },
        );
        let (calendar_changes, skipped) = normalize_events(calendar, batch.events, window);
        removed_event_count += calendar_changes
            .iter()
            .filter(|change| matches!(change, ExternalEventChange::Remove { .. }))
            .count();
        changes.extend(calendar_changes);
        skipped_event_count += skipped;
    }

    let app_data = load_app_data_from_pool(pool)
        .await
        .map_err(GoogleCalendarError::Database)?;
    let reconciled = reconcile_external_plan_records_with_changes(
        &app_data.plans,
        &changes,
        &app_data.completions,
        &app_data.time_entries,
        GOOGLE_PROVIDER_ID,
        &selected_calendar_ids,
        &full_rescan_calendar_ids,
        window,
    )
    .map_err(GoogleCalendarError::Database)?;
    save_plan_records(pool, &reconciled)
        .await
        .map_err(GoogleCalendarError::Database)?;

    config.last_sync_at = Some(DateTime::<chrono::Utc>::from(SystemTime::now()).to_rfc3339());
    config.last_sync_error = None;
    save_config(pool, &config).await?;

    let plan_count = reconciled
        .iter()
        .filter(|plan| {
            plan.source.kind == "externalCalendar"
                && plan.source.provider_id.as_deref() == Some(GOOGLE_PROVIDER_ID)
        })
        .count();
    Ok(GoogleCalendarImportOutput {
        imported_event_count: changes
            .iter()
            .filter(|change| matches!(change, ExternalEventChange::Upsert(_)))
            .count(),
        skipped_event_count,
        plan_count,
        start_ymd: start.to_string(),
        end_ymd: end.to_string(),
        incremental_calendar_count,
        full_rescan_calendar_count,
        removed_event_count,
    })
}

async fn record_sync_error(pool: &SqlitePool, error: &GoogleCalendarError) {
    let Ok(mut config) = load_config(pool).await else {
        return;
    };
    config.last_sync_error = Some(error.to_string());
    let _ = save_config(pool, &config).await;
}

fn respond_to_browser(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

enum CallbackResult {
    Ignore,
    Code(String),
    Error(GoogleCalendarError),
}

fn read_callback(stream: &mut TcpStream, expected_state: &str) -> CallbackResult {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buffer = [0_u8; 8192];
    let length = match stream.read(&mut buffer) {
        Ok(length) => length,
        Err(_) => return CallbackResult::Ignore,
    };
    let request = String::from_utf8_lossy(&buffer[..length]);
    let Some(target) = request
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|line| line.split_whitespace().next())
    else {
        return CallbackResult::Ignore;
    };
    let Ok(callback_url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return CallbackResult::Ignore;
    };
    if callback_url.path() != CALLBACK_PATH {
        return CallbackResult::Ignore;
    }

    let state = callback_url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned());
    if state.as_deref() != Some(expected_state) {
        respond_to_browser(
            stream,
            "400 Bad Request",
            "<html><body>Authorization could not be verified. You can close this tab.</body></html>",
        );
        return CallbackResult::Ignore;
    }

    if callback_url.query_pairs().any(|(key, _)| key == "error") {
        respond_to_browser(
            stream,
            "400 Bad Request",
            "<html><body>Authorization was cancelled. You can close this tab.</body></html>",
        );
        return CallbackResult::Error(GoogleCalendarError::AuthorizationCancelled);
    }

    let code = callback_url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned());
    match code {
        Some(code) if !code.is_empty() => {
            respond_to_browser(
                stream,
                "200 OK",
                "<html><body>FrilDay connected to Google Calendar. You can close this tab.</body></html>",
            );
            CallbackResult::Code(code)
        }
        _ => {
            respond_to_browser(
                stream,
                "400 Bad Request",
                "<html><body>Google did not return an authorization code. You can close this tab.</body></html>",
            );
            CallbackResult::Error(GoogleCalendarError::AuthorizationFailed)
        }
    }
}

fn wait_for_callback(
    listener: TcpListener,
    expected_state: String,
) -> Result<String, GoogleCalendarError> {
    listener
        .set_nonblocking(true)
        .map_err(|_| GoogleCalendarError::CallbackFailed)?;
    let deadline = SystemTime::now() + CALLBACK_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => match read_callback(&mut stream, &expected_state) {
                CallbackResult::Ignore => {}
                CallbackResult::Code(code) => return Ok(code),
                CallbackResult::Error(error) => return Err(error),
            },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if SystemTime::now() >= deadline {
                    return Err(GoogleCalendarError::CallbackFailed);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return Err(GoogleCalendarError::CallbackFailed),
        }
    }
}

#[tauri::command]
pub async fn google_calendar_get_state(
    db_instances: State<'_, DbInstances>,
) -> Result<GoogleCalendarViewState, String> {
    let pool = database_pool(&db_instances)
        .await
        .map_err(|error| error.to_string())?;
    let config = load_config(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let token = load_stored_token().map_err(|error| error.to_string())?;
    Ok(view_state(config, token.as_ref()))
}

#[tauri::command]
pub async fn google_calendar_begin_auth(
    app: tauri::AppHandle,
    db_instances: State<'_, DbInstances>,
) -> Result<GoogleCalendarViewState, String> {
    let pool = database_pool(&db_instances)
        .await
        .map_err(|error| error.to_string())?;
    let client_id =
        configured_client_id().ok_or_else(|| GoogleCalendarError::NotConfigured.to_string())?;
    let prepared = prepare_authorization(&client_id).map_err(|error| error.to_string())?;
    app.opener()
        .open_url(prepared.authorization_url.as_str(), None::<&str>)
        .map_err(|error| GoogleCalendarError::Browser(error.to_string()).to_string())?;

    let state = prepared.state.clone();
    let listener = prepared.listener;
    let code = tokio::task::spawn_blocking(move || wait_for_callback(listener, state))
        .await
        .map_err(|_| GoogleCalendarError::CallbackFailed.to_string())?
        .map_err(|error| error.to_string())?;

    let client = Client::builder()
        .user_agent("FrilDay/0.1 Google Calendar adapter")
        .build()
        .map_err(|_| GoogleCalendarError::NetworkUnavailable.to_string())?;
    let token = exchange_authorization_code(
        &client,
        &client_id,
        &code,
        &prepared.code_verifier,
        &prepared.redirect_uri,
    )
    .await
    .map_err(|error| error.to_string())?;
    store_token(&token).map_err(|error| error.to_string())?;

    let calendars = match list_calendars(&client, &token.access_token).await {
        Ok(value) => value,
        Err(GoogleCalendarError::ReauthorizationRequired) => {
            let _ = delete_stored_token();
            mark_reauthorization_required(&pool)
                .await
                .map_err(|error| error.to_string())?;
            return Err(GoogleCalendarError::ReauthorizationRequired.to_string());
        }
        Err(error) => {
            let mut config = load_config(&pool)
                .await
                .map_err(|error| error.to_string())?;
            config.auth_status = "connected".to_owned();
            save_config(&pool, &config)
                .await
                .map_err(|error| error.to_string())?;
            return Err(error.to_string());
        }
    };

    let mut config = load_config(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let available_ids = calendars
        .iter()
        .map(|calendar| calendar.id.as_str())
        .collect::<HashSet<_>>();
    config
        .selected_calendar_ids
        .retain(|id| available_ids.contains(id.as_str()));
    config.calendars = calendars;
    config.auth_status = "connected".to_owned();
    save_config(&pool, &config)
        .await
        .map_err(|error| error.to_string())?;
    Ok(view_state(config, Some(&token)))
}

#[tauri::command]
pub async fn google_calendar_refresh_calendars(
    db_instances: State<'_, DbInstances>,
) -> Result<GoogleCalendarViewState, String> {
    let pool = database_pool(&db_instances)
        .await
        .map_err(|error| error.to_string())?;
    refresh_calendars_with_pool(&pool)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn google_calendar_import(
    db_instances: State<'_, DbInstances>,
    request: GoogleCalendarImportRequest,
) -> Result<GoogleCalendarImportOutput, String> {
    let pool = database_pool(&db_instances)
        .await
        .map_err(|error| error.to_string())?;
    let result = import_events_with_pool(&pool, request).await;
    if let Err(error) = &result {
        record_sync_error(&pool, error).await;
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn google_calendar_set_selection(
    db_instances: State<'_, DbInstances>,
    request: GoogleCalendarSelectionRequest,
) -> Result<GoogleCalendarViewState, String> {
    let pool = database_pool(&db_instances)
        .await
        .map_err(|error| error.to_string())?;
    let mut config = load_config(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let mut selected = HashSet::new();
    for id in &request.selected_calendar_ids {
        if id.trim().is_empty() || !selected.insert(id) {
            return Err(GoogleCalendarError::InvalidSelection.to_string());
        }
    }
    let available = config
        .calendars
        .iter()
        .map(|calendar| calendar.id.as_str())
        .collect::<HashSet<_>>();
    if request
        .selected_calendar_ids
        .iter()
        .any(|id| !available.contains(id.as_str()))
    {
        return Err(GoogleCalendarError::InvalidSelection.to_string());
    }

    let selected_calendar_ids = request
        .selected_calendar_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let app_data = load_app_data_from_pool(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let reconciled = mark_external_plan_records_unavailable_for_selection(
        &app_data.plans,
        GOOGLE_PROVIDER_ID,
        &selected_calendar_ids,
    )
    .map_err(|error| error.to_string())?;
    save_plan_records(&pool, &reconciled)
        .await
        .map_err(|error| error.to_string())?;

    let previously_selected = config
        .selected_calendar_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    for calendar_id in previously_selected.difference(&selected_calendar_ids) {
        // A later re-selection must perform a complete import. Keeping the
        // old cursor could miss edits made while this source was deselected.
        config.sync_states.remove(calendar_id);
    }
    config.selected_calendar_ids = request.selected_calendar_ids;
    save_config(&pool, &config)
        .await
        .map_err(|error| error.to_string())?;
    let token = load_stored_token().map_err(|error| error.to_string())?;
    Ok(view_state(config, token.as_ref()))
}

#[tauri::command]
pub async fn google_calendar_disconnect(
    db_instances: State<'_, DbInstances>,
) -> Result<GoogleCalendarViewState, String> {
    let pool = database_pool(&db_instances)
        .await
        .map_err(|error| error.to_string())?;
    let app_data = load_app_data_from_pool(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let no_selected_calendars = HashSet::new();
    let reconciled = mark_external_plan_records_unavailable_for_selection(
        &app_data.plans,
        GOOGLE_PROVIDER_ID,
        &no_selected_calendars,
    )
    .map_err(|error| error.to_string())?;
    save_plan_records(&pool, &reconciled)
        .await
        .map_err(|error| error.to_string())?;
    delete_stored_token().map_err(|error| error.to_string())?;
    let config = GoogleCalendarConfig::default();
    save_config(&pool, &config)
        .await
        .map_err(|error| error.to_string())?;
    Ok(view_state(config, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn calendar(summary: &str) -> GoogleCalendarSummary {
        GoogleCalendarSummary {
            id: "calendar-1".to_owned(),
            summary: summary.to_owned(),
            description: None,
            primary: false,
            access_role: Some("reader".to_owned()),
        }
    }

    fn timed_event(title: &str, start: &str, end: &str) -> GoogleCalendarEventDto {
        GoogleCalendarEventDto {
            id: "event-1".to_owned(),
            status: Some("confirmed".to_owned()),
            summary: Some(title.to_owned()),
            start: Some(GoogleCalendarEventDateTime {
                date: None,
                date_time: Some(start.to_owned()),
            }),
            end: Some(GoogleCalendarEventDateTime {
                date: None,
                date_time: Some(end.to_owned()),
            }),
            recurring_event_id: None,
            original_start_time: None,
        }
    }

    fn normalized_upsert(
        calendar: &GoogleCalendarSummary,
        event: GoogleCalendarEventDto,
    ) -> NormalizedExternalEvent {
        match normalized_event(calendar, event) {
            Some(ExternalEventChange::Upsert(event)) => event,
            other => panic!("expected an upsert, got {other:?}"),
        }
    }

    #[test]
    fn authorization_url_requests_read_only_calendar_access_with_pkce() {
        let prepared = prepare_authorization("desktop-client-id").unwrap();
        let query = prepared
            .authorization_url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(
            query.get("scope").map(|value| value.as_ref()),
            Some(GOOGLE_CALENDAR_READONLY_SCOPES)
        );
        assert_eq!(
            query.get("access_type").map(|value| value.as_ref()),
            Some("offline")
        );
        assert_eq!(
            query
                .get("code_challenge_method")
                .map(|value| value.as_ref()),
            Some("S256")
        );
        assert_eq!(
            query.get("response_type").map(|value| value.as_ref()),
            Some("code")
        );
        assert!(!query.get("code_challenge").unwrap().is_empty());
        assert!(!query.get("state").unwrap().is_empty());
        assert!(query
            .get("scope")
            .unwrap()
            .contains("calendar.calendarlist.readonly"));
        assert!(query
            .get("scope")
            .unwrap()
            .contains("calendar.events.readonly"));
        assert!(!query
            .get("scope")
            .unwrap()
            .contains("https://www.googleapis.com/auth/calendar "));
    }

    #[test]
    fn expired_tokens_are_refreshable_before_their_expiry_buffer() {
        let token = StoredGoogleToken {
            access_token: "access".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at_unix_seconds: unix_now() + 30,
            token_type: "Bearer".to_owned(),
        };
        assert!(token.is_expired());
    }

    #[test]
    fn calendar_dto_is_normalized_without_transport_fields() {
        let summary: GoogleCalendarSummary = GoogleCalendarDto {
            id: "calendar-1".to_owned(),
            summary: String::new(),
            description: None,
            primary: true,
            access_role: Some("reader".to_owned()),
        }
        .into();

        assert_eq!(summary.id, "calendar-1");
        assert_eq!(summary.summary, "Untitled calendar");
        assert!(summary.primary);
        assert_eq!(summary.access_role.as_deref(), Some("reader"));
    }

    #[test]
    fn missing_token_requires_reauthorization_after_a_previous_connection() {
        let config = GoogleCalendarConfig {
            auth_status: "connected".to_owned(),
            selected_calendar_ids: vec!["calendar-1".to_owned()],
            calendars: vec![GoogleCalendarSummary {
                id: "calendar-1".to_owned(),
                summary: "Work".to_owned(),
                description: None,
                primary: false,
                access_role: Some("reader".to_owned()),
            }],
            ..GoogleCalendarConfig::default()
        };

        let state = view_state(config, None);

        assert!(!state.connected);
        assert!(state.reauthorization_required);
        assert_eq!(state.selected_calendar_ids, vec!["calendar-1"]);
    }

    #[test]
    fn disconnected_state_does_not_expose_cached_calendar_choices() {
        let config = GoogleCalendarConfig::default();
        let state = view_state(config, None);

        assert!(!state.connected);
        assert!(!state.reauthorization_required);
        assert!(state.selected_calendar_ids.is_empty());
        assert!(state.calendars.is_empty());
    }

    #[test]
    fn tagged_event_strips_the_case_sensitive_prefix_and_maps_timing() {
        let event = normalized_upsert(
            &calendar("Work"),
            timed_event(
                "[frilday] Rust study",
                "2026-01-05T20:00:00+09:00",
                "2026-01-05T21:30:00+09:00",
            ),
        );

        assert_eq!(event.title, "Rust study");
        assert_eq!(event.date_ymd, "2026-01-05");
        assert_eq!(event.planned_duration_minutes, 90);
        assert_eq!(event.provider_id, GOOGLE_PROVIDER_ID);
    }

    #[test]
    fn dedicated_fril_day_calendar_imports_without_a_title_prefix() {
        let event = normalized_upsert(
            &calendar("FrilDay"),
            timed_event(
                "Deep work",
                "2026-01-05T23:00:00+09:00",
                "2026-01-06T01:00:00+09:00",
            ),
        );

        assert_eq!(event.title, "Deep work");
        assert_eq!(event.date_ymd, "2026-01-05");
        assert_eq!(event.planned_duration_minutes, 120);
    }

    #[test]
    fn untagged_events_from_other_calendars_are_not_imported() {
        assert!(matches!(
            normalized_event(
                &calendar("Work"),
                timed_event(
                    "Deep work",
                    "2026-01-05T20:00:00+09:00",
                    "2026-01-05T21:00:00+09:00",
                ),
            ),
            Some(ExternalEventChange::Remove { .. })
        ));
        assert!(matches!(
            normalized_event(
                &calendar("work"),
                timed_event(
                    "[FrilDay] wrong case",
                    "2026-01-05T20:00:00+09:00",
                    "2026-01-05T21:00:00+09:00",
                ),
            ),
            Some(ExternalEventChange::Remove { .. })
        ));
    }

    #[test]
    fn all_day_zero_length_and_invalid_events_are_skipped() {
        let all_day = GoogleCalendarEventDto {
            id: "all-day".to_owned(),
            status: Some("confirmed".to_owned()),
            summary: Some("[frilday] planning".to_owned()),
            start: Some(GoogleCalendarEventDateTime {
                date: Some("2026-01-05".to_owned()),
                date_time: None,
            }),
            end: Some(GoogleCalendarEventDateTime {
                date: Some("2026-01-06".to_owned()),
                date_time: None,
            }),
            recurring_event_id: None,
            original_start_time: None,
        };
        assert!(matches!(
            normalized_event(&calendar("Work"), all_day),
            Some(ExternalEventChange::Remove { .. })
        ));
        assert!(matches!(
            normalized_event(
                &calendar("Work"),
                timed_event(
                    "[frilday] zero",
                    "2026-01-05T20:00:00+09:00",
                    "2026-01-05T20:00:00+09:00",
                ),
            ),
            Some(ExternalEventChange::Remove { .. })
        ));
        assert!(matches!(
            normalized_event(
                &calendar("Work"),
                timed_event(
                    "[frilday] backwards",
                    "2026-01-05T20:00:00+09:00",
                    "2026-01-05T19:00:00+09:00",
                ),
            ),
            Some(ExternalEventChange::Remove { .. })
        ));
        assert!(matches!(
            normalized_event(
                &calendar("Work"),
                GoogleCalendarEventDto {
                    id: "cancelled".to_owned(),
                    status: Some("cancelled".to_owned()),
                    summary: None,
                    start: None,
                    end: None,
                    recurring_event_id: None,
                    original_start_time: None,
                },
            ),
            Some(ExternalEventChange::Remove { .. })
        ));
        assert!(matches!(
            normalized_event(
                &calendar("Work"),
                timed_event(
                    "[frilday]",
                    "2026-01-05T20:00:00+09:00",
                    "2026-01-05T21:00:00+09:00",
                ),
            ),
            Some(ExternalEventChange::Remove { .. })
        ));
    }

    #[test]
    fn recurring_occurrences_use_the_series_and_original_start_identity() {
        let mut event = timed_event(
            "[frilday] recurring",
            "2026-01-12T20:00:00+09:00",
            "2026-01-12T21:00:00+09:00",
        );
        event.id = "series_20260112T110000Z".to_owned();
        event.recurring_event_id = Some("series".to_owned());
        event.original_start_time = Some(GoogleCalendarEventDateTime {
            date: None,
            date_time: Some("2026-01-12T20:00:00+09:00".to_owned()),
        });

        let normalized = normalized_upsert(&calendar("Work"), event);

        assert_eq!(normalized.event_id, "series");
        assert_eq!(
            normalized.occurrence_id.as_deref(),
            Some("2026-01-12T20:00:00+09:00")
        );
    }
}
