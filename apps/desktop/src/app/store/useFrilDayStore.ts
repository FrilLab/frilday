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
import { diffMinutes, toYmd } from '../../shared/utils/date';
import {
  shouldAutoArchive,
  toggleCompletion as toggleCompletionDomain,
} from '../../domain/completion';
import { createTaskEntity } from '../../domain/task/taskFactory';
import { getNotifier } from '../di/notifierDI';
import { upsertDailyMemo } from '../../domain/memo';
import {
  autoStopEntriesAtTarget,
  closeRunningEntries,
} from '../../domain/timeTracking/timer';

export type Filter = 'all' | Category;

type PersistedCollections = Pick<
  FrilDayState,
  'tasks' | 'completions' | 'timeEntries' | 'taskDailyMemos'
>;

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
  toggleToday: (input: { taskId: string; today: Date }) => void;
  setDailyMemo: (input: { taskId: string; date: string; text: string }) => void;
  startTimer: (input: { taskId: string; today: Date }) => void;
  stopTimer: (input: { taskId: string; today: Date }) => void;
  autoStopIfReached: () => string[];
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

  toggleToday: ({ taskId, today }) => {
    const date = toYmd(today);

    const prevCompletions = get().completions;
    const nextCompletions = toggleCompletionDomain(
      prevCompletions,
      taskId,
      date,
    );

    const wasDone = prevCompletions.some(
      (c) => c.taskId === taskId && c.date === date,
    );

    let nextTasks = get().tasks;

    if (!wasDone) {
      const toggledTask = nextTasks.find((t) => t.id === taskId);
      if (
        toggledTask &&
        toggledTask.isActive &&
        shouldAutoArchive(toggledTask, nextCompletions)
      ) {
        nextTasks = nextTasks.map((task) =>
          task.id === taskId ? { ...task, isActive: false } : task,
        );

        const notifier = getNotifier();
        notifier.notify({
          level: 'info',
          message: `Auto-archived: ${toggledTask.title}`,
        });
      }
    }

    const next = {
      tasks: nextTasks,
      completions: nextCompletions,
      timeEntries: get().timeEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({
      tasks: nextTasks,
      completions: nextCompletions,
      timeEntries: get().timeEntries,
      errorMsg: '',
    });
    persistCollections(next, 'Failed to update completion.');
  },

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

  startTimer: ({ taskId, today }) => {
    const date = toYmd(today);
    const nowIso = new Date().toISOString();

    const entries = get().timeEntries;
    const alreadyRunningSameTask = entries.some(
      (e) => e.taskId === taskId && e.endedAt == null,
    );
    if (alreadyRunningSameTask) {
      set({ errorMsg: 'Timer is already running for this task today.' });
      return;
    }

    const nextTimeEntries = closeRunningEntries(entries, nowIso);

    const entry: TimeEntry = {
      id: uid(),
      taskId,
      date,
      startedAt: nowIso,
      endedAt: null,
      minutes: 0,
    };

    const next = {
      tasks: get().tasks,
      completions: get().completions,
      timeEntries: [entry, ...nextTimeEntries],
      taskDailyMemos: get().taskDailyMemos,
    };

    set({ timeEntries: next.timeEntries, errorMsg: '' });
    persistCollections(next, 'Failed to start timer.');
  },

  stopTimer: ({ taskId, today }) => {
    const date = toYmd(today);

    const idx = get().timeEntries.findIndex(
      (e) => e.taskId === taskId && e.date <= date && e.endedAt == null,
    );
    if (idx === -1) {
      set({ errorMsg: 'No running timer for this task today.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const cur = get().timeEntries[idx];
    const minutes = diffMinutes(cur.startedAt, nowIso);

    const updated: TimeEntry = { ...cur, endedAt: nowIso, minutes };
    const nextTimeEntries = [...get().timeEntries];
    nextTimeEntries[idx] = updated;

    const next = {
      tasks: get().tasks,
      completions: get().completions,
      timeEntries: nextTimeEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({ timeEntries: nextTimeEntries, errorMsg: '' });
    persistCollections(next, 'Failed to stop timer.');
  },

  autoStopIfReached: () => {
    if (!get().hydrated) return [];

    const nowIso = new Date().toISOString();
    const result = autoStopEntriesAtTarget(
      get().timeEntries,
      get().tasks,
      get().completions,
      nowIso,
    );

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

    const next = {
      tasks: get().tasks,
      completions: result.completions,
      timeEntries: result.timeEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({
      timeEntries: result.timeEntries,
      completions: result.completions,
      errorMsg: '',
    });
    persistCollections(next, 'Failed to auto-stop timer.');

    return result.finishedTasks.map((finishedTask) => finishedTask.title);
  },
}));
