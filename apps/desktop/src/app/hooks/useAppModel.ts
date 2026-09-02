import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrilDayStore } from '../store/useFrilDayStore';
import { dayOfWeek, startOfWeekMonday, toYmd } from '../../shared/utils/date';
import type { Task, TaskDayState } from '../../shared/types';
import type { Tab } from '../layout/HeaderTabs';
import type { CreateTaskInput } from '../../features/task/components/TaskForm';
import type { ActiveTimerPhase } from '../../features/timer/activeTimerModel';
import { useLocale } from '../../i18n/useLocale';
import { getNotifier } from '../di/notifierDI';
import { getDailyMemoText } from '../../domain/memo';
import {
  getCoreStatistics,
  getCoreTimeTotals,
  getRunningTaskIdWithCore,
  getVisibleScheduleSlots,
  type CoreStatistics,
  type CoreTimeTotals,
} from '../../infrastructure/tauri/core';

const EMPTY_STATS: CoreStatistics = {
  week: {
    weekStart: '',
    totalRate: 0,
    weekdayRate: 0,
    weekendRate: 0,
    dailyRate: 0,
    customRate: 0,
  },
  weekRange: { scheduledCount: 0, completedCount: 0, rate: 0 },
  today: { scheduledCount: 0, completedCount: 0, rate: 0 },
  month: { scheduledCount: 0, completedCount: 0, rate: 0 },
  allTime: { scheduledCount: 0, completedCount: 0, rate: 0 },
  todayYmd: '',
  monthStartYmd: '',
  allStartYmd: '',
  weekEndYmd: '',
};

const EMPTY_TIME_TOTALS: CoreTimeTotals = {
  plannedMinutes: 0,
  actualMinutes: 0,
  byTask: [],
};

function monthStartYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function useAppModel() {
  const { t } = useLocale();
  const {
    hydrated,
    tasks,
    completions,
    timeEntries,
    taskDailyMemos,
    errorMsg,
    clearError,
    createTask,
    updateTaskMeta,
    archiveTask,
    restoreTask,
    deleteTask,
    toggleToday,
    setDailyMemo,
    startTimer,
    pauseTimer,
    resumeTimer,
    finishTimer,
  } = useFrilDayStore();

  const [tab, setTab] = useState<Tab>('today');

  // Toast
  const notifier = getNotifier();

  // Manage controls
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [manageQuery, setManageQuery] = useState<string>('');
  const [manageCategory, setManageCategory] = useState<
    'all' | Task['category']
  >('all');

  // UI clock tick (30s). Used to keep "Today: Xm" increasing without per-item intervals.
  // (role: ui clock iso, type: string)
  const [nowIso, setNowIso] = useState<string>(() => new Date().toISOString());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowIso(new Date().toISOString());
    }, 30000);

    return () => window.clearInterval(id);
  }, []);

  // Derive "today" from ui clock so day changes (midnight) are reflected.
  const today = useMemo(() => new Date(nowIso), [nowIso]);
  const todayYmd = toYmd(today);
  const todayDow = dayOfWeek(today);
  const weekStartYmd = toYmd(startOfWeekMonday(today));

  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [activeTimerTaskId, setActiveTimerTaskId] = useState<string | null>(
    null,
  );
  const [activeTimerPhase, setActiveTimerPhase] =
    useState<ActiveTimerPhase>('ready');
  const pendingTimerStarts = useRef(new Set<string>());
  const [scheduleSlots, setScheduleSlots] = useState<
    Awaited<ReturnType<typeof getVisibleScheduleSlots>>
  >([]);
  const [statistics, setStatistics] = useState<CoreStatistics>(EMPTY_STATS);
  const [timeTotals, setTimeTotals] =
    useState<CoreTimeTotals>(EMPTY_TIME_TOTALS);

  const openTimerEntry = useMemo(
    () => timeEntries.find((entry) => entry.endedAt == null) ?? null,
    [timeEntries],
  );
  const openTimerTaskId = openTimerEntry?.taskId ?? null;

  useEffect(() => {
    if (!hydrated) return;
    let current = true;
    void getVisibleScheduleSlots({
      tasks,
      completions,
      weekStartYmd,
      includeArchived: true,
    })
      .then((slots) => {
        if (current) setScheduleSlots(slots);
      })
      .catch((error: unknown) => {
        console.error('Failed to calculate schedule with frilday-core', error);
        if (current) setScheduleSlots([]);
      });

    return () => {
      current = false;
    };
  }, [hydrated, tasks, completions, weekStartYmd]);

  useEffect(() => {
    if (!hydrated) return;
    let current = true;
    void getRunningTaskIdWithCore(timeEntries)
      .then((taskId) => {
        if (current) setRunningTaskId(taskId);
      })
      .catch((error: unknown) => {
        console.error('Failed to read running session from frilday-core', error);
        if (current) setRunningTaskId(null);
      });

    return () => {
      current = false;
    };
  }, [hydrated, timeEntries]);

  useEffect(() => {
    if (!hydrated) return;
    let current = true;
    void getCoreStatistics({
      tasks,
      completions,
      weekStartYmd,
      todayYmd,
      monthStartYmd: monthStartYmd(todayYmd),
    })
      .then((result) => {
        if (current) setStatistics(result);
      })
      .catch((error: unknown) => {
        console.error('Failed to calculate statistics with frilday-core', error);
        if (current) setStatistics(EMPTY_STATS);
      });

    return () => {
      current = false;
    };
  }, [hydrated, tasks, completions, weekStartYmd, todayYmd]);

  const visibleToday = useMemo(() => {
    const state = new Map<
      string,
      { visible: boolean; scheduled: boolean; completed: boolean; completionCount: number }
    >();
    for (const slot of scheduleSlots) {
      state.set(slot.taskId, {
        visible: slot.dates.includes(todayYmd),
        scheduled: slot.scheduledDates.includes(todayYmd),
        completed: slot.completedDates.includes(todayYmd),
        completionCount: slot.completionCount,
      });
    }
    return state;
  }, [scheduleSlots, todayYmd]);

  const todayTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (!t.isActive) return false;

      const isOpenTimer = openTimerTaskId === t.id;
      // Keep a recovered running or paused timer visible after midnight so it
      // remains controllable from the following local day.
      if (isOpenTimer) return true;
      return visibleToday.get(t.id)?.visible ?? false;
    });
    return [...filtered].sort((a, b) => {
      const aDone = visibleToday.get(a.id)?.completed ?? false;
      const bDone = visibleToday.get(b.id)?.completed ?? false;
      if (aDone === bDone) return 0;
      return aDone ? 1 : -1;
    });
  }, [tasks, openTimerTaskId, visibleToday]);

  useEffect(() => {
    if (!hydrated) return;
    let current = true;
    void getCoreTimeTotals({
      tasks,
      timeEntries,
      dateYmd: todayYmd,
      nowIso,
      taskIds: todayTasks.map((task) => task.id),
    })
      .then((result) => {
        if (current) setTimeTotals(result);
      })
      .catch((error: unknown) => {
        console.error('Failed to calculate time totals with frilday-core', error);
        if (current) setTimeTotals(EMPTY_TIME_TOTALS);
      });

    return () => {
      current = false;
    };
  }, [hydrated, tasks, timeEntries, todayYmd, nowIso, todayTasks]);

  const taskDayStates = useMemo(() => {
    const actualMinutes = new Map(
      timeTotals.byTask.map((entry) => [entry.taskId, entry.actualMinutes]),
    );
    const states = new Map<string, TaskDayState>();
    for (const task of tasks) {
      const visible = visibleToday.get(task.id);
      states.set(task.id, {
        scheduled: visible?.scheduled ?? false,
        completed: visible?.completed ?? false,
        completionCount: visible?.completionCount ?? 0,
        actualMinutes: actualMinutes.get(task.id) ?? 0,
      });
    }
    return states;
  }, [tasks, timeTotals, visibleToday]);

  const manageTasks = useMemo(() => {
    const base = showArchived
      ? tasks.filter((t) => !t.isActive)
      : tasks.filter((t) => t.isActive);

    const byCategory =
      manageCategory === 'all'
        ? base
        : base.filter((t) => t.category === manageCategory);

    const q = manageQuery.trim().toLowerCase();
    if (!q) return byCategory;

    return byCategory.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [tasks, showArchived, manageCategory, manageQuery]);

  const activeTimerTask = useMemo(() => {
    if (openTimerTaskId != null) {
      const open = tasks.find((task) => task.id === openTimerTaskId);
      if (open) return open;
    }

    if (activeTimerTaskId != null) {
      const selected = tasks.find((task) => task.id === activeTimerTaskId);
      if (selected) return selected;
    }

    return null;
  }, [activeTimerTaskId, openTimerTaskId, tasks]);

  // Adopt a running or paused session restored from storage so it remains
  // visible and controllable instead of disappearing after app restart.
  useEffect(() => {
    if (openTimerTaskId == null) return;
    setActiveTimerTaskId(openTimerTaskId);
    setActiveTimerPhase(openTimerEntry?.pausedAt != null ? 'paused' : 'running');
  }, [openTimerEntry?.pausedAt, openTimerTaskId]);

  const activeTimerPhaseForView: ActiveTimerPhase =
    activeTimerTask == null
      ? 'ready'
      : runningTaskId === activeTimerTask.id
        ? 'running'
        : openTimerTaskId === activeTimerTask.id
          ? openTimerEntry?.pausedAt != null
            ? 'paused'
            : 'running'
        : activeTimerTaskId === activeTimerTask.id
          ? activeTimerPhase
          : 'ready';

  const setError = (msg: string) =>
    useFrilDayStore.setState({ errorMsg: msg });

  // Handlers
  const handleCreate = (input: CreateTaskInput) => {
    createTask(input);
    notifier.notify({
      level: 'success',
      message: `Task created: ${input.title}`,
    });
  };

  const handleUpdateTaskMeta = (input: {
    taskId: string;
    title: string;
    description: string;
    startYmd: string | null;
    autoArchiveAfter: number | null;
  }) => {
    updateTaskMeta(input);
    notifier.notify({
      level: 'success',
      message: 'Task updated',
    });
  };

  const handleSaveDailyMemo = (input: {
    taskId: string;
    date: string;
    text: string;
  }) => {
    setDailyMemo(input);
    notifier.notify({
      level: 'info',
      message: 'Memo saved',
    });
  };

  const getMemoText = (taskId: string, date: string): string =>
    getDailyMemoText(taskDailyMemos, taskId, date);

  const handleRestore = (taskId: string) => {
    restoreTask(taskId);
    setShowArchived(false);
    notifier.notify({
      level: 'success',
      message: `Task restored`,
    });
  };

  const handleDelete = (taskId: string) => {
    deleteTask(taskId);
    notifier.notify({
      level: 'success',
      message: `Task deleted permanently`,
    });
  };

  const handleResetManage = () => {
    setManageQuery('');
    setManageCategory('all');
    setShowArchived(false);
  };

  // 실시간을 위해 today(useMemo) 대신 현재 날짜 받기
  const startTimerForTask = async (task: Task, message: string) => {
    if (pendingTimerStarts.current.has(task.id)) return;

    const currentTask =
      openTimerTaskId != null
        ? tasks.find((candidate) => candidate.id === openTimerTaskId) ?? null
        : activeTimerPhase === 'running'
          ? activeTimerTask
          : null;

    if (currentTask && currentTask.id !== task.id) {
      if (openTimerEntry?.pausedAt != null) {
        setError(
          t('timer.pausedSwitchBlocked', { current: currentTask.title }),
        );
        return;
      }
      const shouldSwitch = window.confirm(
        t('timer.switchConfirm', {
          current: currentTask.title,
          next: task.title,
        }),
      );
      if (!shouldSwitch) return;
    }

    const previousTaskId = activeTimerTask?.id ?? openTimerTaskId ?? runningTaskId;
    const previousPhase = activeTimerPhaseForView;
    pendingTimerStarts.current.add(task.id);
    setActiveTimerTaskId(task.id);
    setActiveTimerPhase('running');
    try {
      const result = await startTimer({ taskId: task.id, today: new Date() });
      if (!result.ok) {
        setActiveTimerTaskId(previousTaskId ?? null);
        setActiveTimerPhase(previousTaskId == null ? 'ready' : previousPhase);
        return;
      }

      if (result.changed) {
        notifier.notify({
          level: 'info',
          message,
        });
      }
    } finally {
      pendingTimerStarts.current.delete(task.id);
    }
  };

  const handleStartTimer = (task: Task) => {
    void startTimerForTask(task, 'Timer started');
  };

  const handleStopTimer = async (task: Task) => {
    const previousTaskId = activeTimerTask?.id ?? openTimerTaskId ?? runningTaskId;
    const previousPhase = activeTimerPhaseForView;
    setActiveTimerTaskId(task.id);
    setActiveTimerPhase('paused');
    const result = await pauseTimer({ taskId: task.id, today: new Date() });
    if (!result.ok) {
      setActiveTimerTaskId(previousTaskId ?? null);
      setActiveTimerPhase(previousTaskId == null ? 'ready' : previousPhase);
      return;
    }

    if (result.changed) {
      notifier.notify({
        level: 'info',
        message: `Timer paused`,
      });
    }
  };

  const handleResumeTimer = async (task: Task) => {
    const previousTaskId = activeTimerTask?.id ?? openTimerTaskId ?? runningTaskId;
    const previousPhase = activeTimerPhaseForView;
    setActiveTimerTaskId(task.id);
    setActiveTimerPhase('running');
    const result = await resumeTimer({ taskId: task.id, today: new Date() });
    if (!result.ok) {
      setActiveTimerTaskId(previousTaskId ?? null);
      setActiveTimerPhase(previousTaskId == null ? 'ready' : previousPhase);
      return;
    }
    if (result.changed) {
      notifier.notify({
        level: 'info',
        message: `Timer resumed`,
      });
    }
  };

  const handleFinishTimer = async (task: Task) => {
    const hasOpenEntry = timeEntries.some(
      (entry) => entry.taskId === task.id && entry.endedAt == null,
    );
    if (runningTaskId === task.id || hasOpenEntry) {
      const result = await finishTimer({ taskId: task.id, today: new Date() });
      if (!result.ok) return;
    }

    setActiveTimerPhase('finished');
    notifier.notify({
      level: 'info',
      message: `Timer finished`,
    });
  };

  const handleBackToPlan = () => {
    setActiveTimerTaskId(null);
    setActiveTimerPhase('ready');
  };

  return {
    hydrated,
    // raw
    tasks,
    completions,
    timeEntries,
    taskDailyMemos,
    errorMsg,

    // time
    today,
    todayYmd,
    todayDow,
    nowIso,
    runningTaskId,
    openTimerTaskId,
    activeTimerTask,
    activeTimerPhase: activeTimerPhaseForView,

    // view state
    tab,
    setTab,

    // manage state
    showArchived,
    setShowArchived,
    manageQuery,
    setManageQuery,
    manageCategory,
    setManageCategory,

    // derived
    weekStats: statistics.week,
    todayStats: statistics.today,
    periodStats: statistics,
    todayTimeTotals: timeTotals,
    taskDayStates,
    todayTasks,
    manageTasks,

    // actions
    clearError,
    setError,
    handleCreate,
    handleUpdateTaskMeta,
    toggleToday,
    handleSaveDailyMemo,
    getMemoText,
    archiveTask,
    handleRestore,
    handleDelete,
    handleResetManage,

    // timer actions (UI용)
    handleStartTimer,
    handleStopTimer,
    handlePauseTimer: handleStopTimer,
    handleResumeTimer,
    handleFinishTimer,
    handleBackToPlan,
  };
}
