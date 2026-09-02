import { useContext } from 'react';
import clsx from 'clsx';
import { TaskList } from '../../features/task/components/TaskList';
import type {
  Task,
  Completion,
  DayOfWeek,
  TaskDayState,
  TimeEntry,
} from '../../shared/types';
import type {
  CoreStatistics,
  CoreTimeTotals,
} from '../../infrastructure/tauri/core';
import { LocaleContext } from '../../i18n/context';
import { ActiveTimer } from '../../features/timer/components/ActiveTimer';
import type { ActiveTimerPhase } from '../../features/timer/activeTimerModel';

// (role: clamp helper, type: (number, number, number)=>number)
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function ProgressBar(props: {
  value: number; // (role: progress percent, type: number)
}) {
  const pct = clamp(Number.isFinite(props.value) ? props.value : 0, 0, 100);

  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className="h-full rounded-full bg-emerald-400/60"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatMinutes(
  m: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const mm = Math.max(0, Math.floor(m || 0));
  const h = Math.floor(mm / 60);
  const r = mm % 60;
  if (h <= 0) return `${r}${t('time.minuteShort')}`;
  return `${h}${t('time.hourShort')} ${r}${t('time.minuteShort')}`;
}

export function TodayPage(props: {
  todayYmd: string; // (role: YYYY-MM-DD, type: string)
  todayDow: DayOfWeek; // (role: day-of-week, type: DayOfWeek)

  todayTasks: Task[]; // (role: tasks scheduled today, type: Task[])

  todayStats: CoreStatistics['today']; // (role: core-derived today stats, type: CoreStatistics['today'])
  todayTimeTotals: CoreTimeTotals;
  taskDayStates: ReadonlyMap<string, TaskDayState>;

  completions: Completion[]; // (role: completions, type: Completion[])
  timeEntries: TimeEntry[]; // (role: time tracking logs, type: TimeEntry[])

  nowIso: string; // (role: ui clock iso, type: string)
  runningTaskId: string | null; // (role: single running task id, type: string | null)
  openTimerTaskId: string | null; // (role: running or paused task id, type: string | null)
  activeTimerTask: Task | null; // (role: selected execution task, type: Task | null)
  activeTimerPhase: ActiveTimerPhase; // (role: execution phase, type: ActiveTimerPhase)

  getMemoText: (taskId: string, date: string) => string;
  onSaveMemo: (input: { taskId: string; date: string; text: string }) => void;

  onToggleToday: (task: Task) => void; // (role: toggle completion, type: (Task)=>void)
  onArchive: (taskId: string) => void; // (role: archive task, type: (string)=>void)
  onStartTimer: (task: Task) => void; // (role: start timer, type: (Task)=>void)
  onStopTimer: (task: Task) => void; // (role: stop timer, type: (Task)=>void)
  onPauseTimer: (task: Task) => void; // (role: pause timer, type: (Task)=>void)
  onResumeTimer: (task: Task) => void; // (role: resume timer, type: (Task)=>void)
  onFinishTimer: (task: Task) => void; // (role: finish timer, type: (Task)=>void)
  onBackToPlan: () => void; // (role: leave finished timer, type: ()=>void)
  onError: (msg: string) => void; // (role: error handler, type: (string)=>void)
}) {
  const { t } = useContext(LocaleContext);

  const {
    todayYmd,
    todayDow,
    todayTasks,
    todayStats,
    todayTimeTotals,
    taskDayStates,

    completions,
    timeEntries,
    nowIso,
    runningTaskId,
    openTimerTaskId,
    activeTimerTask,
    activeTimerPhase,
    getMemoText,
    onSaveMemo,
    onToggleToday,
    onArchive,
    onStartTimer,
    onStopTimer,
    onPauseTimer,
    onResumeTimer,
    onFinishTimer,
    onBackToPlan,
    onError,
  } = props;

  const plannedMinutesToday = todayTimeTotals.plannedMinutes;
  const spentMinutesToday = todayTimeTotals.actualMinutes;

  const timeProgressPct =
    plannedMinutesToday <= 0
      ? 0
      : clamp((spentMinutesToday / plannedMinutesToday) * 100, 0, 100);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="rounded-3xl border border-zinc-800 bg-zinc-900/40 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
              {t('common.today')}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              {todayYmd}{' '}
              <span className="text-zinc-500">({todayDow})</span>
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              {activeTimerTask
                ? t('today.activeExecutionHint')
                : t('today.executionHint')}
            </p>
          </div>

          <div className="rounded-full border border-zinc-700 bg-zinc-950/50 px-3 py-1.5 text-sm text-zinc-300">
            {todayStats.completedCount}/{todayStats.scheduledCount}{' '}
            {t('stats.done')}
          </div>
        </div>
      </header>

      {activeTimerTask && (
        <ActiveTimer
          task={activeTimerTask}
          timeEntries={timeEntries}
          dateYmd={todayYmd}
          nowIso={nowIso}
          phase={activeTimerPhase}
          onStart={() => onStartTimer(activeTimerTask)}
          onPause={() => onPauseTimer(activeTimerTask)}
          onResume={() => onResumeTimer(activeTimerTask)}
          onFinish={() => onFinishTimer(activeTimerTask)}
          onBackToPlan={onBackToPlan}
        />
      )}

      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {t('common.time')}
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-2xl font-semibold text-zinc-50 sm:text-3xl">
                {formatMinutes(spentMinutesToday, t)}
              </span>
              <span className="text-sm text-zinc-500">
                / {formatMinutes(plannedMinutesToday, t)}
              </span>
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs text-zinc-500">{t('time.plannedVsActual')}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-200">
              {timeProgressPct.toFixed(0)}%
            </p>
          </div>
        </div>

        <ProgressBar value={timeProgressPct} />

        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
          <span>{t('time.trackedToday')}</span>
          <span>
            {todayStats.completedCount}/{todayStats.scheduledCount}{' '}
            {t('stats.done')}
          </span>
        </div>
      </section>

      <section
        className={clsx(
          'rounded-3xl border border-zinc-800 bg-zinc-900/40 px-5 py-5 transition-opacity sm:px-7',
          activeTimerTask && 'opacity-90',
        )}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100 sm:text-lg">
              {t('task.todayTasks')}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {activeTimerTask
                ? t('task.todayTasksDuringExecution')
                : t('task.todayTasksDescription')}
            </p>
          </div>
          <span className="text-xs text-zinc-500">
            {todayTasks.length} {t('task.plansToday')}
          </span>
        </div>

        <TaskList
          variant="today"
          tasks={todayTasks}
          completions={completions}
          timeEntries={timeEntries}
          todayYmd={todayYmd}
          todayDow={todayDow}
          nowIso={nowIso}
          runningTaskId={runningTaskId}
          openTimerTaskId={openTimerTaskId}
          getMemoText={getMemoText}
          onSaveMemo={onSaveMemo}
          onToggleToday={onToggleToday}
          onArchive={onArchive}
          onStartTimer={onStartTimer}
          onStopTimer={onStopTimer}
          onError={onError}
          taskDayStates={taskDayStates}
          isExecutionFocused={Boolean(activeTimerTask)}
          emptyMessage={t('task.noTasksScheduledToday')}
        />
      </section>
    </div>
  );
}
