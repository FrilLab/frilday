# FrilDay domain model

`crates/frilday-core` is the source of truth for reusable planning and time
tracking rules. It is deliberately independent of React, Tauri, Axum, HTTP,
SQLite, PostgreSQL, and serialization libraries.

## Vocabulary

- **Routine** is a reusable intention such as `English study` or `Gym`. It
  owns the title, description, planned duration, recurring schedule, start
  constraint, archive state, and optional completion/occurrence limits. It is
  not an execution record.
- **Plan** is a date-specific intention. It refers to a Routine, copies the
  routine's planned duration as its baseline, and can have a date-specific
  duration override. A Plan can be skipped or moved without changing the
  Routine. Routine-derived Plans are virtual until an override, skip, or
  execution makes the date-specific decision durable.
- **Session** is an actual-work lifecycle. It stores a stable id, its
  associations, the local tracking date, the first start/end timestamps, the
  current active-segment start or pause timestamp, and accumulated active
  milliseconds. Actual minutes are derived from that durable state, so paused
  time is excluded, overtime remains visible, and a cached minutes value cannot
  become a second source of truth.
- **Completion** is an independent binary signal for a routine/date or
  plan/date. Tracking time does not imply completion, and completion does not
  imply that planned time was fully tracked.
- **Review** aggregates executable Plans and Session actual time by local date,
  inclusive period, and Routine. It reports planned minutes, actual minutes,
  variance (`actual - planned`), planned/completed occurrences, and an
  uncapped execution ratio only when planned minutes are positive. Actual time
  without an executable Plan is retained as `unplanned_actual_minutes` so
  migrated or ad-hoc history is not hidden.

## Decisions and invariants

- Routine, Plan, and Session identifiers are distinct non-empty newtypes. A
  Completion uses its routine/plan/date key because legacy completion records
  do not have a separate id. New desktop completion records retain the
  deterministic Plan id alongside the legacy routine/date key.
- `LocalDate` is a calendar date with no time zone. Desktop v0.1 resolves the
  user's local date at the adapter boundary. `Timestamp` is an absolute Unix
  millisecond instant; adapters parse and format persisted ISO timestamps.
- Planned duration is a positive whole number of minutes. Actual duration is a
  non-negative whole number of elapsed minutes, floored from timestamps.
- The local tracking date of a Session is its start date. A session that runs
  over midnight remains attributable to the date on which it started, matching
  the current desktop record shape.
- A running Session has `ended_at = None` and `active_started_at != None`; a
  paused Session has `ended_at = None` and `paused_at != None`. Pause/resume/
  finish transitions reject backwards clock movement. Ending before starting,
  ending an already-ended Session, and invalid persisted states are rejected;
  a collection containing more than one running Session is invalid. The
  desktop session policy permits only one open (running or paused) Session at
  a time, so a paused Session must be resumed or finished before another one
  starts.
- Completion is separate from Session and is idempotently toggled by the
  routine/date key. Duplicate completion dates are counted once for limits.
- Archiving changes only future schedule eligibility. Existing Plans,
  Sessions, Completions, and memo records remain historical data.
- Routine-derived Plan identity is deterministic:
  `routine-plan:<UTF-8 byte length>:<routine id>:<YYYY-MM-DD>`. The Plan's
  source date is its identity; a moved Plan keeps that source date and stores
  its destination separately. A virtual Plan is considered created when an
  override/skip is saved, a Completion is recorded, or a Session starts. Its
  baseline and override are then snapshots and Routine edits cannot change it.
- The desktop adapter uses virtual resolution plus explicit Plan persistence,
  rather than eagerly filling a planning horizon. A Session stores the Plan id
  it started from. Legacy sessions and completions are backfilled to the
  deterministic Routine/date Plan id on database initialization; their
  original routine/date keys remain intact for compatibility.
- The desktop Routine management surface edits reusable defaults as one unit:
  title, description, planned duration, recurrence, start date, and finite
  limits. It does not expose completion or timer controls as part of routine
  maintenance, and it does not offer destructive history deletion.
- A Routine start date cannot make it eligible before its creation-local date;
  `effective_start_on` applies that clamp when the adapter supplies the local
  creation date.
