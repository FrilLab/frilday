use std::{
    collections::HashSet,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
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

use crate::persistence::database_pool;

const GOOGLE_CLIENT_ID_ENV: &str = "FRILDAY_GOOGLE_CLIENT_ID";
const GOOGLE_CALENDAR_READONLY_SCOPES: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_LIST_ENDPOINT: &str =
    "https://www.googleapis.com/calendar/v3/users/me/calendarList";
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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarSelectionRequest {
    pub selected_calendar_ids: Vec<String>,
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
}

impl Default for GoogleCalendarConfig {
    fn default() -> Self {
        Self {
            selected_calendar_ids: Vec::new(),
            import_mode: default_import_mode(),
            calendars: Vec::new(),
            auth_status: default_auth_status(),
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
    let available_ids = calendars
        .iter()
        .map(|calendar| calendar.id.as_str())
        .collect::<HashSet<_>>();
    config
        .selected_calendar_ids
        .retain(|id| available_ids.contains(id.as_str()));
    config.calendars = calendars;
    config.auth_status = "connected".to_owned();
    save_config(pool, &config).await?;
    let token = load_stored_token()?;
    Ok(view_state(config, token.as_ref()))
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
        let mut config = GoogleCalendarConfig::default();
        config.auth_status = "connected".to_owned();
        config.selected_calendar_ids = vec!["calendar-1".to_owned()];
        config.calendars = vec![GoogleCalendarSummary {
            id: "calendar-1".to_owned(),
            summary: "Work".to_owned(),
            description: None,
            primary: false,
            access_role: Some("reader".to_owned()),
        }];

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
}
