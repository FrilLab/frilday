# FrilDay Desktop

Desktop client for FrilDay built with Tauri, React, TypeScript, and SQLite.

The current app focuses on executable time planning, timer-based progress,
planned-versus-actual tracking, and local persistence. Completion is tracked
separately as a secondary signal.

## Main Features

- schedule tasks by weekday
- track completion separately from spent time
- run, pause, resume, and finish timers for planned work
- store local data with Tauri-backed SQLite
- package as a native desktop app

## App Structure

```text
src/
  app/              app wiring, pages, store, layout
  domain/           task/memo helpers and display metadata
  features/         UI feature components
  i18n/             locale messages and translation
  infrastructure/   storage, notification, tauri adapters
  shared/           shared frontend types and utilities

src-tauri/
  src/              Rust entrypoints
  capabilities/     Tauri capabilities
```

## Commands

```bash
npm run dev
npm run build
bunx tauri dev
bunx tauri build
```

## Build Output

macOS bundle output:

- `src-tauri/target/release/bundle/macos/FrilDay.app`

## Notes

- this app is the active product surface right now
- the desktop runtime is local-first and does not require a local Axum server
- schedule, completion, session lifecycle, timer, and statistics rules run
  through the Tauri adapter backed by `crates/frilday-core`
- SQLite schema and typed persistence commands live in the Rust-side desktop
  adapter; legacy localStorage data is imported transactionally into the
  existing `daily_check.db`
- Session duration is derived from persisted timestamps and active-segment
  state. Running and paused sessions survive application restart; backgrounding
  or system sleep does not depend on missed UI ticks, and planned-time targets
  continue into overtime until the user pauses or finishes.
- broader direction is documented in [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
