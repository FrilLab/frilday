# Planning model validation

This is the final validation record for [#22](../issues/22) and the
completion evidence for [#17](../issues/17).
The validation was run against the planning implementation on `main` after
PR #45.

## Scenario results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Routine → Plan | Pass | `resolve_plans` derives one deterministic Plan per eligible Routine/date; `planning.rs` covers stable IDs and range de-duplication. |
| One-day duration override | Pass | Persisted Plan override wins after Routine changes; desktop projection sums the effective duration and leaves the Routine default unchanged. |
| Skip and restore | Pass | Skipped Plans remain visible for context but are excluded from executable totals; restoring removes the exception when there is no history. |
| Move | Pass | A moved Plan is projected at its destination and a scheduled destination still yields one effective occurrence; destination collisions are rejected by the desktop store. |
| Historical stability | Pass | Plans with Session/Completion history are protected from adjustment; persisted snapshots remain stable after schedule changes and archive, including after re-resolution. Legacy records are backfilled to stable Plan IDs. |
| Daily and weekly budget | Pass | The weekly projection sums effective executable Plan durations by day and week, while skipped duration is reported separately. |
| Over-planning feedback | Pass | A persisted, configurable daily capacity drives an advisory warning when planned minutes exceed capacity. |
| Time-budget-first UX | Pass | The Schedule surface makes daily/week planned duration and load bars primary; Plan count is secondary summary context. |

The core model keeps Routine, Plan, Session, and Completion separate. Planned
minutes are aggregated independently from actual Session minutes, and
Completion remains an independent signal. See
[DOMAIN_MODEL.md](DOMAIN_MODEL.md) for the materialization and migration
decisions.

## Automated checks

All supported repository checks passed after installing the locked desktop
dependencies with `bun install --frozen-lockfile`:

| Check | Result |
| --- | --- |
| `bun run test` in `apps/desktop` | Pass — 30 tests |
| `bun run lint` in `apps/desktop` | Pass |
| `bun run build` in `apps/desktop` | Pass |
| `cargo fmt --all -- --check` | Pass |
| `cargo check --workspace --locked` | Pass |
| `cargo test --workspace --locked` | Pass — 38 core tests, 9 desktop tests |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Pass |

The repository has no headless GUI click-through harness. The state
transitions above are covered at the core, Tauri command, persistence, and
weekly projection boundaries; a visual desktop smoke test remains a separate
human-run check when a display is available.
