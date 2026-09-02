// (role: day-of-week token, type: union)
export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

// (role: category discriminator, type: union)
export type Category = 'weekday' | 'weekend' | 'daily' | 'custom';

// (role: base fields shared by all tasks, type: interface)
export interface TaskBase {
  id: string; // (role: task id, type: string)
  title: string; // (role: task title, type: string)
  description: string; // (role: persistent text, type: string)
  category: Category; // (role: schedule rule, type: Category)
  daysOfWeek: readonly DayOfWeek[]; // (role: schedule days, type: readonly DayOfWeek[])
  durationMinutes: number; // (role: reusable default planned duration, type: minutes)
  startYmd?: string | null; // (role: first eligible date YYYY-MM-DD, type: string | null | undefined)
  completionLimit?: number | null; // (role: completion limit, type: number | null | undefined)
  occurrenceLimit?: number | null; // (role: lifetime occurrence limit, type: number | null | undefined)
  isActive: boolean; // (role: archive flag, type: boolean)
  createdAt: string; // (role: ISO timestamp, type: string)
}

// (role: unified task type, type: alias)
export type Task = TaskBase;

// Routine is the product vocabulary. Task remains as a compatibility alias
// until date-specific Plan records replace the legacy desktop shape.
export type Routine = TaskBase;

export type PlanStatus = 'planned' | 'skipped' | 'moved';

// A persisted record is only created for an explicit date decision, completion,
// or execution. Routine-derived plans may remain virtual in the UI.
export interface Plan {
  id: string;
  routineId: string | null;
  date: string;
  baselineDurationMinutes: number;
  durationOverrideMinutes: number | null;
  status: PlanStatus;
  movedToYmd: string | null;
}

// (role: completion record, type: interface)
export interface Completion {
  taskId: string; // (role: completed task id, type: string)
  planId?: string | null; // (role: stable date-specific plan id, type: string | null)
  date: string; // (role: YYYY-MM-DD, type: string)
}

// (role: time tracking record, type: interface)
export interface TimeEntry {
  id: string; // (role: time entry id, type: string)
  taskId: string; // (role: task id, type: string)
  planId?: string | null; // (role: stable date-specific plan id, type: string | null)
  date: string; // (role: YYYY-MM-DD, type: string)
  startedAt: string; // (role: ISO timestamp, type: string)
  endedAt: string | null; // (role: ISO timestamp or null if running, type: string | null)
  pausedAt: string | null; // (role: pause transition timestamp, type: string | null)
  activeStartedAt: string | null; // (role: current active segment start, type: string | null)
  accumulatedMillis: number; // (role: completed active segments, type: milliseconds)
  minutes: number; // (role: computed minutes, type: number)
}

// (role: per-task per-day memo, type: interface)
export interface TaskDailyMemo {
  id: string; // (role: unique memo id, type: string)
  taskId: string; // (role: task id, type: string)
  date: string; // (role: YYYY-MM-DD, type: string)
  text: string; // (role: memo text, type: string)
  updatedAt: string; // (role: ISO timestamp, type: string)
}

// (role: core-derived task state for a local day, type: interface)
export interface TaskDayState {
  scheduled: boolean; // (role: scheduled by the core rule, type: boolean)
  completed: boolean; // (role: completion signal, type: boolean)
  completionCount: number; // (role: all-time completion count, type: number)
  actualMinutes: number; // (role: core-derived actual minutes, type: number)
  plannedMinutes: number; // (role: effective date-specific planned minutes, type: number)
  planId: string | null; // (role: stable date-specific plan id, type: string | null)
  planStatus: PlanStatus | null; // (role: date-specific plan state, type: PlanStatus | null)
  planHasOverride: boolean; // (role: explicit date-specific duration flag, type: boolean)
}
