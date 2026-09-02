import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './runtime';
import { toYmd } from '../../shared/utils/date';
import type { Completion, Plan, Task, TimeEntry } from '../../shared/types';

type CoreTaskInput = {
  id: string;
  title: string;
  daysOfWeek: readonly Task['daysOfWeek'][number][];
  durationMinutes: number;
  startYmd: string | null;
  completionLimit: number | null;
  occurrenceLimit: number | null;
  isActive: boolean;
  createdAtMillis: number;
  createdLocalDate: string;
  category: Task['category'];
};

type CoreCompletionInput = {
  taskId: string;
  planId: string | null;
  date: string;
};

type CoreTimeEntryInput = {
  id: string;
  taskId: string;
  planId: string | null;
  date: string;
  startedAt: string;
  endedAt: string | null;
  pausedAt: string | null;
  activeStartedAt: string | null;
  accumulatedMillis: number;
  startedAtMillis: number;
  endedAtMillis: number | null;
  pausedAtMillis: number | null;
  activeStartedAtMillis: number | null;
};

type CorePlanInput = {
  id: string;
  routineId: string | null;
  date: string;
  baselineDurationMinutes: number;
  durationOverrideMinutes: number | null;
  status: Plan['status'];
  movedToYmd: string | null;
};

export type CorePlan = CorePlanInput & {
  plannedDurationMinutes: number;
  effectiveDate: string;
  executable: boolean;
};

export type CoreScheduleSlot = {
  taskId: string;
  dates: string[];
  scheduledDates: string[];
  completedDates: string[];
  completionCount: number;
  plans: CorePlan[];
};

export type CoreWeeklyStats = {
  weekStart: string;
  totalRate: number;
  weekdayRate: number;
  weekendRate: number;
  dailyRate: number;
  customRate: number;
};

export type CoreRateStats = {
  scheduledCount: number;
  completedCount: number;
  rate: number;
};

export type CoreStatistics = {
  week: CoreWeeklyStats;
  weekRange: CoreRateStats;
  today: CoreRateStats;
  month: CoreRateStats;
  allTime: CoreRateStats;
  todayYmd: string;
  monthStartYmd: string;
  allStartYmd: string;
  weekEndYmd: string;
};

export type CoreTimeTotals = {
  plannedMinutes: number;
  actualMinutes: number;
  byTask: Array<{ taskId: string; actualMinutes: number }>;
};

export type CoreTargetReachedResult = {
  tasks: Array<{
    sessionId: string;
    taskId: string;
    title: string;
    actualMinutes: number;
    plannedMinutes: number;
  }>;
};
function assertFiniteMillis(value: string, field: string): number {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return millis;
}

function toCoreTask(task: Task): CoreTaskInput {
  const createdAtMillis = assertFiniteMillis(task.createdAt, 'createdAt');
  return {
    id: task.id,
    title: task.title,
    daysOfWeek: [...task.daysOfWeek],
    durationMinutes: task.durationMinutes,
    startYmd: task.startYmd ?? null,
    completionLimit: task.completionLimit ?? null,
    occurrenceLimit: task.occurrenceLimit ?? null,
    isActive: task.isActive,
    createdAtMillis,
    // Date conversion is deliberately at the desktop/local-time boundary.
    createdLocalDate: toYmd(new Date(createdAtMillis)),
    category: task.category,
  };
}

function toCoreCompletion(completion: Completion): CoreCompletionInput {
  return {
    taskId: completion.taskId,
    planId: completion.planId ?? null,
    date: completion.date,
  };
}

function toCoreTimeEntry(entry: TimeEntry): CoreTimeEntryInput {
  return {
    id: entry.id,
    taskId: entry.taskId,
    planId: entry.planId ?? null,
    date: entry.date,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    pausedAt: entry.pausedAt,
    activeStartedAt: entry.activeStartedAt,
    accumulatedMillis: entry.accumulatedMillis,
    startedAtMillis: assertFiniteMillis(entry.startedAt, 'startedAt'),
    endedAtMillis:
      entry.endedAt == null
        ? null
        : assertFiniteMillis(entry.endedAt, 'endedAt'),
    pausedAtMillis:
      entry.pausedAt == null
        ? null
        : assertFiniteMillis(entry.pausedAt, 'pausedAt'),
    activeStartedAtMillis:
      entry.activeStartedAt == null
        ? null
        : assertFiniteMillis(entry.activeStartedAt, 'activeStartedAt'),
  };
}

function toCorePlan(plan: Plan): CorePlanInput {
  return {
    id: plan.id,
    routineId: plan.routineId,
    date: plan.date,
    baselineDurationMinutes: plan.baselineDurationMinutes,
    durationOverrideMinutes: plan.durationOverrideMinutes,
    status: plan.status,
    movedToYmd: plan.movedToYmd,
  };
}

async function invokeCore<T>(
  command: string,
  request: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new Error('FrilDay core is available in the Tauri desktop runtime.');
  }
  return invoke<T>(command, { request });
}

export async function getVisibleScheduleSlots(input: {
  tasks: Task[];
  completions: Completion[];
  plans?: Plan[];
  weekStartYmd: string;
  includeArchived?: boolean;
}): Promise<CoreScheduleSlot[]> {
  return invokeCore<CoreScheduleSlot[]>('core_visible_schedule', {
    tasks: input.tasks.map(toCoreTask),
    completions: input.completions.map(toCoreCompletion),
    plans: (input.plans ?? []).map(toCorePlan),
    weekStartYmd: input.weekStartYmd,
    includeArchived: input.includeArchived ?? false,
  });
}

