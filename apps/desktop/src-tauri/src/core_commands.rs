use std::collections::HashMap;

use frilday_core::{
    actual_minutes_for_routine, aggregate_for_date, completed_dates_between,
    completion_count_for_routine, completion_stats_between, completion_stats_for_week,
    eligible_dates_between, pause_session_for_routine, resume_session_for_routine,
    running_routine_id, start_session, stop_session_for_routine, toggle_routine_completion,
    visible_dates_between, Completion, LocalDate, Plan, PlanId, PlannedDuration, Routine,
    RoutineCategory, RoutineId, RoutineStatsTarget, ScheduleRule, Session, SessionId, Timestamp,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    id: String,
    title: String,
    days_of_week: Vec<String>,
    duration_minutes: u32,
    start_ymd: Option<String>,
    auto_archive_after: Option<u32>,
    repeat_count: Option<u32>,
    is_active: bool,
    created_at_millis: i64,
    created_local_date: String,
    category: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionInput {
    task_id: String,
    date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionOutput {
    task_id: String,
    date: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryInput {
    id: String,
    task_id: String,
    date: String,
    started_at: String,
    ended_at: Option<String>,
    #[serde(default)]
    paused_at: Option<String>,
    #[serde(default)]
    active_started_at: Option<String>,
    #[serde(default)]
    accumulated_millis: u64,
    started_at_millis: i64,
    ended_at_millis: Option<i64>,
    #[serde(default)]
    paused_at_millis: Option<i64>,
    #[serde(default)]
    active_started_at_millis: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryOutput {
    id: String,
    task_id: String,
    date: String,
    started_at: String,
    ended_at: Option<String>,
    paused_at: Option<String>,
    active_started_at: Option<String>,
    accumulated_millis: u64,
    minutes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRequest {
    tasks: Vec<TaskInput>,
    completions: Vec<CompletionInput>,
    week_start_ymd: String,
    include_archived: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSlotsOutput {
    task_id: String,
    dates: Vec<String>,
    scheduled_dates: Vec<String>,
    completed_dates: Vec<String>,
    completion_count: usize,
}

#[tauri::command]
pub fn core_visible_schedule(request: ScheduleRequest) -> Result<Vec<ScheduleSlotsOutput>, String> {
    let start = parse_date(&request.week_start_ymd)?;
    let end = start
        .checked_add_days(6)
        .map_err(|error| error.to_string())?;
    let completions = request
        .completions
        .iter()
        .map(completion_from_input)
        .collect::<Result<Vec<_>, _>>()?;

    request
        .tasks
        .iter()
        .filter(|task| request.include_archived || task.is_active)
        .map(|task| {
            let routine = routine_from_task(task)?;
            let created_local_date = parse_date(&task.created_local_date)?;
            let dates =
                visible_dates_between(&routine, start, end, created_local_date, &completions)
                    .into_iter()
                    .map(|date| date.to_string())
                    .collect::<Vec<_>>();
            let scheduled_dates = eligible_dates_between(&routine, start, end, created_local_date)
                .into_iter()
                .map(|date| date.to_string())
                .collect();
            let completed_dates = completed_dates_between(&routine, start, end, &completions)
                .into_iter()
                .map(|date| date.to_string())
                .collect();

            Ok(ScheduleSlotsOutput {
                task_id: task.id.clone(),
                dates,
                scheduled_dates,
                completed_dates,
                completion_count: completion_count_for_routine(&completions, routine.id()),
            })
        })
        .collect()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleCompletionRequest {
    tasks: Vec<TaskInput>,
    completions: Vec<CompletionInput>,
    task_id: String,
    date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleCompletionOutput {
    completions: Vec<CompletionOutput>,
    auto_archived: bool,
}

#[tauri::command]
pub fn core_toggle_completion(
    request: ToggleCompletionRequest,
) -> Result<ToggleCompletionOutput, String> {
    let task = request
        .tasks
        .iter()
        .find(|task| task.id == request.task_id)
        .ok_or_else(|| "task not found".to_owned())?;
    let routine = routine_from_task(task)?;
    let routine_id = routine.id().clone();
    let date = parse_date(&request.date)?;
    let completions = request
        .completions
        .iter()
        .map(completion_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let next = toggle_routine_completion(&completions, routine_id, date);
    let auto_archived = routine.is_active() && routine.should_auto_archive(&next);

    Ok(ToggleCompletionOutput {
        completions: next.iter().filter_map(completion_to_output).collect(),
        auto_archived,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsRequest {
    tasks: Vec<TaskInput>,
    completions: Vec<CompletionInput>,
    week_start_ymd: String,
    today_ymd: String,
    month_start_ymd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateOutput {
    scheduled_count: u64,
    completed_count: u64,
    rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyRateOutput {
    week_start: String,
    total_rate: f64,
    weekday_rate: f64,
    weekend_rate: f64,
    daily_rate: f64,
    custom_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsOutput {
    week: WeeklyRateOutput,
    week_range: RateOutput,
    today: RateOutput,
    month: RateOutput,
    all_time: RateOutput,
    today_ymd: String,
    month_start_ymd: String,
    all_start_ymd: String,
    week_end_ymd: String,
}

#[tauri::command]
pub fn core_statistics(request: StatisticsRequest) -> Result<StatisticsOutput, String> {
    let week_start = parse_date(&request.week_start_ymd)?;
    let today = parse_date(&request.today_ymd)?;
    let month_start = parse_date(&request.month_start_ymd)?;
    let completions = request
        .completions
        .iter()
        .map(completion_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let all_start = completions
        .iter()
        .map(Completion::date)
        .min()
        .unwrap_or(today);
    let routines = request
        .tasks
        .iter()
        .map(routine_from_task)
        .collect::<Result<Vec<_>, _>>()?;
    let targets = request
        .tasks
        .iter()
        .zip(routines.iter())
        .map(|(task, routine)| {
            Ok(RoutineStatsTarget {
                routine,
                created_local_date: parse_date(&task.created_local_date)?,
                category: category_from_task(task)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let target_refs = targets;
    let weekly = completion_stats_for_week(&target_refs, &completions, week_start);
    let week_end = week_start
        .checked_add_days(6)
        .map_err(|error| error.to_string())?;

    Ok(StatisticsOutput {
        week: WeeklyRateOutput {
            week_start: weekly.week_start().to_string(),
            total_rate: weekly.total().rate(),
            weekday_rate: weekly.weekday().rate(),
            weekend_rate: weekly.weekend().rate(),
            daily_rate: weekly.daily().rate(),
            custom_rate: weekly.custom().rate(),
        },
        week_range: rate_output(completion_stats_between(
            &target_refs,
            &completions,
            week_start,
            week_end,
        )),
        today: rate_for_date(&target_refs, &completions, week_start, today),
        month: rate_output(completion_stats_between(
            &target_refs,
            &completions,
            month_start,
            today,
        )),
        all_time: rate_output(completion_stats_between(
            &target_refs,
            &completions,
            all_start,
            today,
        )),
        today_ymd: today.to_string(),
        month_start_ymd: month_start.to_string(),
        all_start_ymd: all_start.to_string(),
        week_end_ymd: week_end.to_string(),
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTotalsRequest {
    tasks: Vec<TaskInput>,
    time_entries: Vec<TimeEntryInput>,
    date_ymd: String,
    now_millis: i64,
    task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTimeOutput {
    task_id: String,
    actual_minutes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTotalsOutput {
    planned_minutes: u64,
    actual_minutes: u64,
    by_task: Vec<TaskTimeOutput>,
}

#[tauri::command]
pub fn core_time_totals(request: TimeTotalsRequest) -> Result<TimeTotalsOutput, String> {
    let date = parse_date(&request.date_ymd)?;
    let sessions = request
        .time_entries
        .iter()
        .map(session_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let routines = request
        .tasks
        .iter()
        .map(routine_from_task)
        .collect::<Result<Vec<_>, _>>()?;
    let selected = request
        .task_ids
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let mut plans = Vec::new();
    let mut selected_sessions = Vec::new();
    let mut by_task = Vec::new();

    for (task, routine) in request.tasks.iter().zip(routines.iter()) {
        if selected.contains(task.id.as_str()) && routine.schedule().matches(date.weekday()) {
            let plan_id = PlanId::new(format!("frilday-time-{}", task.id))
                .map_err(|error| error.to_string())?;
            plans.push(Plan::new(
                plan_id,
                Some(routine.id().clone()),
                date,
                routine.planned_duration(),
            ));
        }
        let actual_minutes = actual_minutes_for_routine(
            &sessions,
            routine.id(),
            date,
            Timestamp::from_unix_millis(request.now_millis),
        );
        by_task.push(TaskTimeOutput {
            task_id: task.id.clone(),
            actual_minutes,
        });
    }

    for session in sessions {
        let Some(routine_id) = session.routine_id() else {
            continue;
        };
        if selected.contains(routine_id.as_str()) {
            selected_sessions.push(session);
        }
    }

    let totals = aggregate_for_date(
        &plans,
        &selected_sessions,
        date,
        Timestamp::from_unix_millis(request.now_millis),
    );
    Ok(TimeTotalsOutput {
        planned_minutes: totals.planned_minutes(),
        actual_minutes: totals.actual_minutes(),
        by_task,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningSessionsRequest {
    time_entries: Vec<TimeEntryInput>,
}

#[tauri::command]
pub fn core_running_task_id(request: RunningSessionsRequest) -> Result<Option<String>, String> {
    let sessions = request
        .time_entries
        .iter()
        .map(session_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(running_routine_id(&sessions).map(ToString::to_string))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTimerRequest {
    time_entries: Vec<TimeEntryInput>,
    session_id: String,
    task_id: String,
    date_ymd: String,
    started_at: String,
    started_at_millis: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerOutput {
    time_entries: Vec<TimeEntryOutput>,
}

#[tauri::command]
pub fn core_start_timer(request: StartTimerRequest) -> Result<TimerOutput, String> {
    let date = parse_date(&request.date_ymd)?;
    let sessions = request
        .time_entries
        .iter()
        .map(session_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let task_id = RoutineId::new(request.task_id.clone()).map_err(|error| error.to_string())?;
    let new_session = Session::start(
        SessionId::new(request.session_id).map_err(|error| error.to_string())?,
        Some(task_id),
        None,
        date,
        Timestamp::from_unix_millis(request.started_at_millis),
    )
    .map_err(|error| error.to_string())?;
    let next = start_session(
        &sessions,
        new_session,
        Timestamp::from_unix_millis(request.started_at_millis),
    )
    .map_err(|error| error.to_string())?;
    let new_id = next
        .last()
        .map(|session| session.id().to_string())
        .ok_or_else(|| "new session was not created".to_owned())?;
    let mut outputs = sessions_to_outputs(
        &next,
        &request.time_entries,
        &request.started_at,
        request.started_at_millis,
    );
    if let Some(index) = outputs.iter().position(|entry| entry.id == new_id) {
        let new_entry = outputs.remove(index);
        outputs.insert(0, new_entry);
    }
    Ok(TimerOutput {
        time_entries: outputs,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopTimerRequest {
    time_entries: Vec<TimeEntryInput>,
    task_id: String,
    date_ymd: String,
    ended_at: String,
    ended_at_millis: i64,
}

#[tauri::command]
pub fn core_stop_timer(request: StopTimerRequest) -> Result<TimerOutput, String> {
    let date = parse_date(&request.date_ymd)?;
    let routine_id = RoutineId::new(request.task_id).map_err(|error| error.to_string())?;
    let sessions = request
        .time_entries
        .iter()
        .map(session_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let next = stop_session_for_routine(
        &sessions,
        &routine_id,
        date,
        Timestamp::from_unix_millis(request.ended_at_millis),
    )
    .map_err(|error| error.to_string())?;
    Ok(TimerOutput {
        time_entries: sessions_to_outputs(
            &next,
            &request.time_entries,
            &request.ended_at,
            request.ended_at_millis,
        ),
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseTimerRequest {
    time_entries: Vec<TimeEntryInput>,
    task_id: String,
    date_ymd: String,
    paused_at: String,
    paused_at_millis: i64,
}

#[tauri::command]
pub fn core_pause_timer(request: PauseTimerRequest) -> Result<TimerOutput, String> {
    let date = parse_date(&request.date_ymd)?;
    let routine_id = RoutineId::new(request.task_id).map_err(|error| error.to_string())?;
    let sessions = request
        .time_entries
        .iter()
        .map(session_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let next = pause_session_for_routine(
        &sessions,
        &routine_id,
        date,
        Timestamp::from_unix_millis(request.paused_at_millis),
    )
    .map_err(|error| error.to_string())?;
    Ok(TimerOutput {
        time_entries: sessions_to_outputs(
            &next,
            &request.time_entries,
            &request.paused_at,
            request.paused_at_millis,
        ),
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeTimerRequest {
    time_entries: Vec<TimeEntryInput>,
    task_id: String,
    date_ymd: String,
    resumed_at: String,
    resumed_at_millis: i64,
}

#[tauri::command]
pub fn core_resume_timer(request: ResumeTimerRequest) -> Result<TimerOutput, String> {
    let date = parse_date(&request.date_ymd)?;
    let routine_id = RoutineId::new(request.task_id).map_err(|error| error.to_string())?;
    let sessions = request
        .time_entries
        .iter()
        .map(session_from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let next = resume_session_for_routine(
        &sessions,
        &routine_id,
        date,
        Timestamp::from_unix_millis(request.resumed_at_millis),
    )
    .map_err(|error| error.to_string())?;
    Ok(TimerOutput {
        time_entries: sessions_to_outputs(
            &next,
            &request.time_entries,
            &request.resumed_at,
            request.resumed_at_millis,
        ),
    })
}

fn routine_from_task(task: &TaskInput) -> Result<Routine, String> {
    let id = RoutineId::new(task.id.clone()).map_err(|error| error.to_string())?;
    let schedule = ScheduleRule::custom(
        task.days_of_week
            .iter()
            .map(|day| weekday_from_input(day))
            .collect::<Result<Vec<_>, _>>()?,
    )
    .map_err(|error| error.to_string())?;
    let duration = PlannedDuration::from_minutes(task.duration_minutes)
        .ok_or_else(|| "planned duration must be positive".to_owned())?;
    let mut routine = Routine::new(
        id,
        task.title.clone(),
        "",
        duration,
        schedule,
        Timestamp::from_unix_millis(task.created_at_millis),
    )
    .map_err(|error| error.to_string())?;
    routine.set_starts_on(task.start_ymd.as_deref().map(parse_date).transpose()?);
    routine
        .set_completion_limit(task.auto_archive_after)
        .map_err(|error| error.to_string())?;
    routine
        // `autoArchiveAfter` was also used as the backlog limit by older
        // desktop data when `repeatCount` was absent. Preserve that fallback
        // at the adapter boundary while keeping the core concepts separate.
        .set_occurrence_limit(task.repeat_count.or(task.auto_archive_after))
        .map_err(|error| error.to_string())?;
    if !task.is_active {
        routine.archive();
    }
    Ok(routine)
}

fn routine_id_from_task(task_id: &str) -> Result<RoutineId, String> {
    RoutineId::new(task_id.to_owned()).map_err(|error| error.to_string())
}

fn completion_from_input(input: &CompletionInput) -> Result<Completion, String> {
    Ok(Completion::for_routine(
        routine_id_from_task(&input.task_id)?,
        parse_date(&input.date)?,
    ))
}

fn completion_to_output(completion: &Completion) -> Option<CompletionOutput> {
    completion.routine_id().map(|routine_id| CompletionOutput {
        task_id: routine_id.to_string(),
        date: completion.date().to_string(),
    })
}

fn session_from_input(input: &TimeEntryInput) -> Result<Session, String> {
    let started_at = Timestamp::from_unix_millis(input.started_at_millis);
    let ended_at = input
        .ended_at_millis
        .map(|millis| Timestamp::from_unix_millis(millis));
    let paused_at = input
        .paused_at_millis
        .map(|millis| Timestamp::from_unix_millis(millis));
    let active_started_at = input
        .active_started_at_millis
        .or_else(|| (ended_at.is_none() && paused_at.is_none()).then_some(input.started_at_millis))
        .map(Timestamp::from_unix_millis);
    let accumulated_millis = if input.accumulated_millis == 0 {
        ended_at
            .filter(|ended| *ended >= started_at)
            .map(|ended| started_at.elapsed_millis_until(ended))
            .unwrap_or(0)
    } else {
        input.accumulated_millis
    };
    Session::from_persisted(
        SessionId::new(input.id.clone()).map_err(|error| error.to_string())?,
        Some(routine_id_from_task(&input.task_id)?),
        None,
        parse_date(&input.date)?,
        started_at,
        ended_at,
        accumulated_millis,
        active_started_at,
        paused_at,
    )
    .map_err(|error| error.to_string())
}

fn sessions_to_outputs(
    sessions: &[Session],
    inputs: &[TimeEntryInput],
    now_iso: &str,
    now_millis: i64,
) -> Vec<TimeEntryOutput> {
    let input_by_id: HashMap<&str, &TimeEntryInput> = inputs
        .iter()
        .map(|input| (input.id.as_str(), input))
        .collect();
    sessions
        .iter()
        .filter_map(|session| {
            let input = input_by_id.get(session.id().as_str()).copied();
            let task_id = session.routine_id()?.to_string();
            let started_at = input
                .map(|input| input.started_at.clone())
                .unwrap_or_else(|| now_iso.to_owned());
            let ended_at = session.ended_at().map(|_| {
                input
                    .and_then(|input| input.ended_at.clone())
                    .unwrap_or_else(|| now_iso.to_owned())
            });
            let paused_at = session.paused_at().map(|_| {
                input
                    .and_then(|input| input.paused_at.clone())
                    .unwrap_or_else(|| now_iso.to_owned())
            });
            let active_started_at = session.active_started_at().map(|_| {
                input
                    .and_then(|input| input.active_started_at.clone())
                    .unwrap_or_else(|| now_iso.to_owned())
            });
            Some(TimeEntryOutput {
                id: session.id().to_string(),
                task_id,
                date: session.date().to_string(),
                started_at,
                ended_at,
                paused_at,
                active_started_at,
                accumulated_millis: session.accumulated_millis(),
                minutes: session
                    .actual_duration_at(Timestamp::from_unix_millis(now_millis))
                    .minutes(),
            })
        })
        .collect()
}

fn rate_for_date(
    targets: &[RoutineStatsTarget<'_>],
    completions: &[Completion],
    week_start: LocalDate,
    date: LocalDate,
) -> RateOutput {
    let week_end = week_start.checked_add_days(6).expect("week is bounded");
    let mut scheduled_count = 0;
    let mut completed_count = 0;
    for target in targets.iter().filter(|target| target.routine.is_active()) {
        if !target.routine.schedule().matches(date.weekday()) {
            continue;
        }
        if !visible_dates_between(
            target.routine,
            week_start,
            week_end,
            target.created_local_date,
            completions,
        )
        .contains(&date)
        {
            continue;
        }
        scheduled_count += 1;
        if completions
            .iter()
            .any(|completion| completion.matches_routine_on(target.routine.id(), date))
        {
            completed_count += 1;
        }
    }
    RateOutput {
        scheduled_count,
        completed_count,
        rate: if scheduled_count == 0 {
            0.0
        } else {
            completed_count as f64 * 100.0 / scheduled_count as f64
        },
    }
}

fn rate_output(totals: frilday_core::CompletionTotals) -> RateOutput {
    RateOutput {
        scheduled_count: totals.scheduled_count(),
        completed_count: totals.completed_count(),
        rate: totals.rate(),
    }
}

fn category_from_task(task: &TaskInput) -> Result<RoutineCategory, String> {
    match task.category.as_str() {
        "weekday" => Ok(RoutineCategory::Weekday),
        "weekend" => Ok(RoutineCategory::Weekend),
        "daily" => Ok(RoutineCategory::Daily),
        "custom" => Ok(RoutineCategory::Custom),
        other => Err(format!("unknown task category: {other}")),
    }
}

fn weekday_from_input(value: &str) -> Result<frilday_core::Weekday, String> {
    match value {
        "Mon" => Ok(frilday_core::Weekday::Mon),
        "Tue" => Ok(frilday_core::Weekday::Tue),
        "Wed" => Ok(frilday_core::Weekday::Wed),
        "Thu" => Ok(frilday_core::Weekday::Thu),
        "Fri" => Ok(frilday_core::Weekday::Fri),
        "Sat" => Ok(frilday_core::Weekday::Sat),
        "Sun" => Ok(frilday_core::Weekday::Sun),
        other => Err(format!("unknown weekday: {other}")),
    }
}

fn parse_date(value: &str) -> Result<LocalDate, String> {
    LocalDate::parse(value).map_err(|error| error.to_string())
}
