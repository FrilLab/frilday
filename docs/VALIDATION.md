# v0.1 foundation validation

This document records the final validation for the v0.1 foundation described
by issue #10 and its parent Epic #4.

## Product direction

- FrilDay is described as a timer-first time planning application in the
  [README](../README.md) and desktop documentation.
- The product loop remains `Plan → Execute → Track → Review → Adjust`.
- Planned minutes and actual minutes are separate values in the core model and
  the Today surface. Completion is stored and toggled independently.
- The repository contains no new authentication, cloud sync, mobile/web
  client, generic Pomodoro, or unrelated dashboard scope for this foundation.

## Architecture direction

The effective desktop path is:

```text
React → Tauri adapter → frilday-core → SQLite adapter
```

The boundary is documented in [ARCHITECTURE.md](ARCHITECTURE.md) and enforced
by the typed persistence-boundary test. `crates/frilday-core` has no runtime,
UI, transport, or persistence dependencies. React calls typed Tauri/core
operations and does not issue SQLite queries directly. `apps/server` remains
an optional, buildable future adapter.

## Data migration coverage

The Tauri persistence tests import and load a representative legacy fixture
containing:

- active and archived tasks;
- weekday, weekend, and custom schedules with multiple days;
- `autoArchiveAfter` and `repeatCount` limits;
- current and historical completions;
- ended and running time entries, including an archived task's history; and
- daily memos for historical and current dates.

The fixture is loaded from SQLite after import, compared with the source
records, and imported a second time to verify idempotence. The migration marker
is written only after the transaction commits, and existing database records
are preserved.

## Automated checks

Run from the repository root unless noted otherwise:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` in `apps/desktop` | pass |
| `bun run test` in `apps/desktop` | pass — 8 tests |
| `bun run lint` in `apps/desktop` | pass |
| `bun run build` in `apps/desktop` | pass |
| `cargo fmt --all -- --check` | pass |
| `cargo check --workspace --locked` | pass |
| `cargo test --workspace --locked` | pass — 17 core tests, 8 desktop adapter tests |

The Tauri JavaScript packages are kept on the same minor release line as the
Rust Tauri packages so `bunx tauri dev` starts without a package version
mismatch warning.

## Manual desktop smoke test

The Tauri development application was launched successfully with the native
runner against an isolated validation application configuration, and it
created the expected `daily_check.db` schema without changing existing local
data. The Tauri package version warning was also absent after aligning the JS
and Rust package minor releases.

The intended action walkthrough against that isolated configuration is:

1. load existing data;
2. create, edit, and archive a routine;
3. find today's applicable routine;
4. start and stop a session;
5. toggle completion independently of tracked time; and
6. restart and verify the result remains.

The host environment does not grant Assistive Access or expose a display to
this validation run, so GUI clicks and visual confirmation of those six steps
could not be completed here. The same persistence and core transitions are
covered by the native adapter tests above; a human desktop run is still
required before closing Epic #4.
