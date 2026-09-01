# FrilDay Domain Model

This document defines the stable vocabulary for the FrilDay v0.1 planning
loop. It is deliberately separate from React, Tauri, SQLite, and HTTP so
future delivery adapters cannot redefine the meaning of planned or actual
time.

## Product boundary

FrilDay is built around:

```text
Plan → Execute → Track → Review → Adjust
```

The primary comparison is planned time versus actual tracked time.
Completion is useful context, but it is not a replacement for time tracking.

The dependency-free Rust types in `crates/frilday-core/src/model.rs` are the
initial executable form of this vocabulary. The desktop currently still uses
its legacy TypeScript and SQLite shapes; the later extraction and persistence
issues must add adapters without changing these meanings.

## Concepts

### Routine

A `Routine` is a reusable intention and schedule rule, such as `English
study`, `Gym`, or `Rust study`. It contains:

- a stable `RoutineId`;
- title and description;
- a default planned duration in whole minutes;
- a recurring schedule rule;
- a local start date, when one is set;
- active or archived state;
- its creation instant and creation local date;
- optional completion/archive and finite-planning limits needed by the
  current desktop behavior.

A Routine is not an execution record and has no date-specific actual duration.
Archiving prevents new schedule eligibility but never removes historical
Plans, Sessions, Completions, or notes. Explicit permanent deletion is a
separate destructive operation and must not be used as archive behavior.

### Plan

A `Plan` is a concrete intention for one local calendar date. It contains:

- a stable `PlanId`;
- an optional source `RoutineId` (allowing a future ad-hoc plan);
- the local date;
- the effective planned duration for that date;
- an optional date-specific duration override;
- `Planned`, `Skipped`, or `Moved { to }` state.

The effective planned duration is a snapshot. If a routine's default changes
later, an existing Plan does not silently change. A date override is recorded
separately while `planned_duration` remains the value used for planned-versus-
actual comparisons.

### Session

A `Session` is a real interval of tracked work. It contains:

- a stable `SessionId`;
- a Routine and/or Plan association;
- a start instant;
- an optional end instant, where `None` means running.

Actual duration is derived from the timestamps (whole minutes are available as
an aggregation view). A mutable cached `minutes` column is not a source of
truth. An end before the start is invalid. A session may cross local midnight;
its plan/date association remains the one selected when the session started,
while its elapsed interval still uses the complete timestamps.

Desktop v0.1 permits at most one running Session across the application. The
core `start_session` operation validates the existing collection and the
prospective session before insertion; `ensure_single_running_session` remains
available for validating an already assembled collection.

### Completion

A `Completion` is a binary signal for a Routine/date or Plan/date. A historical
completion may retain both its RoutineId and materialized PlanId, but its
canonical toggle key is Routine/date whenever the routine is known. A
standalone Plan completion uses Plan/date. Toggling by that canonical key is
idempotent and must not duplicate records. It has no Session foreign key. A
user can:

- track time without completing a Plan;
- complete a Plan without tracking time;
- spend more or less actual time than its planned duration.

## Value and time semantics

### Identity

Routine, Plan, and Session IDs are opaque, stable strings owned by the
application boundary that creates them. The core validates that they are
non-empty but does not generate UUIDs or embed cloud/account ownership. A
Completion uses a natural composite identity: Routine/date when a routine
association exists, otherwise Plan/date. It does not need an independently
meaningful ID.

### Date versus timestamp

- A date is a local calendar date in the user's desktop timezone and is
  represented canonically as `YYYY-MM-DD`.
- A timestamp is an instant represented in the core as Unix seconds. The
  desktop adapter may persist and exchange ISO-8601 strings, but parsing and
  formatting belong outside the core.
- Schedule eligibility, completion keys, Plan dates, and the legacy `date`
  column use local dates. They must not be computed by converting a local day
  through UTC.
- Desktop v0.1 uses the machine's current local timezone. There is no stored
  per-record timezone or cloud synchronization policy in this model.
- A session's elapsed duration is timestamp-based, so daylight-saving or
  midnight boundaries do not create artificial pauses or resets.

### Planned and actual duration

