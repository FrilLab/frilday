# FrilDay domain model

`crates/frilday-core` is the source of truth for reusable planning and time
tracking rules. It is deliberately independent of React, Tauri, Axum, HTTP,
SQLite, PostgreSQL, and serialization libraries.

## Vocabulary

- **Routine** is a reusable intention such as `English study` or `Gym`. It
  owns the title, description, planned duration, recurring schedule, start
  constraint, archive state, and optional completion/occurrence limits. It is
  not an execution record.
- **Plan** is a date-specific intention. It may refer to a Routine, copies the
  routine's planned duration as its baseline, and can have a date-specific
  duration override. A Plan can be skipped or moved without changing the
  Routine.
- **Session** is an interval of actual work. It stores a stable id, its
  associations, the local tracking date, and start/end timestamps. Actual
  minutes are derived from timestamps, so overtime remains visible and a
  cached minutes value cannot become a second source of truth.
- **Completion** is an independent binary signal for a routine/date or
  plan/date. Tracking time does not imply completion, and completion does not
  imply that planned time was fully tracked.

## Decisions and invariants

- Routine, Plan, and Session identifiers are distinct non-empty newtypes. A
  Completion uses its routine/plan/date key because legacy completion records
  do not have a separate id.
- `LocalDate` is a calendar date with no time zone. Desktop v0.1 resolves the
  user's local date at the adapter boundary. `Timestamp` is an absolute Unix
  millisecond instant; adapters parse and format persisted ISO timestamps.
- Planned duration is a positive whole number of minutes. Actual duration is a
  non-negative whole number of elapsed minutes, floored from timestamps.
- The local tracking date of a Session is its start date. A session that runs
  over midnight remains attributable to the date on which it started, matching
  the current desktop record shape.
- A running Session has `ended_at = None`. Ending before starting is rejected,
  ending an already-ended Session is rejected, and a collection containing
  more than one running Session is invalid.
- Completion is separate from Session and is idempotently toggled by the
  routine/date key. Duplicate completion dates are counted once for limits.
- Archiving changes only future schedule eligibility. Existing Plans,
  Sessions, Completions, and memo records remain historical data.
- A Routine start date cannot make it eligible before its creation-local date;
  `effective_start_on` applies that clamp when the adapter supplies the local
  creation date.
- `repeatCount` is mapped to the core's `occurrence_limit`, a lifetime
  occurrence cap, because that is the behavior of the current desktop
  schedule-limit implementation. It is not treated as a weekly recurrence
  count. For legacy records without `repeatCount`, the adapter retains the
  existing `autoArchiveAfter` backlog-limit fallback while also mapping it to
  `completion_limit`.

## Legacy data mapping

The migration is an adapter concern and does not rename existing storage keys
or the `daily_check.db` filename.

| Existing desktop record | Core representation |
| --- | --- |
| `Task.id` | `RoutineId` |
| `Task.title`, `description` | `Routine` text fields |
| `Task.category` and `daysOfWeek` | `ScheduleRule` (`weekday`, `weekend`, `daily`, or `custom`) |
| `Task.durationMinutes` | `Routine` `PlannedDuration` |
| `Task.startYmd` | `Routine.starts_on`, clamped against the local creation date |
| `Task.autoArchiveAfter` | `Routine.completion_limit` |
| `Task.repeatCount` | `Routine.occurrence_limit` (with the legacy `autoArchiveAfter` fallback when absent) |
| `Task.isActive`, `createdAt` | `Routine` archive state and creation timestamp |
| derived scheduled Task/date slot | `Plan` when the adapter begins materializing date-specific plans |
| `TimeEntry.id`, `taskId`, `date` | `SessionId`, `RoutineId`, local tracking date |
| `TimeEntry.startedAt`, `endedAt` | `Session` timestamps |
| `TimeEntry.minutes` | Recomputed from timestamps; retained only as a compatibility/cache field outside core |
| `Completion.taskId`, `date` | `Completion::for_routine(RoutineId, LocalDate)` |
| `TaskDailyMemo.taskId`, `date`, `text`, `updatedAt` | Adapter-owned daily memo record associated with a `Routine` and date |

The current desktop adapter remains responsible for reading/writing these
legacy collections. Moving the rules into core does not require a destructive
database migration.

## Migration baseline

The pre-migration desktop rules were characterized against the following
contracts and are now represented by Rust tests and Tauri adapter tests:

- A routine is eligible only on its configured local weekdays and not before
  `max(createdAt in the desktop local timezone, startYmd)`. A displayed week
  contains scheduled dates plus completed dates, even when a completed date no
  longer matches the current schedule.
- `repeatCount` is a lifetime cap on planned occurrences. Completed dates are
  retained inside the displayed period; when `repeatCount` is absent,
  `autoArchiveAfter` remains the legacy backlog-cap fallback.
- Completion toggles operate on the routine/date key, preserve unrelated
  records, and do not imply tracked time. Reaching `autoArchiveAfter` archives
  an active routine after the completion is added.
- Starting a timer keeps at most one running session: another routine's
  running session is stopped at the new start instant, while starting the same
  routine again is rejected. Stopping can find a session started on an earlier
  local day, and overnight work remains attributed to its start date.
- Session actual minutes are floored elapsed timestamp minutes and may exceed
  the planned duration. The persisted `minutes` column remains a compatibility
  field; core calculations derive actual time from timestamps.
- Weekly completion statistics count each active routine at most once when it
  has any completion in the week. Period statistics count scheduled instances.
  Planned and actual minute totals are aggregated separately.

The explicit parity refinements from the stable domain model are that invalid
planned durations are rejected by core, date constraints are applied without
UTC conversion, and range statistics honor the routine's start/active
eligibility rule.
