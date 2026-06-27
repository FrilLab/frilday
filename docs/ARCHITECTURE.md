# FrilDay Architecture

FrilDay is designed as a cloud-first productivity application, while the first release focuses on the desktop experience.

The project starts with a Tauri desktop app and an Axum server, then gradually expands to mobile and cloud synchronization.

## Goals

- Release the desktop app first
- Use Axum as the API layer
- Keep business logic independent from UI and transport layers
- Prepare for future mobile and cloud-first usage
- Avoid duplicating task, schedule, and statistics logic across clients

## High-Level Structure

```text
frilday/

apps/
  desktop/     # Tauri + React desktop app
  server/      # Axum HTTP API server

crates/
  frilday-core/ # Core domain and application logic
```

## Runtime Flow

### Desktop v0.1

```text
React Desktop
    ↓ HTTP
Local Axum Server
    ↓
frilday-core
    ↓
SQLite
```

The desktop app calls the local Axum server through HTTP. This keeps the desktop client close to the future cloud API structure.

### Future Cloud Version

```text
Desktop / Mobile / Web
    ↓ HTTP
Cloud Axum Server
    ↓
frilday-core
    ↓
PostgreSQL
```

The long-term goal is cloud-first usage, where user data is stored on the server and shared across devices.

## Layer Responsibilities

### apps/desktop

Responsible for:

- React UI
- Tauri shell
- Pages and user interaction
- Calling the API
- Desktop packaging

It should not contain core business rules.

### apps/server

Responsible for:

- Axum routes
- HTTP request/response handling
- API validation
- Authentication in the future
- Calling `frilday-core`

It should not own core business rules.

### crates/frilday-core

Responsible for:

- Task domain logic
- Schedule rules
- Completion rules
- Statistics calculation
- Core services
- Repository traits

It must not depend on:

- React
- Tauri
- Axum
- SQLite
- PostgreSQL
- HTTP

## Dependency Direction

```text
apps/desktop ─┐
              ├──▶ crates/frilday-core
apps/server  ─┘
```

`frilday-core` must not know whether it is used by Desktop, Server, Mobile, or Web.

## Initial Development Plan

1. Move the current Tauri app into `apps/desktop`
2. Create `apps/server`
3. Create `crates/frilday-core`
4. Move domain logic into `frilday-core`
5. Add basic Axum routes:
   - `GET /health`
   - `GET /tasks`
   - `POST /tasks`

6. Make the desktop app call the local Axum server
7. Use SQLite for the first desktop release
8. Later replace or extend storage with PostgreSQL for cloud-first usage

## Design Principle

FrilDay should be built around one core idea:

```text
UI and transport layers may change.
Core rules should remain stable.
```

This allows the project to grow from a desktop app into a cloud-first multi-platform product without rewriting the business logic.

## Git Workflow

The repository is moving from a single desktop app into a monorepo. Changes should be grouped by layer so the move stays reviewable.

### Branch Strategy

- `main` stays deployable and buildable
- short-lived feature branches start from `main`
- prefer small PRs that touch one concern:
  - desktop UI
  - server API
  - shared core
  - docs / tooling

Suggested branch names:

- `feat/desktop-timer`
- `feat/server-health-route`
- `refactor/core-task-rules`
- `docs/architecture-readme`
- `chore/gitignore-workspace`

### Commit Scope

Keep commits intentional and easy to revert.

- move files without behavior changes in one commit
- change imports / wiring in a separate commit
- change behavior in another commit
- update docs when architecture or workflow changes

Suggested commit prefixes:

- `feat:`
- `fix:`
- `refactor:`
- `docs:`
- `chore:`

### Integration Order

When a feature spans multiple layers, merge in this order when possible:

1. `crates/frilday-core`
2. `apps/server`
3. `apps/desktop`
4. docs and cleanup

This keeps dependency flow aligned with the intended architecture.

### Pull Request Checklist

- desktop build still passes
- server compiles if touched
- core crate tests pass if touched
- docs reflect structural changes
- no generated build outputs are committed unless intentional
