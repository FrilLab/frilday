import { useEffect, useMemo, useState } from 'react';
import { useDailyCheckStore } from '../store/useDailyCheckStore';
import { dayOfWeek, startOfWeekMonday, toYmd } from '../../shared/utils/date';
import { calcTodayStats, calcWeekStats } from '../../domain/stats/stats';
import { isDoneOn } from '../../domain/completion';
import type { Task } from '../../shared/types';
import type { Tab } from '../layout/HeaderTabs';
import type { CreateTaskInput } from '../../features/task/components/TaskForm';
import { getNotifier } from '../di/notifierDI';
import { getDailyMemoText } from '../../domain/memo';
import { isVisibleInWeek } from '../../domain/scheduleLimit';

export function useAppModel() {
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
    stopTimer,
  } = useDailyCheckStore();

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

  // Single running timer (today). Store enforces 1 running entry per day.
  // (role: single running task id for today, type: string | null)
  const runningTaskIdToday = useMemo(() => {
    const running = timeEntries.find(
      (e) => e.date === todayYmd && e.endedAt == null,
    );
    return running?.taskId ?? null;
  }, [timeEntries, todayYmd]);

  const weekStats = useMemo(
    () => calcWeekStats(tasks, completions, weekStartYmd),
    [tasks, completions, weekStartYmd],
  );

  const todayTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (!t.isActive) return false;

      const createdAtYmd = t.createdAt.slice(0, 10);
      const startYmd = t.startYmd?.trim() || null;
      const effectiveStartYmd =
        startYmd && startYmd > createdAtYmd ? startYmd : createdAtYmd;
      if (todayYmd < effectiveStartYmd) return false;

      const doneToday = completions.some(
        (c) => c.taskId === t.id && c.date === todayYmd,
      );
      // When done exists on this day, keep the row visible even if backlog is exhausted.
      if (doneToday) return true;

      if (!t.daysOfWeek.includes(todayDow)) return false;
      return isVisibleInWeek(t, todayYmd, weekStartYmd, completions);
    });
    return [...filtered].sort((a, b) => {
      const aDone = isDoneOn(completions, a.id, todayYmd);
      const bDone = isDoneOn(completions, b.id, todayYmd);
      if (aDone === bDone) return 0;
      return aDone ? 1 : -1;
    });
  }, [tasks, completions, todayDow, todayYmd, weekStartYmd]);

  const todayStats = useMemo(
    () => calcTodayStats(todayTasks, completions, todayYmd, todayDow),
    [todayTasks, completions, todayYmd, todayDow],
  );

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

  const setError = (msg: string) =>
    useDailyCheckStore.setState({ errorMsg: msg });

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
  const handleStartTimer = (task: Task) => {
    startTimer({ taskId: task.id, today: new Date() });

    notifier.notify({
      level: 'info',
      message: `Timer started`,
    });
  };

  const handleStopTimer = (task: Task) => {
    stopTimer({ taskId: task.id, today: new Date() });
    notifier.notify({
      level: 'info',
      message: `Timer stopped`,
    });
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
    runningTaskIdToday,

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
    weekStats,
    todayStats,
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
  };
}
