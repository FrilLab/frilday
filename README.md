# FrilDay

FrilDay is a **timer-first time planning application**. It helps people plan
executable time, focus with a timer, record actual investment, review the gap
between planned and actual time, and adjust future plans.

The product loop is:

```text
Plan → Execute → Track → Review → Adjust
```

Completion is useful context, but it is secondary to time investment. The
desktop v0.1 release is local-first, and the active timer plus today's
executable plan are the primary product surface.

## Workspace

```text
apps/
  desktop/        Tauri + React desktop client
  server/         Future Axum delivery adapter

crates/
  frilday-core/   Reusable domain and application rules

docs/
  ARCHITECTURE.md
```

The intended desktop v0.1 runtime is:

```text
React → Tauri adapter → frilday-core → SQLite adapter
```

The server is not required for the desktop runtime. See
[AGENTS.md](AGENTS.md) for the permanent product guardrails and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layer boundaries. The
domain vocabulary and legacy-record mapping are documented in
[docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md).

## Rust validation

The repository-level Cargo workspace includes the core crate, future server
adapter, and Tauri Rust crate. From the repository root:

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
```

## Current status

- `apps/desktop` is the active application surface.
- `apps/server` is a thin future delivery adapter and is not required by the
  desktop runtime.
- The current desktop scaffold still owns the React-facing domain and SQLite
  integration while reusable rules are extracted into `frilday-core`.

## Desktop app

From the repository root:

```bash
cd apps/desktop
bun run build
bunx tauri build
```

The macOS bundle is generated at:

```text
apps/desktop/src-tauri/target/release/bundle/macos/FrilDay.app
```

## Workflow

- Keep `main` buildable.
- Use short-lived branches and small, focused changes.
- Keep UI and adapters thin; put reusable rules in `crates/frilday-core`.
- Avoid committing generated outputs.
