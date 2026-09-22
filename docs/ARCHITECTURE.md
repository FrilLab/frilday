# FrilDay Architecture

FrilDay is a timer-first time planning application. Its core loop is
**Plan → Execute → Track → Review → Adjust**, with planned time compared
against actual time. Completion is a secondary signal rather than the product
definition.

Desktop v0.1 is local-first. The active timer and today's executable plan take
priority over analytics and configuration. The future server is a separate
delivery adapter, not a prerequisite for the desktop application.

## Goals

- Release and refine the local-first desktop experience first.
- Keep planned-time and actual-time rules reusable across delivery adapters.
- Keep UI and transport layers thin.
- Leave room for future mobile, web, and cloud delivery without coupling the
  core to a specific runtime.
- Avoid infrastructure without a concrete release benefit.

## High-level structure

```text
frilday/

apps/
  desktop/       Tauri + React desktop client
  server/        Future Axum delivery adapter

crates/
  frilday-core/  Reusable domain and application rules
```

## Runtime flow

### Target desktop v0.1 architecture

```text
React → Tauri adapter → frilday-core → SQLite adapter
```

This is the intended desktop v0.1 boundary. Once domain extraction is
complete, the desktop application will use Tauri for native capabilities,
`frilday-core` for reusable domain rules, and the SQLite adapter for local
persistence. Desktop v0.1 does **not** require a local Axum HTTP server.

The desktop Tauri adapter now translates the persisted `Task`, `Completion`,
and `TimeEntry` shapes into core inputs for schedule visibility, completion
transitions, durable session lifecycle transitions, target-reached feedback,
and statistics. SQLite
schema, queries, typed writes, and legacy-data import live in the Rust-side
desktop persistence adapter. React only calls typed Tauri persistence commands
and never constructs application SQL or owns a full-table replacement.

The existing localStorage collections (`dailycheck.tasks.v2`,
`dailycheck.completions.v1`, `dailycheck.timeEntries.v1`, and
`dailycheck.taskDailyMemos.v1`) are imported once into the existing
`daily_check.db` file. The import is transactional and idempotent: corrupted
legacy JSON is left in place for recovery, an existing SQLite dataset wins,
and legacy keys are cleared only after the Rust adapter commits the migration.

The stable Routine/Plan/Session/Completion vocabulary and the compatibility
mapping for the current desktop records are defined in
[DOMAIN_MODEL.md](DOMAIN_MODEL.md).

External calendar integration follows a narrow provider boundary:

```text
provider API DTO + auth
          ↓
calendar adapter: NormalizedExternalEvent
          ↓
desktop application: Plan reconciliation
          ↓
frilday-core: PlanSource / identity / history invariants
```

The normalized event contains only opaque provider, calendar, event, and
optional recurring-occurrence identifiers plus the normalized title, date, and
planned duration. The desktop import command fetches an inclusive date window
from each selected Google calendar, expands recurring events into
date-specific occurrences, and atomically reconciles the resulting Plans.
The core has no Google, OAuth, HTTP, or SDK dependency. Reconciliation uses a
deterministic source identity to avoid duplicates and retains an unavailable
Plan when an upstream event disappears so Sessions and Completions remain
reviewable.

### Google event import semantics

The import convention is deterministic and intentionally small:

- A title beginning with the case-sensitive [frilday] prefix is imported
  from any selected calendar; the prefix and surrounding whitespace are
  removed from the Plan title.
- A selected calendar whose exact display name is FrilDay is a dedicated
  source; its timed events do not need the prefix. The two mechanisms are
  alternatives, not a requirement to use both.
- All-day events, cancelled events, missing/empty titles, malformed times,
  zero/negative durations, durations above FrilDay's supported 720-minute
  limit, and events outside the requested inclusive date window are skipped.
  Calendar dates without a finite timed duration do not become invented
  24-hour Plans.
- Timed events crossing midnight use the event's start date and the full
  elapsed start-to-end duration. Durations are whole minutes, floored from
  provider timestamps; a result below one minute is skipped.
- Google recurring instances use the recurring series id plus
  originalStartTime as the external occurrence identity. They become
  standalone Plans and never create FrilDay Routines.
- Re-importing an occurrence updates one deterministic Plan. A Plan with
  Session or Completion history keeps its prior date, title, and planned
  duration; no calendar duration is written as actual tracked time.
- Reconciliation only marks missing Google Plans unavailable inside the
  requested window. Plans outside that window and local Plans are preserved.

Google Calendar sync stores one provider sync cursor per selected calendar in
the versioned settings record. The first sync reads the complete event
collection and filters it locally; successful later syncs use the provider's
incremental `syncToken`. A `410 Gone`/expired cursor discards only that
calendar's cursor and retries a complete rescan. Missing, cancelled, deleted,
untagged, invalid, and moved-out-of-window events become unavailable source
states rather than deleted Plans. A full rescan only reconciles absence for
the calendar that was fully read, while an incremental response applies only
the returned upserts/tombstones.