- `repeatCount` is mapped to the core's `occurrence_limit`, a lifetime
  occurrence cap. It is not treated as a weekly recurrence count.
  `autoArchiveAfter` is mapped only to `completion_limit`; it no longer
  silently doubles as an occurrence cap. This intentionally retires the
  confusing legacy fallback while preserving both persisted fields and all
  existing completion history.
- Review keeps Sessions for skipped Plans as actual history but does not count
  the skipped Plan as planned time. A moved Plan is counted on its effective
  destination date only. Multiple Sessions for one Plan are summed, and a
  legacy Session without a Plan id still matches an executable Routine/date
  Plan when one is resolvable. A zero-plan bucket has no execution ratio
  rather than a forced percentage.

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
| legacy `Task.autoArchiveAfter` | `Routine.completion_limit` (app field: `completionLimit`; user-facing label: auto-archive after completions) |
| legacy `Task.repeatCount` | `Routine.occurrence_limit` (app field: `occurrenceLimit`; user-facing label: lifetime occurrence limit; not a weekly recurrence count) |
| `Task.isActive`, `createdAt` | `Routine` archive state and creation timestamp |
| derived scheduled Task/date slot | virtual `Plan`, persisted when overridden/skipped/completed/executed |
| `TimeEntry.id`, `taskId`, `date` | `SessionId`, `RoutineId`, local tracking date |
| `TimeEntry.startedAt`, `endedAt`, `pausedAt`, `activeStartedAt`, `accumulatedMillis` | `Session` lifecycle state |
| `TimeEntry.minutes` | Recomputed from timestamps; retained only as a compatibility/cache field outside core |
| `Completion.taskId`, `planId`, `date` | `Completion::for_routine_and_plan(RoutineId, PlanId, LocalDate)`; legacy rows without `planId` use `Completion::for_routine` until migration backfills the link |
| `TaskDailyMemo.taskId`, `date`, `text`, `updatedAt` | Adapter-owned daily memo record associated with a `Routine` and date |

The desktop persistence adapter remains responsible for reading/writing these
legacy-shaped records. The React compatibility boundary only reads the old
localStorage collections during the one-time import; moving the rules into
core does not require a destructive database migration.

## Migration baseline

The pre-migration desktop rules were characterized against the following
contracts and are now represented by Rust tests and Tauri adapter tests:

- A routine is eligible only on its configured local weekdays and not before
  `max(createdAt in the desktop local timezone, startYmd)`. A displayed week
  contains scheduled dates plus completed dates, even when a completed date no
  longer matches the current schedule.
- A skipped Plan is retained as a date-specific exception and is not
  executable. Removing an override/skip deletes the exception when there is no
  execution history, returning the date to Routine-derived behavior; once a
  Session or Completion references the Plan, the snapshot is retained.
- `repeatCount` is a lifetime cap on planned occurrences. Completed dates are
  retained inside the displayed period. `autoArchiveAfter` is only the
  completion threshold; it no longer silently doubles as an occurrence cap.
- Completion toggles operate on the routine/date key, preserve unrelated
  records, and do not imply tracked time. Reaching `autoArchiveAfter` archives
  an active routine after the completion is added.
- Starting a timer keeps one open session: another routine's running session
  is finished at the new start instant, while starting the same routine again
  is rejected. A paused session must be resumed or finished before another
  session starts. Pause/resume/finish can find a session started on an earlier
  local day, and overnight work remains attributed to its start date.
- Session actual minutes are floored from durable active milliseconds and may
  exceed the planned duration. The persisted `minutes` column remains a
  compatibility field; core calculations derive actual time from lifecycle
  state. Reaching the planned duration never finishes a running session, so
  overtime is retained until the user pauses or finishes it.
- Weekly completion statistics count each active routine at most once when it
  has any completion in the week. Period statistics count executable scheduled
  Plan instances; skipped Plan exceptions are excluded from both period and
  daily denominators.
  Planned and actual minute totals are aggregated separately.

The explicit parity refinements from the stable domain model are that invalid
planned durations are rejected by core, date constraints are applied without
UTC conversion, and range statistics honor the routine's start/active
eligibility rule.
