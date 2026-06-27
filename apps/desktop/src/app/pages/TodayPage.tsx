import { useContext } from 'react';
import { TaskList } from '../../features/task/components/TaskList';
import { PeriodStatsPanel } from '../../features/statistics/components/PeriodStatsPanel';
import type {
  Task,
  Completion,
  DayOfWeek,
  TimeEntry,
} from '../../shared/types';
import type { TodayStats } from '../../domain/stats/stats';
import { diffMinutes } from '../../shared/utils/date';
import { LocaleContext } from '../../i18n/context';

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

  tasks: Task[]; // (role: all tasks, type: Task[])
  todayTasks: Task[]; // (role: tasks scheduled today, type: Task[])

  todayStats: TodayStats; // (role: today stats, type: TodayStats)

  completions: Completion[]; // (role: completions, type: Completion[])
  timeEntries: TimeEntry[]; // (role: time tracking logs, type: TimeEntry[])

  nowIso: string; // (role: ui clock iso, type: string)
  runningTaskIdToday: string | null; // (role: single running task id, type: string | null)

  getMemoText: (taskId: string, date: string) => string;
  onSaveMemo: (input: { taskId: string; date: string; text: string }) => void;

  onToggleToday: (task: Task) => void; // (role: toggle completion, type: (Task)=>void)
  onArchive: (taskId: string) => void; // (role: archive task, type: (string)=>void)
  onStartTimer: (task: Task) => void; // (role: start timer, type: (Task)=>void)
  onStopTimer: (task: Task) => void; // (role: stop timer, type: (Task)=>void)
  onError: (msg: string) => void; // (role: error handler, type: (string)=>void)
}) {
  const { t } = useContext(LocaleContext);

  const {
    todayYmd,
    todayDow,
    tasks,
    todayTasks,
    todayStats,

    completions,
    timeEntries,
    nowIso,
    runningTaskIdToday,
    getMemoText,
    onSaveMemo,
    onToggleToday,
    onArchive,
    onStartTimer,
    onStopTimer,
    onError,
  } = props;

  const plannedMinutesToday = todayTasks.reduce(
    (acc, t) => acc + Math.max(0, t.durationMinutes || 0),
    0,
  );

  const todayTaskIdSet = new Set(todayTasks.map((t) => t.id));

  const doneTaskIdSet = new Set(
    (completions ?? [])
      .filter((c) => c.date === todayYmd && todayTaskIdSet.has(c.taskId))
      .map((c) => c.taskId),
  );

  const measuredByTaskId = new Map<string, number>();

  (timeEntries ?? []).forEach((e) => {
    if (e.date !== todayYmd) return;
    if (!todayTaskIdSet.has(e.taskId)) return;

    const minutes =
      e.endedAt == null ? diffMinutes(e.startedAt, nowIso) : e.minutes || 0;

    measuredByTaskId.set(
      e.taskId,
      (measuredByTaskId.get(e.taskId) || 0) + minutes,
    );
  });

  const spentMinutesToday = todayTasks.reduce((acc, t) => {
    const planned = Math.max(0, t.durationMinutes || 0);
    if (doneTaskIdSet.has(t.id)) return acc + planned;
    return acc + (measuredByTaskId.get(t.id) || 0);
  }, 0);

  const timeProgressPct =
    plannedMinutesToday <= 0
      ? 0
      : clamp((spentMinutesToday / plannedMinutesToday) * 100, 0, 100);

  return (
    <div className="grid gap-3 md:gap-4 xl:grid-cols-[360px_1fr] xl:items-start">
      <aside className="min-w-0 xl:space-y-4 xl:sticky xl:top-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-zinc-100">
                  {t('common.today')}
                </h2>
                <p className="mt-1 hidden text-sm text-zinc-400 sm:block">
                  {todayYmd} <span className="text-zinc-500">({todayDow})</span>
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 hidden sm:block">
              <div className="text-xs font-medium text-zinc-400">
                {t('stats.scheduledToday')}
              </div>
              <div className="mt-2 text-2xl font-semibold text-zinc-100">
                {todayStats.scheduledCount}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 hidden sm:block">
              <div className="text-xs font-medium text-zinc-400">
                {t('stats.done')}
              </div>
              <div className="mt-2 text-2xl font-semibold text-zinc-100">
                {todayStats.doneCount}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs font-medium text-zinc-400">
                {t('common.completion')}
              </div>

              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-semibold text-zinc-100">
                    {todayStats.rate.toFixed(0)}%
                  </div>
                  <div className="text-xs text-zinc-500">
                    ({todayStats.doneCount}/{todayStats.scheduledCount})
                  </div>
                </div>
              </div>

              <ProgressBar value={todayStats.rate} />
            </div>
          </div>
        </section>

        <section className="hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 xl:block">
          <PeriodStatsPanel
            tasks={tasks}
            completions={completions}
            todayYmd={todayYmd}
          />
        </section>
      </aside>

      <main className="min-w-0 space-y-4">
        <section className="hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 md:block">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-400">
                {t('common.time')}
              </div>

              <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <div className="text-2xl font-semibold text-zinc-100">
                  {formatMinutes(spentMinutesToday, t)}
                </div>
                <div className="text-xs text-zinc-500">
                  / {formatMinutes(plannedMinutesToday, t)}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-sm font-semibold text-zinc-100">
              {timeProgressPct.toFixed(0)}%
            </div>
          </div>

          <ProgressBar value={timeProgressPct} />

          <div className="mt-2 text-xs text-zinc-500">
            {t('time.basedOnTodayPlannedMinutes')}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-zinc-100">
              {t('task.todayTasks')}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t('task.todayTasksDescription')}
            </p>
          </div>

          <TaskList
            variant="today"
            tasks={todayTasks}
            completions={completions}
            timeEntries={timeEntries}
            todayYmd={todayYmd}
            todayDow={todayDow}
            nowIso={nowIso}
            runningTaskIdToday={runningTaskIdToday}
            getMemoText={getMemoText}
            onSaveMemo={onSaveMemo}
            onToggleToday={onToggleToday}
            onArchive={onArchive}
            onStartTimer={onStartTimer}
            onStopTimer={onStopTimer}
            onError={onError}
          />

          {todayTasks.length === 0 && (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
              {t('task.noTasksScheduledToday')}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
