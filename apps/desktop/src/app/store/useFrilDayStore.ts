import { create } from 'zustand';
import type {
  Category,
  Completion,
  DayOfWeek,
  Task,
  TaskDailyMemo,
  TimeEntry,
} from '../../shared/types';
import { loadAppData, replaceAllAppData } from '../../infrastructure/storage';
import { toYmd } from '../../shared/utils/date';
import { createSerialQueue } from '../../shared/utils/serialQueue';
import { createTaskEntity } from '../../domain/task/taskFactory';
import { getNotifier } from '../di/notifierDI';
import { upsertDailyMemo } from '../../domain/memo';
import {
  getTargetReachedWithCore,
  startTimerWithCore,
  stopTimerWithCore,
  toggleCompletionWithCore,
} from '../../infrastructure/tauri/core';

export type Filter = 'all' | Category;

type PersistedCollections = Pick<
  FrilDayState,
  'tasks' | 'completions' | 'timeEntries' | 'taskDailyMemos'
>;

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
  startTimer: (input: { taskId: string; today: Date }) => Promise<void>;
  stopTimer: (input: { taskId: string; today: Date }) => Promise<void>;
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

function hasRunningTimeEntry(timeEntries: TimeEntry[], taskId: string): boolean {
  return timeEntries.some(
    (timeEntry) => timeEntry.taskId === taskId && timeEntry.endedAt == null,
  );
}

function persistCollections(
  next: PersistedCollections,
  failureMessage: string,
): void {
  void replaceAllAppData(next).catch((error) => {
    console.error(failureMessage, error);
    useFrilDayStore.setState({
      errorMsg: `${failureMessage} ${formatError(error)}`,
    });
  });
}

const enqueueCompletionToggle = createSerialQueue();

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
      const next = {
        tasks: nextTasks,
        completions: get().completions,
        timeEntries: get().timeEntries,
        taskDailyMemos: get().taskDailyMemos,
      };

      set({ tasks: nextTasks, errorMsg: '' });
      persistCollections(next, 'Failed to save task.');
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

    const next = {
      tasks: nextTasks,
      completions: get().completions,
      timeEntries: get().timeEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({ tasks: nextTasks, errorMsg: '' });
    persistCollections(next, 'Failed to update task.');
  },

  archiveTask: (taskId) => {
    if (hasRunningTimeEntry(get().timeEntries, taskId)) {
      set({ errorMsg: 'Pause or finish the timer before archiving this task.' });
      return;
    }

    const nextTasks = get().tasks.map((t) =>
      t.id === taskId ? { ...t, isActive: false } : t,
    );
    const next = {
      tasks: nextTasks,
      completions: get().completions,
      timeEntries: get().timeEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({ tasks: nextTasks, errorMsg: '' });
    persistCollections(next, 'Failed to archive task.');
  },

  restoreTask: (taskId) => {
    const nextTasks = get().tasks.map((t) =>
      t.id === taskId ? { ...t, isActive: true } : t,
    );
    const next = {
      tasks: nextTasks,
      completions: get().completions,
      timeEntries: get().timeEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({ tasks: nextTasks, errorMsg: '' });
    persistCollections(next, 'Failed to restore task.');
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

    const next = {
      tasks: nextTasks,
      completions: nextCompletions,
      timeEntries: nextTimeEntries,
      taskDailyMemos: nextMemos,
    };

    set({
      ...next,
      errorMsg: '',
    });
    persistCollections(next, 'Failed to delete task.');
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
        const taskIsRunning = hasRunningTimeEntry(get().timeEntries, taskId);
        const autoArchived = result.autoArchived && !taskIsRunning;
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
        persistCollections(next, 'Failed to update completion.');
      } catch (error) {
        set({ errorMsg: `Failed to update completion. ${formatError(error)}` });
      }
    }),

  setDailyMemo: ({ taskId, date, text }) => {
    const nextMemos = upsertDailyMemo(get().taskDailyMemos, {
      taskId,
      date,
      text,
      updatedAt: new Date().toISOString(),
    });

    const next = {
      tasks: get().tasks,
      completions: get().completions,
      timeEntries: get().timeEntries,
      taskDailyMemos: nextMemos,
    };

    set({ taskDailyMemos: nextMemos, errorMsg: '' });
    persistCollections(next, 'Failed to save memo.');
  },

  startTimer: async ({ taskId, today }) => {
    const date = toYmd(today);
    const nowIso = new Date().toISOString();

    const entries = get().timeEntries;
    try {
      const nextTimeEntries = await startTimerWithCore({
        timeEntries: entries,
        sessionId: uid(),
        taskId,
        dateYmd: date,
        startedAt: nowIso,
      });
      const next = {
        tasks: get().tasks,
        completions: get().completions,
        timeEntries: nextTimeEntries,
        taskDailyMemos: get().taskDailyMemos,
      };

      set({ timeEntries: nextTimeEntries, targetReached: [], errorMsg: '' });
      persistCollections(next, 'Failed to start timer.');
    } catch (error) {
      set({ errorMsg: `Failed to start timer. ${formatError(error)}` });
    }
  },

  stopTimer: async ({ taskId, today }) => {
    const date = toYmd(today);
    const nowIso = new Date().toISOString();
    try {
      const nextTimeEntries = await stopTimerWithCore({
        timeEntries: get().timeEntries,
        taskId,
        dateYmd: date,
        endedAt: nowIso,
      });
      const next = {
        tasks: get().tasks,
        completions: get().completions,
        timeEntries: nextTimeEntries,
        taskDailyMemos: get().taskDailyMemos,
      };

      set({ timeEntries: nextTimeEntries, targetReached: [], errorMsg: '' });
      persistCollections(next, 'Failed to stop timer.');
    } catch (error) {
      set({ errorMsg: `Failed to stop timer. ${formatError(error)}` });
    }
  },

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
      if (state.errorMsg === '' && sameTargetReached(state.targetReached, result.tasks)) {
        return state;
      }
      return { targetReached: result.tasks, errorMsg: '' };
    });
    return result.tasks;
  },
}));
