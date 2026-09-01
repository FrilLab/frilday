# FrilDay Desktop

Desktop client for FrilDay built with Tauri, React, TypeScript, and SQLite.

The current app focuses on executable time planning, timer-based progress,
planned-versus-actual tracking, and local persistence. Completion is tracked
separately as a secondary signal.

## Main Features

- schedule tasks by weekday
- track completion separately from spent time
- run timers for planned work
- store local data with Tauri-backed SQLite
- package as a native desktop app

## App Structure

```text
src/
  app/              app wiring, pages, store, layout
  domain/           desktop-side domain rules
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
- server and shared core extraction are planned at the repo level
- broader direction is documented in [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