Planned duration is a positive whole-minute `PlannedDuration` value. Actual
duration is a `TrackedDuration` derived from session timestamps and may be
zero for a session shorter than one minute. They are separate types and
separate facts; neither is inferred from Completion.

## Invariants

The core enforces these rules:

1. Entity IDs are non-empty and remain stable after creation.
2. Local dates are real Gregorian dates in canonical `YYYY-MM-DD` form.
3. Planned duration is greater than zero and expressed in minutes.
4. A Routine title is non-empty; its start date cannot precede its creation
   local date.
5. A custom schedule has at least one unique weekday.
6. A Plan retains its original date and effective planned duration when it is
   skipped or moved.
7. A Session has a Routine or Plan association, and its end cannot precede its
   start.
8. Actual Session duration is derived from timestamps; running Sessions use a
   supplied `now` instant for the calculation.
9. There is at most one running Session in the desktop aggregate.
10. Completion is independent of Sessions and planned duration.
11. Archiving changes future eligibility only and preserves historical data.

## Current desktop migration map

The current desktop vocabulary is retained until the later migration issues
can move adapters safely. The mapping below is the compatibility contract.

| Current persisted record | Stable concept | Mapping |
| --- | --- | --- |
| `Task.id` | `RoutineId` | Preserve the exact existing ID. |
| `Task.title`, `description` | Routine text | Preserve trimmed user content. |
| `Task.durationMinutes` | Routine default planned duration | Preserve as positive whole minutes. |
| `Task.category`, `daysOfWeek` | Routine schedule rule | Map weekday/weekend/daily/custom to the equivalent weekday set. |
| `Task.startYmd` | Routine `starts_on` | Preserve the local date; the adapter keeps the existing created-date cutoff. |
| `Task.createdAt` | Routine `created_at` | Parse the existing ISO instant; derive `created_on` in the desktop local timezone. |
| `Task.isActive` | Routine state | `true` → Active, `false` → Archived. |
| `Task.autoArchiveAfter` | Routine archive-after-completions limit | Preserve the optional positive threshold. |
| `Task.repeatCount` | Routine finite-planning limit | Preserve as the legacy finite planning/backlog limit until scheduling extraction defines a more specific policy. |
| `Completion(taskId, date)` | Routine/date Completion | Preserve the task ID as `RoutineId` and the local date. If a historical Plan is materialized, use the completion form that retains both IDs while keeping Routine/date as the canonical toggle key. |
| `TimeEntry.id` | `SessionId` | Preserve the exact existing entry ID. |
| `TimeEntry.taskId` | Session `routine_id` | Preserve the task ID as `RoutineId`. |
| `TimeEntry.date` | Session's historical Plan date | Use it to find or create the stable historical Plan for that routine/date. |
| `TimeEntry.startedAt`, `endedAt` | Session timestamps | Parse the existing ISO instants. Preserve running state when `endedAt` is null. |
| `TimeEntry.minutes` | Derived/cache compatibility field | Do not treat it as authoritative; recompute actual duration from timestamps. Invalid temporal rows must be reported/quarantined rather than silently discarded. |
| `TaskDailyMemo` | Day-scoped routine/Plan note | Preserve `id`, text, update instant, routine ID, and local date. It remains adapter-owned metadata rather than a new core planning concept. |

The existing schema has no Plan table. Migration therefore materializes a
stable historical Plan (for example, `legacy-plan:{routine-id}:{date}`) for
each distinct routine/date referenced by a Completion or Session. Future Plans
are derived from the Routine schedule and are not fabricated for every date
just because a routine exists. This preserves historical comparisons without
inventing work the user never planned.

Migration is non-destructive and idempotent: keep the existing database file
and identifiers, add the new representation alongside the old data while it
is validated, and only mark a record migrated after its Routine, historical
Plan, Session, Completion, and memo mappings have committed successfully.
Malformed legacy data must remain recoverable and be surfaced to the adapter
or migration report; it must not be silently deleted.

## Explicitly out of scope

The model contains no users, accounts, teams, ownership, billing, cloud-sync
metadata, CRDTs, HTTP concepts, or database types. Those concerns belong to
future delivery or persistence adapters only.
