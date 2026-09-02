import { create } from 'zustand';
import type {
  Category,
  Completion,
  DayOfWeek,
  Plan,
  Task,
  TaskDailyMemo,
  TimeEntry,
} from '../../shared/types';
import {
  loadAppData,
  deletePlan,
  savePlan,
  saveTask,
  saveTaskDailyMemo,
  saveTimeEntries,
  setCompletion,
  setTaskActive,
} from '../../infrastructure/storage';
import { toYmd } from '../../shared/utils/date';
import {
  createSerialQueue,
  type AsyncOperation,
} from '../../shared/utils/serialQueue';
import {
  createTaskEntity,
  updateTaskEntity,
} from '../../domain/task/taskFactory';
import { getNotifier } from '../di/notifierDI';
import { upsertDailyMemo } from '../../domain/memo';
import { createRoutinePlan, routinePlanId } from '../../domain/plan/plan';
import {
  getTargetReachedWithCore,
  pauseTimerWithCore,
  resumeTimerWithCore,
  startTimerWithCore,
  stopTimerWithCore,
  toggleCompletionWithCore,
} from '../../infrastructure/tauri/core';

export type Filter = 'all' | Category;

export type TargetReachedTask = {
  sessionId: string;
  taskId: string;
  title: string;
  actualMinutes: number;
  plannedMinutes: number;
};

interface FrilDayState {
  hydrated: boolean;
  tasks: Task[];
  completions: Completion[];
  plans: Plan[];
  timeEntries: TimeEntry[];
  taskDailyMemos: TaskDailyMemo[];
  targetReached: TargetReachedTask[];
  filter: Filter;
  errorMsg: string;

  hydrate: () => Promise<void>;
  setFilter: (filter: Filter) => void;
  clearError: () => void;

  createTask: (input: {
    title: string;
    description: string;
    category: Category;
    durationMinutes: number;
    startYmd?: string | null;
    completionLimit?: number | null;
    occurrenceLimit?: number | null;
    customDays?: DayOfWeek[];
  }) => boolean;

  updateTaskMeta: (input: {
    taskId: string;
    title: string;
    description: string;
    category: Category;
    durationMinutes: number;
    startYmd?: string | null;
    completionLimit?: number | null;
    occurrenceLimit?: number | null;
    customDays?: DayOfWeek[];
  }) => boolean;

  archiveTask: (taskId: string) => void;
  restoreTask: (taskId: string) => void;
  toggleToday: (input: { taskId: string; today: Date }) => Promise<void>;
  setPlanDurationOverride: (input: {
    taskId: string;
    date: string;
    durationMinutes: number | null;
  }) => boolean;
  skipPlan: (input: { taskId: string; date: string }) => boolean;
  restorePlan: (input: { taskId: string; date: string }) => boolean;
  setDailyMemo: (input: { taskId: string; date: string; text: string }) => void;
  startTimer: (input: { taskId: string; today: Date }) => Promise<TimerMutationResult>;
  pauseTimer: (input: { taskId: string; today: Date }) => Promise<TimerMutationResult>;
  resumeTimer: (input: { taskId: string; today: Date }) => Promise<TimerMutationResult>;
  finishTimer: (input: { taskId: string; today: Date }) => Promise<TimerMutationResult>;
  checkTargetReached: () => Promise<TargetReachedTask[]>;
}