export async function hasVirtualPlanOnDateWithCore(input: {
  tasks: Task[];
  completions: Completion[];
  taskId: string;
  dateYmd: string;
}): Promise<boolean> {
  return invokeCore<boolean>('core_virtual_plan_exists', {
    tasks: input.tasks.map(toCoreTask),
    completions: input.completions.map(toCoreCompletion),
    taskId: input.taskId,
    dateYmd: input.dateYmd,
  });
}

export async function toggleCompletionWithCore(input: {
  tasks: Task[];
  completions: Completion[];
  plans?: Plan[];
  taskId: string;
  date: string;
}): Promise<{ completions: Completion[]; autoArchived: boolean }> {
  return invokeCore<{ completions: Completion[]; autoArchived: boolean }>(
    'core_toggle_completion',
    {
      tasks: input.tasks.map(toCoreTask),
      completions: input.completions.map(toCoreCompletion),
      plans: (input.plans ?? []).map(toCorePlan),
      taskId: input.taskId,
      date: input.date,
    },
  );
}

export async function getCoreStatistics(input: {
  tasks: Task[];
  completions: Completion[];
  plans?: Plan[];
  weekStartYmd: string;
  todayYmd: string;
  monthStartYmd: string;
}): Promise<CoreStatistics> {
  return invokeCore<CoreStatistics>('core_statistics', {
    tasks: input.tasks.map(toCoreTask),
    completions: input.completions.map(toCoreCompletion),
    plans: (input.plans ?? []).map(toCorePlan),
    weekStartYmd: input.weekStartYmd,
    todayYmd: input.todayYmd,
    monthStartYmd: input.monthStartYmd,
  });
}

export async function getCoreTimeTotals(input: {
  tasks: Task[];
  plans?: Plan[];
  timeEntries: TimeEntry[];
  dateYmd: string;
  nowIso: string;
  taskIds: string[];
}): Promise<CoreTimeTotals> {
  return invokeCore<CoreTimeTotals>('core_time_totals', {
    tasks: input.tasks.map(toCoreTask),
    plans: (input.plans ?? []).map(toCorePlan),
    timeEntries: input.timeEntries.map(toCoreTimeEntry),
    dateYmd: input.dateYmd,
    nowMillis: assertFiniteMillis(input.nowIso, 'nowIso'),
    taskIds: input.taskIds,
  });
}

export async function getRunningTaskIdWithCore(
  timeEntries: TimeEntry[],
): Promise<string | null> {
  return invokeCore<string | null>('core_running_task_id', {
    timeEntries: timeEntries.map(toCoreTimeEntry),
  });
}

export async function startTimerWithCore(input: {
  timeEntries: TimeEntry[];
  sessionId: string;
  taskId: string;
  planId?: string | null;
  dateYmd: string;
  startedAt: string;
}): Promise<TimeEntry[]> {
  return (
    await invokeCore<{ timeEntries: TimeEntry[] }>('core_start_timer', {
      timeEntries: input.timeEntries.map(toCoreTimeEntry),
      sessionId: input.sessionId,
      taskId: input.taskId,
      planId: input.planId ?? null,
      dateYmd: input.dateYmd,
      startedAt: input.startedAt,
      startedAtMillis: assertFiniteMillis(input.startedAt, 'startedAt'),
    })
  ).timeEntries;
}

export async function stopTimerWithCore(input: {
  timeEntries: TimeEntry[];
  taskId: string;
  dateYmd: string;
  endedAt: string;
}): Promise<TimeEntry[]> {
  return (
    await invokeCore<{ timeEntries: TimeEntry[] }>('core_stop_timer', {
      timeEntries: input.timeEntries.map(toCoreTimeEntry),
      taskId: input.taskId,
      dateYmd: input.dateYmd,
      endedAt: input.endedAt,
      endedAtMillis: assertFiniteMillis(input.endedAt, 'endedAt'),
    })
  ).timeEntries;
}

export async function getTargetReachedWithCore(input: {
  tasks: Task[];
  plans?: Plan[];
  timeEntries: TimeEntry[];
  nowIso: string;
}): Promise<CoreTargetReachedResult> {
  return invokeCore<CoreTargetReachedResult>('core_target_reached', {
    tasks: input.tasks.map(toCoreTask),
    plans: (input.plans ?? []).map(toCorePlan),
    timeEntries: input.timeEntries.map(toCoreTimeEntry),
    nowIso: input.nowIso,
    nowMillis: assertFiniteMillis(input.nowIso, 'nowIso'),
  });
}

export async function pauseTimerWithCore(input: {
  timeEntries: TimeEntry[];
  taskId: string;
  dateYmd: string;
  pausedAt: string;
}): Promise<TimeEntry[]> {
  return (
    await invokeCore<{ timeEntries: TimeEntry[] }>('core_pause_timer', {
      timeEntries: input.timeEntries.map(toCoreTimeEntry),
      taskId: input.taskId,
      dateYmd: input.dateYmd,
      pausedAt: input.pausedAt,
      pausedAtMillis: assertFiniteMillis(input.pausedAt, 'pausedAt'),
    })
  ).timeEntries;
}

export async function resumeTimerWithCore(input: {
  timeEntries: TimeEntry[];
  taskId: string;
  dateYmd: string;
  resumedAt: string;
}): Promise<TimeEntry[]> {
  return (
    await invokeCore<{ timeEntries: TimeEntry[] }>('core_resume_timer', {
      timeEntries: input.timeEntries.map(toCoreTimeEntry),
      taskId: input.taskId,
      dateYmd: input.dateYmd,
      resumedAt: input.resumedAt,
      resumedAtMillis: assertFiniteMillis(input.resumedAt, 'resumedAt'),
    })
  ).timeEntries;
}
