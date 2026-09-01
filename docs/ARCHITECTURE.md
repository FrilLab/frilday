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

The current scaffold is still mid-extraction: active domain and SQLite
integration remain under `apps/desktop`, while `crates/frilday-core` is not
yet wired into the desktop crate.

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
