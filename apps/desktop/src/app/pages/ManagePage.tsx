import { useContext } from 'react';
import { TaskForm } from '../../features/task/components/TaskForm';
import { TaskList } from '../../features/task/components/TaskList';
import type {
  Completion,
  DayOfWeek,
  Task,
  TimeEntry,
} from '../../shared/types';
import { LocaleContext } from '../../i18n/context';
import { Package, PackageOpen, RotateCwIcon } from 'lucide-react';

export function ManagePage(props: {
  tasks: Task[]; // (role: visible tasks after filters, type: Task[])
  completions: Completion[]; // (role: completion logs, type: Completion[])
  timeEntries: TimeEntry[]; // (role: time tracking logs, type: TimeEntry[])
  todayYmd: string; // (role: YYYY-MM-DD, type: string)
  todayDow: DayOfWeek; // (role: day-of-week, type: DayOfWeek)

  nowIso: string; // (role: ui clock iso, type: string)
  runningTaskIdToday: string | null; // (role: single running task id, type: string | null)

  manageQuery: string; // (role: search query, type: string)
  setManageQuery: (v: string) => void; // (role: set query, type: (string)=>void)

  manageCategory: 'all' | Task['category']; // (role: selected category filter, type: union)
  setManageCategory: (v: 'all' | Task['category']) => void; // (role: set category, type: (union)=>void)

  showArchived: boolean; // (role: show archived toggle, type: boolean)
  setShowArchived: (v: boolean) => void; // (role: toggle archived view, type: (boolean)=>void)

  onReset: () => void; // (role: reset manage controls, type: ()=>void)

  onCreate: Parameters<typeof TaskForm>[0]['onCreate'];
  onUpdateTaskMeta: (input: {
    taskId: string;
    title: string;
    description: string;
    startYmd: string | null;
    autoArchiveAfter: number | null;
  }) => void;
  onToggleToday: (task: Task) => void; // (role: toggle completion, type: (Task)=>void)
  onArchive: (taskId: string) => void; // (role: archive task, type: (string)=>void)
  onRestore: (taskId: string) => void; // (role: restore task, type: (string)=>void)
  onDelete: (taskId: string) => void; // (role: delete task, type: (string)=>void)
  onStartTimer: (task: Task) => void; // (role: start timer, type: (Task)=>void)
  onStopTimer: (task: Task) => void; // (role: stop timer, type: (Task)=>void)
  onError: (msg: string) => void; // (role: error handler, type: (string)=>void)
}) {
  const { t } = useContext(LocaleContext);

  const {
    tasks,
    completions,
    timeEntries,
    todayYmd,
    todayDow,
    nowIso,
    runningTaskIdToday,
    manageQuery,
    setManageQuery,
    manageCategory,
    setManageCategory,
    showArchived,
    setShowArchived,
    onReset,
    onCreate,
    onUpdateTaskMeta,
    onToggleToday,
    onArchive,
    onRestore,
    onDelete,
    onStartTimer,
    onStopTimer,
    onError,
  } = props;

  return (
    <div className="grid gap-5 xl:grid-cols-[640px_1fr] xl:items-start">
      <aside className="space-y-5 xl:sticky xl:top-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <TaskForm onCreate={onCreate} />
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-zinc-100">
              {t('task.filters')}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t('task.filtersDescription')}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                {t('task.search')}
              </label>
              <input
                value={manageQuery}
                onChange={(e) => setManageQuery(e.target.value)}
                placeholder={t('task.searchPlaceholder')}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                {t('task.category')}
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  ['all', 'weekday', 'weekend', 'daily', 'custom'] as const
                ).map((c) => {
                  const active = manageCategory === c;
                  const label =
                    c === 'all' ? t('common.all') : t(`common.${c}`);

                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setManageCategory(c)}
                      className={[
                        'rounded-full px-3 py-1.5 text-sm transition border',
                        active
                          ? 'border-zinc-200 bg-zinc-100 text-zinc-900'
                          : 'border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-900/70',
                      ].join(' ')}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-col gap-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                {t('task.viewOptions')}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onReset}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm flex items-center gap-1 text-zinc-200 hover:bg-zinc-900/70">
                  <RotateCwIcon size={14} />
                  {t('common.reset')}
                </button>

                <button
                  type="button"
                  onClick={() => setShowArchived(!showArchived)}
                  className={[
                    'rounded-xl border px-3 py-2 text-sm transition',
                    showArchived
                      ? 'border-zinc-200 bg-zinc-100 text-zinc-900'
                      : 'border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-900/70',
                  ].join(' ')}
                  aria-pressed={showArchived}>
                  {showArchived ? (
                    <span role="button" className="flex items-center gap-1">
                      <PackageOpen size={16} />
                      {t('task.showingArchived')}
                    </span>
                  ) : (
                    <span role="button" className="flex items-center gap-1">
                      <Package size={16} />
                      {t('task.showArchived')}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      </aside>

      <main className="min-w-0">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-zinc-100">
              {t('task.manageTasks')}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t('task.manageTasksDescription')}
            </p>
          </div>

          <TaskList
            variant="manage"
            tasks={tasks}
            completions={completions}
            timeEntries={timeEntries}
            todayYmd={todayYmd}
            todayDow={todayDow}
            nowIso={nowIso}
            runningTaskIdToday={runningTaskIdToday}
            onUpdateTaskMeta={onUpdateTaskMeta}
            onToggleToday={onToggleToday}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
            onStartTimer={onStartTimer}
            onStopTimer={onStopTimer}
            onError={onError}
          />

          {tasks.length === 0 && (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
              {t('task.noTasksScheduledManage')}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
