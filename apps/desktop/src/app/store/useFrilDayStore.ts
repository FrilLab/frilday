import { create } from 'zustand';
import type {
  Category,
  Completion,
  DayOfWeek,
  Task,
  TaskDailyMemo,
  TimeEntry,
} from '../../shared/types';
import {
  deleteTask as deletePersistedTask,
  loadAppData,
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
import { createTaskEntity } from '../../domain/task/taskFactory';
import { getNotifier } from '../di/notifierDI';
import { upsertDailyMemo } from '../../domain/memo';
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
    autoArchiveAfter?: number | null;
    customDays?: DayOfWeek[];
  }) => void;

  updateTaskMeta: (input: {
    taskId: string;
    title: string;
    description: string;
    startYmd?: string | null;
    autoArchiveAfter?: number | null;
  }) => void;

  archiveTask: (taskId: string) => void;
  restoreTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  toggleToday: (input: { taskId: string; today: Date }) => Promise<void>;
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

  createTask: ({
    title,
    description,
    category,
    durationMinutes,
    startYmd,
    autoArchiveAfter,
    customDays,
  }) => {
    const t = title.trim();
    if (!t) {
      set({ errorMsg: 'Title is required.' });
      return;
    }

    const createdAtYmd = toYmd(new Date());
    const normalizedStartYmd =
      startYmd == null || String(startYmd).trim() === ''
        ? null
        : String(startYmd).trim();
    if (normalizedStartYmd && normalizedStartYmd < createdAtYmd) {
      set({ errorMsg: 'Start date cannot be earlier than created date.' });
      return;
    }

    try {
      const task = createTaskEntity({
        id: uid(),
        title: t,
        description,
        category,
        customDays,
        durationMinutes,
        startYmd: normalizedStartYmd,
        autoArchiveAfter,
        nowIso: new Date().toISOString(),
      });

      const nextTasks = [task, ...get().tasks];

      set({ tasks: nextTasks, errorMsg: '' });
      persist(() => saveTask(task), 'Failed to save task.');
    } catch (e) {
      set({
        errorMsg: e instanceof Error ? e.message : 'Failed to create task.',
      });
    }
  },

  updateTaskMeta: ({
    taskId,
    title,
    description,
    startYmd,
    autoArchiveAfter,
  }) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      set({ errorMsg: 'Title is required.' });
      return;
    }

    const numericThreshold =
      autoArchiveAfter == null ? null : Number(autoArchiveAfter);
    const normalizedThreshold =
      numericThreshold == null ||
      !Number.isInteger(numericThreshold) ||
      numericThreshold < 1
        ? null
        : numericThreshold;

    const normalizedStartYmdRaw =
      startYmd == null ? null : String(startYmd).trim();
    const normalizedStartYmd =
      normalizedStartYmdRaw == null || normalizedStartYmdRaw === ''
        ? null
        : /^\d{4}-\d{2}-\d{2}$/.test(normalizedStartYmdRaw)
          ? normalizedStartYmdRaw
          : null;
    const targetTask = get().tasks.find((task) => task.id === taskId);
    if (!targetTask) {
      set({ errorMsg: 'Task not found.' });
      return;
    }

    const createdAtYmd = targetTask.createdAt.slice(0, 10);
    if (normalizedStartYmd && normalizedStartYmd < createdAtYmd) {
      set({ errorMsg: 'Start date cannot be earlier than created date.' });
      return;
    }

    const nextTasks = get().tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            title: normalizedTitle,
            description: description.trim(),
            startYmd: normalizedStartYmd,
            autoArchiveAfter: normalizedThreshold,
          }
        : task,
    );
    const nextTask = nextTasks.find((task) => task.id === taskId);

    set({ tasks: nextTasks, errorMsg: '' });
    if (nextTask) persist(() => saveTask(nextTask), 'Failed to update task.');
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

  deleteTask: (taskId) => {
    const nextTasks = get().tasks.filter((t) => t.id !== taskId);
    const nextCompletions = get().completions.filter(
      (c) => c.taskId !== taskId,
    );
    const nextTimeEntries = get().timeEntries.filter(
      (e) => e.taskId !== taskId,
    );
    const nextMemos = get().taskDailyMemos.filter((m) => m.taskId !== taskId);

    set({
      tasks: nextTasks,
      completions: nextCompletions,
      timeEntries: nextTimeEntries,
      taskDailyMemos: nextMemos,
      errorMsg: '',
    });
    persist(() => deletePersistedTask(taskId), 'Failed to delete task.');
  },

  toggleToday: ({ taskId, today }) =>
    enqueueCompletionToggle(async () => {
      const date = toYmd(today);

      try {
        const result = await toggleCompletionWithCore({
          tasks: get().tasks,
          completions: get().completions,
          taskId,
          date,
        });
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
                result.completions.some(
                  (completion) =>
                    completion.taskId === taskId && completion.date === date,
                ),
              ),
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