function uid(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function sameTargetReached(
  left: TargetReachedTask[],
  right: TargetReachedTask[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((target, index) => {
    const other = right[index];
    return (
      target.sessionId === other?.sessionId &&
      target.taskId === other.taskId &&
      target.actualMinutes === other.actualMinutes &&
      target.plannedMinutes === other.plannedMinutes
    );
  });
}

function hasOpenTimeEntry(timeEntries: TimeEntry[], taskId: string): boolean {
  return timeEntries.some(
    (timeEntry) => timeEntry.taskId === taskId && timeEntry.endedAt == null,
  );
}

function hasPlanHistory(
  state: Pick<FrilDayState, 'timeEntries' | 'completions'>,
  planId: string,
  taskId: string,
  date: string,
): boolean {
  return (
    state.timeEntries.some((entry) => entry.planId === planId) ||
    state.completions.some(
      (completion) =>
        completion.taskId === taskId &&
        (completion.planId === planId ||
          (completion.planId == null &&
            completion.date === date &&
            routinePlanId(taskId, date) === planId)),
    )
  );
}

type TimerMutationResult = {
  ok: boolean;
  changed: boolean;
};

function persist(
  operation: AsyncOperation,
  failureMessage: string,
): void {
  void enqueuePersistence(operation).catch((error) => {
    console.error(failureMessage, error);
    useFrilDayStore.setState({
      errorMsg: `${failureMessage} ${formatError(error)}`,
    });
  });
}

async function persistTimerEntries(
  entries: TimeEntry[],
  failureMessage: string,
): Promise<boolean> {
  try {
    await enqueuePersistence(() => saveTimeEntries(entries));
    return true;
  } catch (error) {
    console.error(failureMessage, error);
    useFrilDayStore.setState({
      errorMsg: `${failureMessage} ${formatError(error)}`,
    });
    return false;
  }
}

const enqueuePersistence = createSerialQueue();
const enqueueCompletionToggle = createSerialQueue();
// Serialize starts and stops so two quick actions cannot observe the same
// stale session list and create competing active sessions.
const enqueueTimerMutation = createSerialQueue<TimerMutationResult>();

export const useFrilDayStore = create<FrilDayState>((set, get) => ({
  hydrated: false,
  tasks: [],
  completions: [],
  plans: [],
  timeEntries: [],
  taskDailyMemos: [],
  targetReached: [],
  filter: 'all',
  errorMsg: '',

  hydrate: async () => {
    try {
      const data = await loadAppData();
      set({
        ...data,
        hydrated: true,
        errorMsg: '',
      });
    } catch (error) {
      console.error('Failed to hydrate app data', error);
      set({
        hydrated: true,
        errorMsg: `Failed to load app data. ${formatError(error)}`,
      });
    }
  },

  setFilter: (filter) => set({ filter }),
  clearError: () => set({ errorMsg: '' }),

  setPlanDurationOverride: ({ taskId, date, durationMinutes }) => {
    const task = get().tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      set({ errorMsg: 'Task not found.' });
      return false;
    }
    if (
      durationMinutes != null &&
      (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720)
    ) {
      set({ errorMsg: 'Planned duration must be a whole number from 1 to 720 minutes.' });
      return false;
    }

    const id = routinePlanId(taskId, date);
    const current = get().plans.find((plan) => plan.id === id);
    const hasHistory = hasPlanHistory(get(), id, taskId, date);
    if (hasHistory) {
      set({ errorMsg: 'Historical plans cannot be changed.' });
      return false;
    }
    if (durationMinutes == null && current) {
      set({ plans: get().plans.filter((plan) => plan.id !== id), errorMsg: '' });
      persist(() => deletePlan(id), 'Failed to restore plan.');
      return true;
    }
    if (durationMinutes == null) return true;
    const nextPlan = createRoutinePlan({
      routineId: taskId,
      date,
      baselineDurationMinutes: current?.baselineDurationMinutes ?? task.durationMinutes,
      durationOverrideMinutes: durationMinutes,
      status: current?.status === 'skipped' ? 'planned' : current?.status,
      movedToYmd: current?.movedToYmd,
    });
    const nextPlans = [
      nextPlan,
      ...get().plans.filter((plan) => plan.id !== nextPlan.id),
    ];
    set({ plans: nextPlans, errorMsg: '' });
    persist(() => savePlan(nextPlan), 'Failed to update plan.');
    return true;
  },

  skipPlan: ({ taskId, date }) => {
    const task = get().tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      set({ errorMsg: 'Task not found.' });
      return false;
    }
    const id = routinePlanId(taskId, date);
    const current = get().plans.find((plan) => plan.id === id);
    if (hasPlanHistory(get(), id, taskId, date)) {
      set({ errorMsg: 'Historical plans cannot be changed.' });
      return false;
    }
    const nextPlan = createRoutinePlan({
      routineId: taskId,
      date,
      baselineDurationMinutes: current?.baselineDurationMinutes ?? task.durationMinutes,
      durationOverrideMinutes: current?.durationOverrideMinutes,
      status: 'skipped',
      movedToYmd: null,
    });
    set({
      plans: [nextPlan, ...get().plans.filter((plan) => plan.id !== nextPlan.id)],
      errorMsg: '',
    });
    persist(() => savePlan(nextPlan), 'Failed to skip plan.');
    return true;
  },

  restorePlan: ({ taskId, date }) => {
    const id = routinePlanId(taskId, date);
    const current = get().plans.find((plan) => plan.id === id);
    if (!current) return true;

    const hasHistory = hasPlanHistory(get(), id, taskId, date);
    if (hasHistory) {
      set({ errorMsg: 'Historical plans cannot be changed.' });
      return false;
    }

    set({ plans: get().plans.filter((plan) => plan.id !== id), errorMsg: '' });
    persist(() => deletePlan(id), 'Failed to restore plan.');
    return true;
  },

  createTask: ({
    title,
    description,
    category,
    durationMinutes,
    startYmd,
    completionLimit,
    occurrenceLimit,
    customDays,
  }) => {
    try {
      const task = createTaskEntity({
        id: uid(),
        title,
        description,
        category,
        customDays,
        durationMinutes,
        startYmd,
        completionLimit,
        occurrenceLimit,
        nowIso: new Date().toISOString(),
      });

      const nextTasks = [task, ...get().tasks];

      set({ tasks: nextTasks, errorMsg: '' });
      persist(() => saveTask(task), 'Failed to save task.');
      return true;
    } catch (e) {
      set({
        errorMsg: e instanceof Error ? e.message : 'Failed to create task.',
      });
      return false;
    }
  },

  updateTaskMeta: ({
    taskId,
    title,
    description,
    category,
    durationMinutes,
    startYmd,
    completionLimit,
    occurrenceLimit,
    customDays,
  }) => {
    const targetTask = get().tasks.find((task) => task.id === taskId);
    if (!targetTask) {
      set({ errorMsg: 'Task not found.' });
      return false;
    }

    try {
      const nextTask = updateTaskEntity(targetTask, {
        title,
        description,
        category,
        customDays,
        durationMinutes,
        startYmd,
        completionLimit,
        occurrenceLimit,
      });
      const nextTasks = get().tasks.map((task) =>
        task.id === taskId ? nextTask : task,
      );

      set({ tasks: nextTasks, errorMsg: '' });
      persist(() => saveTask(nextTask), 'Failed to update task.');
      return true;
    } catch (error) {
      set({
        errorMsg: error instanceof Error ? error.message : 'Failed to update task.',
      });
      return false;
    }
  },

  archiveTask: (taskId) => {
    if (hasOpenTimeEntry(get().timeEntries, taskId)) {
      set({ errorMsg: 'Pause or finish the timer before archiving this task.' });
      return;
    }

    const nextTasks = get().tasks.map((t) =>
      t.id === taskId ? { ...t, isActive: false } : t,
    );

    set({ tasks: nextTasks, errorMsg: '' });
    persist(
      () => setTaskActive(taskId, false),
      'Failed to archive task.',
    );
  },

  restoreTask: (taskId) => {
    const nextTasks = get().tasks.map((t) =>
      t.id === taskId ? { ...t, isActive: true } : t,
    );

    set({ tasks: nextTasks, errorMsg: '' });
    persist(
      () => setTaskActive(taskId, true),
      'Failed to restore task.',
    );
  },

  toggleToday: ({ taskId, today }) =>
    enqueueCompletionToggle(async () => {
      const date = toYmd(today);

      try {
        const result = await toggleCompletionWithCore({
          tasks: get().tasks,
          completions: get().completions,
          plans: get().plans,
          taskId,
          date,
        });
        const completed = result.completions.some(
          (completion) => completion.taskId === taskId && completion.date === date,
        );
        const completion = result.completions.find(
          (candidate) => candidate.taskId === taskId && candidate.date === date,
        );
        const planId = completion?.planId ?? routinePlanId(taskId, date);
        const currentPlan = get().plans.find((plan) => plan.id === planId);
        const materializedPlan =
          completed && !currentPlan
            ? createRoutinePlan({
                routineId: taskId,
                date,
                baselineDurationMinutes:
                  get().tasks.find((task) => task.id === taskId)?.durationMinutes ?? 1,
                durationOverrideMinutes: null,
                status: 'planned',
                movedToYmd: null,
              })
            : null;
        const nextPlans = materializedPlan
          ? [materializedPlan, ...get().plans]
          : get().plans;
        const toggledTask = get().tasks.find((task) => task.id === taskId);
        const taskHasOpenSession = hasOpenTimeEntry(get().timeEntries, taskId);
        const autoArchived = result.autoArchived && !taskHasOpenSession;
        const nextTasks =
          autoArchived && toggledTask
            ? get().tasks.map((task) =>
                task.id === taskId ? { ...task, isActive: false } : task,
              )
            : get().tasks;

        if (autoArchived && toggledTask) {
          getNotifier().notify({
            level: 'info',
            message: `Auto-archived: ${toggledTask.title}`,
          });
        }

        const next = {
          tasks: nextTasks,
          completions: result.completions,
          plans: nextPlans,
          timeEntries: get().timeEntries,
          taskDailyMemos: get().taskDailyMemos,
        };

        set({ ...next, errorMsg: '' });
        persist(
          () =>
            Promise.all([
              setCompletion(
                taskId,
                date,
                completed,
                completed ? planId : null,
              ),
              ...(materializedPlan ? [savePlan(materializedPlan)] : []),
              ...(autoArchived
                ? [setTaskActive(taskId, false)]
                : []),
            ]).then(() => undefined),
          'Failed to update completion.',
        );
      } catch (error) {
        set({ errorMsg: `Failed to update completion. ${formatError(error)}` });
      }
    }),

  setDailyMemo: ({ taskId, date, text }) => {
    const updatedAt = new Date().toISOString();
    const nextMemos = upsertDailyMemo(get().taskDailyMemos, {
      taskId,
      date,
      text,
      updatedAt,
    });

    const memo = {
      id: `${taskId}_${date}`,
      taskId,
      date,
      text: text.trim(),
      updatedAt,
    };

    set({ taskDailyMemos: nextMemos, errorMsg: '' });
    persist(() => saveTaskDailyMemo(memo), 'Failed to save memo.');
  },

  startTimer: ({ taskId, today }) =>
    enqueueTimerMutation(async () => {
      const date = toYmd(today);
      const nowIso = new Date().toISOString();

      const entries = get().timeEntries;
      const openEntry = entries.find((entry) => entry.endedAt == null);
      if (openEntry?.taskId === taskId && openEntry.activeStartedAt != null) {
        return { ok: true, changed: false };
      }
      const resuming = openEntry?.taskId === taskId && openEntry.pausedAt != null;

      try {
        const task = get().tasks.find((candidate) => candidate.id === taskId);
        if (!task) throw new Error('Task not found.');
        const sourcePlanId = routinePlanId(taskId, date);
        const sourcePlan = get().plans.find((plan) => plan.id === sourcePlanId);
        if (
          sourcePlan?.status === 'moved' &&
          sourcePlan.movedToYmd !== date
        ) {
          throw new Error('Moved plans cannot be started on their source date.');
        }
        const movedPlan = get().plans.find(
          (plan) =>
            plan.routineId === taskId &&
            plan.status === 'moved' &&
            plan.movedToYmd === date,
        );
        const existingPlan = movedPlan ?? sourcePlan;
        const executionPlan =
          existingPlan ??
          createRoutinePlan({
            routineId: taskId,
            date,
            baselineDurationMinutes: task.durationMinutes,
          });
        if (executionPlan.status === 'skipped') {
          throw new Error('Skipped plans cannot be started.');
        }
        if (!existingPlan) {
          await enqueuePersistence(() => savePlan(executionPlan));
          set({ plans: [executionPlan, ...get().plans] });
        }
        const nextTimeEntries = resuming
          ? await resumeTimerWithCore({
              timeEntries: entries,
              taskId,
              dateYmd: date,
              resumedAt: nowIso,
            })
          : await startTimerWithCore({
              timeEntries: entries,
              sessionId: uid(),
              taskId,
              planId: executionPlan.id,
              dateYmd: date,
              startedAt: nowIso,
            });
        if (
          !(await persistTimerEntries(nextTimeEntries, 'Failed to start timer.'))
        ) {
          return { ok: false, changed: false };
        }
        set({ timeEntries: nextTimeEntries, targetReached: [], errorMsg: '' });
        return { ok: true, changed: true };
      } catch (error) {
        set({ errorMsg: `Failed to start timer. ${formatError(error)}` });
        return { ok: false, changed: false };
      }
    }),

  pauseTimer: ({ taskId, today }) =>
    enqueueTimerMutation(async () => {
      const date = toYmd(today);
      const nowIso = new Date().toISOString();
      const hasRunningEntry = get().timeEntries.some(
        (entry) =>
          entry.taskId === taskId &&
          entry.endedAt == null &&
          (entry.activeStartedAt != null || entry.pausedAt == null),
      );
      if (!hasRunningEntry) {
        return { ok: false, changed: false };
      }

      try {
        const nextTimeEntries = await pauseTimerWithCore({
          timeEntries: get().timeEntries,
          taskId,
          dateYmd: date,
          pausedAt: nowIso,
        });
        if (
          !(await persistTimerEntries(nextTimeEntries, 'Failed to pause timer.'))
        ) {
          return { ok: false, changed: false };
        }
        set({ timeEntries: nextTimeEntries, targetReached: [], errorMsg: '' });
        return { ok: true, changed: true };
      } catch (error) {
        set({ errorMsg: `Failed to pause timer. ${formatError(error)}` });
        return { ok: false, changed: false };
      }
    }),

  resumeTimer: ({ taskId, today }) =>
    enqueueTimerMutation(async () => {
      const date = toYmd(today);
      const nowIso = new Date().toISOString();
      const hasPausedEntry = get().timeEntries.some(
        (entry) =>
          entry.taskId === taskId &&
          entry.endedAt == null &&
          entry.pausedAt != null,
      );
      if (!hasPausedEntry) {
        return { ok: false, changed: false };
      }

      try {
        const nextTimeEntries = await resumeTimerWithCore({
          timeEntries: get().timeEntries,
          taskId,
          dateYmd: date,
          resumedAt: nowIso,
        });
        if (
          !(await persistTimerEntries(nextTimeEntries, 'Failed to resume timer.'))
        ) {
          return { ok: false, changed: false };
        }
        set({ timeEntries: nextTimeEntries, targetReached: [], errorMsg: '' });
        return { ok: true, changed: true };
      } catch (error) {
        set({ errorMsg: `Failed to resume timer. ${formatError(error)}` });
        return { ok: false, changed: false };
      }
    }),

  finishTimer: ({ taskId, today }) =>
    enqueueTimerMutation(async () => {
      const date = toYmd(today);
      const nowIso = new Date().toISOString();
      const hasOpenEntry = get().timeEntries.some(
        (entry) => entry.taskId === taskId && entry.endedAt == null,
      );
      if (!hasOpenEntry) {
        return { ok: false, changed: false };
      }

      try {
        const nextTimeEntries = await stopTimerWithCore({
          timeEntries: get().timeEntries,
          taskId,
          dateYmd: date,
          endedAt: nowIso,
        });
        if (
          !(await persistTimerEntries(nextTimeEntries, 'Failed to finish timer.'))
        ) {
          return { ok: false, changed: false };
        }
        set({ timeEntries: nextTimeEntries, targetReached: [], errorMsg: '' });
        return { ok: true, changed: true };
      } catch (error) {
        set({ errorMsg: `Failed to finish timer. ${formatError(error)}` });
        return { ok: false, changed: false };
      }
    }),

  checkTargetReached: async () => {
    if (!get().hydrated) return [];

    const nowIso = new Date().toISOString();
    let result: Awaited<ReturnType<typeof getTargetReachedWithCore>>;
    try {
      result = await getTargetReachedWithCore({
        timeEntries: get().timeEntries,
        tasks: get().tasks,
        plans: get().plans,
        nowIso,
      });
    } catch (error) {
      set({ errorMsg: `Failed to check timer target. ${formatError(error)}` });
      return [];
    }

    set((state) => {
      if (
        state.errorMsg === '' &&
        sameTargetReached(state.targetReached, result.tasks)
      ) {
        return state;
      }
      return { targetReached: result.tasks, errorMsg: '' };
    });
    return result.tasks;
  },
}));
