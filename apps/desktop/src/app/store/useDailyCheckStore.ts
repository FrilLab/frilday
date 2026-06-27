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

export type Filter = 'all' | Category;

type PersistedCollections = Pick<
  DailyCheckState,
  'tasks' | 'completions' | 'timeEntries' | 'taskDailyMemos'
>;

interface DailyCheckState {
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
  autoStopIfReached: (input: { today: Date }) => string[];
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
    useDailyCheckStore.setState({
      errorMsg: `${failureMessage} ${formatError(error)}`,
    });
  });
}

export const useDailyCheckStore = create<DailyCheckState>((set, get) => ({
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

    let nextTimeEntries = get().timeEntries;
    let nextTasks = get().tasks;

    if (wasDone) {
      nextTimeEntries = nextTimeEntries.filter(
        (e) => !(e.taskId === taskId && e.date === date),
      );
    } else {
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
      timeEntries: nextTimeEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({
      tasks: nextTasks,
      completions: nextCompletions,
      timeEntries: nextTimeEntries,
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
      (e) => e.taskId === taskId && e.date === date && e.endedAt == null,
    );
    if (alreadyRunningSameTask) {
      set({ errorMsg: 'Timer is already running for this task today.' });
      return;
    }

    const nextTimeEntries = entries.map((e) => {
      if (e.date !== date) return e;
      if (e.endedAt != null) return e;

      const minutes = diffMinutes(e.startedAt, nowIso);
      return { ...e, endedAt: nowIso, minutes };
    });

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
      (e) => e.taskId === taskId && e.date === date && e.endedAt == null,
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

  autoStopIfReached: ({ today }) => {
    if (!get().hydrated) return [];

    const date = toYmd(today);
    const nowIso = new Date().toISOString();

    const entries = get().timeEntries;
    const tasks = get().tasks;

    const nextEntries = [...entries];
    const nextCompletions = [...get().completions];
    const finishedTaskTitles: string[] = [];
    let changed = false;

    for (let i = 0; i < nextEntries.length; i += 1) {
      const e = nextEntries[i];

      if (e.date !== date) continue;
      if (e.endedAt != null) continue;

      const task = tasks.find((t) => t.id === e.taskId);
      if (!task) continue;

      const doneMinutes = nextEntries
        .filter(
          (x) =>
            x.taskId === e.taskId &&
            x.date === date &&
            x.endedAt != null &&
            Number.isFinite(x.minutes),
        )
        .reduce((acc, x) => acc + (x.minutes || 0), 0);

      const runningMinutes = diffMinutes(e.startedAt, nowIso);
      const total = doneMinutes + runningMinutes;

      if (total >= task.durationMinutes) {
        nextEntries[i] = { ...e, endedAt: nowIso, minutes: runningMinutes };
        finishedTaskTitles.push(task.title);
        changed = true;

        const notifier = getNotifier();
        notifier.notify({
          level: 'info',
          message: `Auto-stopped: ${task.title} (+${runningMinutes}m)`,
        });

        const alreadyDone = nextCompletions.some(
          (c) => c.taskId === e.taskId && c.date === date,
        );

        if (!alreadyDone) {
          nextCompletions.push({ taskId: e.taskId, date });

          notifier.notify({
            level: 'success',
            message: `Auto-completed: ${task.title}`,
          });
        }
      }
    }

    if (!changed) return [];

    const next = {
      tasks: get().tasks,
      completions: nextCompletions,
      timeEntries: nextEntries,
      taskDailyMemos: get().taskDailyMemos,
    };

    set({
      timeEntries: nextEntries,
      completions: nextCompletions,
      errorMsg: '',
    });
    persistCollections(next, 'Failed to auto-stop timer.');

    return finishedTaskTitles;
  },
}));
