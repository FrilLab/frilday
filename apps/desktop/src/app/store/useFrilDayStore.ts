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
  saveAutoStopTransition,
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
  autoStopWithCore,
  startTimerWithCore,
  stopTimerWithCore,
  toggleCompletionWithCore,
} from '../../infrastructure/tauri/core';

export type Filter = 'all' | Category;

interface FrilDayState {
  hydrated: boolean;
  tasks: Task[];
  completions: Completion[];
  timeEntries: TimeEntry[];
  taskDailyMemos: TaskDailyMemo[];
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
  stopTimer: (input: { taskId: string; today: Date }) => Promise<TimerMutationResult>;
  autoStopIfReached: () => Promise<string[]>;
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
        const nextTasks =
          result.autoArchived && toggledTask
            ? get().tasks.map((task) =>
                task.id === taskId ? { ...task, isActive: false } : task,
              )
            : get().tasks;

        if (result.autoArchived && toggledTask) {
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
              ...(result.autoArchived
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
      const runningEntry = entries.find((entry) => entry.endedAt == null);
      if (runningEntry?.taskId === taskId) {
        return { ok: true, changed: false };
      }

      try {
        const nextTimeEntries = await startTimerWithCore({
          timeEntries: entries,
          sessionId: uid(),
          taskId,
          dateYmd: date,
          startedAt: nowIso,
        });
        set({ timeEntries: nextTimeEntries, errorMsg: '' });
        persist(
          () => saveTimeEntries(nextTimeEntries),
          'Failed to start timer.',
        );
        return { ok: true, changed: true };
      } catch (error) {
        set({ errorMsg: `Failed to start timer. ${formatError(error)}` });
        return { ok: false, changed: false };
      }
    }),

  stopTimer: ({ taskId, today }) =>
    enqueueTimerMutation(async () => {
      const date = toYmd(today);
      const nowIso = new Date().toISOString();
      const hasRunningEntry = get().timeEntries.some(
        (entry) => entry.taskId === taskId && entry.endedAt == null,
      );
      if (!hasRunningEntry) {
        return { ok: false, changed: false };
      }

      try {
        const nextTimeEntries = await stopTimerWithCore({
          timeEntries: get().timeEntries,
          taskId,
          dateYmd: date,
          endedAt: nowIso,
        });
        set({ timeEntries: nextTimeEntries, errorMsg: '' });
        persist(
          () => saveTimeEntries(nextTimeEntries),
          'Failed to stop timer.',
        );
        return { ok: true, changed: true };
      } catch (error) {
        set({ errorMsg: `Failed to stop timer. ${formatError(error)}` });
        return { ok: false, changed: false };
      }
    }),

  autoStopIfReached: async () => {
    if (!get().hydrated) return [];

    const nowIso = new Date().toISOString();
    let result;
    try {
      result = await autoStopWithCore({
        timeEntries: get().timeEntries,
        tasks: get().tasks,
        completions: get().completions,
        nowIso,
      });
    } catch (error) {
      set({ errorMsg: `Failed to auto-stop timer. ${formatError(error)}` });
      return [];
    }

    if (result.finishedTasks.length === 0) return [];

    const notifier = getNotifier();
    for (const finishedTask of result.finishedTasks) {
      notifier.notify({
        level: 'info',
        message: `Auto-stopped: ${finishedTask.title} (+${finishedTask.minutes}m)`,
      });

      if (finishedTask.autoCompleted) {
        notifier.notify({
          level: 'success',
          message: `Auto-completed: ${finishedTask.title}`,
        });
      }
    }

    const previousCompletions = get().completions;
    const addedCompletions = result.completions.filter(
      (completion) =>
        !previousCompletions.some(
          (previous) =>
            previous.taskId === completion.taskId &&
            previous.date === completion.date,
        ),
    );

    set({
      timeEntries: result.timeEntries,
      completions: result.completions,
      errorMsg: '',
    });
    persist(
      () => saveAutoStopTransition(result.timeEntries, addedCompletions),
      'Failed to auto-stop timer.',
    );

    return result.finishedTasks.map((finishedTask) => finishedTask.title);
  },
}));