Changing the selected-calendar set marks Plans from deselected calendars
unavailable and clears their cursors so re-selection performs a fresh import.
Sync writes Plans and cursor state only after all selected-calendar reads have
succeeded. Network, auth, or provider errors retain the last successful local
Plans and cursor, record a last-sync error, and remain retryable through
`Sync now`.

### Google Calendar connection boundary

The desktop Google Calendar adapter keeps authentication and provider
configuration outside both React state and `frilday-core`:

```text
Settings UI
    ↓ typed Tauri command
Rust Google adapter ── OAuth 2.0 PKCE + loopback callback ── Google
    ├─ OS credential store: access/refresh token
    └─ SQLite settings_kv: selected ids, cached choices, sync cursors, and last-sync state
```

The adapter requests only Google's focused read-only scopes:
`calendar.calendarlist.readonly` to show source choices and
`calendar.events.readonly` for the later event import boundary. It uses a
desktop OAuth client id supplied through `FRILDAY_GOOGLE_CLIENT_ID` at runtime
or build time; no client secret or token is committed. Access and refresh
tokens are stored through the platform credential store (macOS Keychain,
Windows Credential Manager, or Linux Secret Service) and are never returned to
React, written to `frilday-core`, or included in logs.

The persisted non-secret configuration is versioned as
`integration.googleCalendar.config.v1`. Disconnect removes the local
credential and selection but never deletes Plans, Sessions, or Completions.
Expired or revoked credentials transition to a reconnect-required state.
Network, permission, and provider failures are surfaced in Settings while the
local timer and existing FrilDay data remain usable.

### Future server delivery

```text
Desktop / Mobile / Web
            ↓ HTTP
      Axum server adapter
            ↓
      frilday-core
            ↓
      Remote persistence
```

The Axum server can later provide cloud delivery and synchronization. It is a
separate adapter and must not be inserted into the desktop v0.1 runtime just
to mirror a future API.

## Layer responsibilities

### `apps/desktop`

Responsible for:

- React UI and user interaction
- Tauri integration and native capabilities
- desktop packaging
- adapting local persistence to the application
- translating legacy persisted records to and from `frilday-core` commands

The desktop layer should prioritize the active timer and today's executable
plan. It should not become a second home for reusable core business rules.

### `apps/server`

Responsible for the future delivery boundary:

- Axum routes
- HTTP request/response handling
- transport-level validation
- authentication and synchronization when that delivery path is implemented
- calling `frilday-core`

It is not part of the desktop v0.1 runtime and should not own domain rules.

### `crates/frilday-core`

Responsible for reusable rules such as:

- Routine, Plan, Session, and Completion domain semantics
- task and time-planning logic
- schedule rules
- timer and time-entry rules
- completion rules
- planned-versus-actual statistics
- core services and repository traits

It must not depend on React, Tauri, Axum, SQLite, PostgreSQL, or HTTP.

## Dependency direction

```text
apps/desktop ─┐
              ├──▶ crates/frilday-core
apps/server  ─┘
```

`frilday-core` must not know whether it is used by Desktop, Server, Mobile, or
Web.

## Development direction

1. Keep the desktop-first experience buildable and useful.
2. Extract reusable domain rules into `crates/frilday-core`.
3. Keep Tauri, SQLite, and any future HTTP implementation behind adapters.
4. Add Axum routes only when the separate server delivery path has a concrete
   release or integration need.
5. Add remote persistence and synchronization after the local-first desktop
   loop is stable.

## Design principles

```text
Plan executable time.
Execute with a timer.
Track actual investment.
Review planned versus actual time.
Adjust the next plan.
```

UI and transport layers may change; core rules should remain stable. Avoid
turning FrilDay into a generic Todo, habit, Pomodoro, calendar, or dashboard
application.

## Git workflow

Changes should be grouped by layer so the monorepo remains reviewable.

### Branch strategy

- `main` stays deployable and buildable.
- Short-lived feature branches start from `main`.
- Prefer small PRs that touch one concern: desktop UI, server adapter, shared
  core, or docs/tooling.

Suggested branch names:

- `feat/desktop-timer`
- `feat/server-health-route`
- `refactor/core-task-rules`
- `docs/architecture-readme`
- `chore/gitignore-workspace`

### Commit scope

Keep commits intentional and easy to revert. Separate file moves, wiring,
behavior changes, and documentation updates when practical.

Suggested commit prefixes:

- `feat:`
- `fix:`
- `refactor:`
- `docs:`
- `chore:`

### Pull request checklist

- desktop build still passes
- server compiles if touched
- core tests pass if touched
- docs reflect structural changes
- no generated build outputs are committed unless intentional
