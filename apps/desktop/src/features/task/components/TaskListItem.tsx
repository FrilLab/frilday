import { useContext, useState } from 'react';
import type { Completion, DayOfWeek, Task, TimeEntry } from '../types';
import { isDoneOn } from '../../../domain/completion';
import { isScheduledOn } from '../../../domain/schedule';
import { diffMinutes } from '../date';
import { Archive, Check, Pause, Pencil, Play, StickyNote } from 'lucide-react';
import clsx from 'clsx';
import { LocaleContext } from '../../../i18n/context';

interface TaskListItemProps {
  task: Task; // (role: task item, type: Task)
  completions: Completion[]; // (role: completion logs, type: Completion[])
  timeEntries: TimeEntry[]; // (role: time tracking logs, type: TimeEntry[])
  todayYmd: string; // (role: YYYY-MM-DD, type: string)
  todayDow: DayOfWeek; // (role: day-of-week, type: DayOfWeek)

  nowIso: string; // (role: ui clock iso, type: string)
  runningTaskIdToday: string | null; // (role: single running task id, type: string | null)

  variant: 'today' | 'manage'; // (role: UI behavior switch, type: union)
  memoText?: string; // (role: today memo text, type: string | undefined)

  onToggleToday: (task: Task) => void; // (role: toggle today's completion, type: (Task)=>void)
  onArchive: (taskId: string) => void; // (role: archive task, type: (string)=>void)
  onRestore?: (taskId: string) => void; // (role: restore handler, type: ((string)=>void) | undefined)
  onDelete?: (taskId: string) => void; // (role: hard delete handler, type: ((string)=>void) | undefined)
  onStartTimer: (task: Task) => void; // (role: start timer, type: (Task)=>void)
  onStopTimer: (task: Task) => void; // (role: stop timer, type: (Task)=>void)
  onSaveMemo?: (input: { taskId: string; date: string; text: string }) => void; // (role: save daily memo, type: ((input)=>void) | undefined)
  onUpdateTaskMeta?: (input: {
    taskId: string;
    title: string;
    description: string;
    startYmd: string | null;
    autoArchiveAfter: number | null;
  }) => void; // (role: update task fields, type: ((input)=>void) | undefined)
  onError: (msg: string) => void; // (role: set error message, type: (string)=>void)
}

export function TaskListItem(props: TaskListItemProps) {
  const { t: tr } = useContext(LocaleContext);

  const {
    task,
    completions,
    timeEntries,
    todayYmd,
    todayDow,
    nowIso,
    runningTaskIdToday,
    variant,
    memoText,
    onToggleToday,
    onArchive,
    onRestore,
    onDelete,
    onStartTimer,
    onStopTimer,
    onSaveMemo,
    onUpdateTaskMeta,
    onError,
  } = props;

  const scheduledToday = isScheduledOn(task, todayDow);
  const doneToday = isDoneOn(completions, task.id, todayYmd);

  // (role: safe description string, type: string)
  const description = (task.description ?? '').trim();

  // (role: total completion count for this task, type: number)
  const doneCountTotal = (completions ?? []).filter(
    (c) => c.taskId === task.id,
  ).length;

  // (role: auto-archive progress "done/threshold", type: string | null)
  const autoArchiveProgressLabel =
    task.autoArchiveAfter == null
      ? null
      : `(${Math.min(doneCountTotal, task.autoArchiveAfter)}/${task.autoArchiveAfter})`;

  const safeTimeEntries = timeEntries ?? [];
  const todayEntries = safeTimeEntries.filter(
    (e) => e.taskId === task.id && e.date === todayYmd,
  );

  // Store policy: only ONE running entry per day.
  const running = runningTaskIdToday === task.id;

  const totalMinutesToday = todayEntries.reduce((acc, e) => {
    if (e.endedAt == null) return acc + diffMinutes(e.startedAt, nowIso);
    return acc + (e.minutes || 0);
  }, 0);

  const plannedMinutes = Math.max(0, task.durationMinutes || 0);

  // progress (0~1). if done => 1 (UX)
  const progress01 = doneToday
    ? 1
    : plannedMinutes === 0
      ? 0
      : Math.min(totalMinutesToday / plannedMinutes, 1);

  const progressPct = Math.round(progress01 * 100);
  const daysLabel = task.daysOfWeek.map((d) => tr(`time.day.${d}`)).join(', ');
  const categoryLabel = tr(`common.${task.category}`);

  const [memoOpen, setMemoOpen] = useState(false);
  const [memoDraft, setMemoDraft] = useState(memoText ?? '');

  // (role: toggle memo editor, type: ()=>void)
  const onToggleMemo = () => {
    setMemoOpen((prev) => {
      const next = !prev;

      // "열리는 순간"에만 초기값 주입 (effect 필요 없음)
      if (next) {
        setMemoDraft(memoText ?? '');
      }

      return next;
    });
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(
    task.description ?? '',
  );
  const [editAutoArchiveAfter, setEditAutoArchiveAfter] = useState(
    task.autoArchiveAfter == null ? '' : String(task.autoArchiveAfter),
  );
  const [editStartYmd, setEditStartYmd] = useState(task.startYmd ?? '');
  const [editStartYmdError, setEditStartYmdError] = useState<string | null>(
    null,
  );

  // (role: open edit panel and initialize drafts, type: ()=>void)
  const openEdit = () => {
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditAutoArchiveAfter(
      task.autoArchiveAfter == null ? '' : String(task.autoArchiveAfter),
    );
    setEditStartYmd(task.startYmd ?? '');
    setEditStartYmdError(null);
    setEditOpen(true);
  };

  // (role: close edit panel, type: ()=>void)
  const closeEdit = () => setEditOpen(false);

  const saveMemo = () => {
    if (!onSaveMemo) return;
    onSaveMemo({
      taskId: task.id,
      date: todayYmd,
      text: memoDraft,
    });
  };

  const saveTaskMeta = () => {
    if (!onUpdateTaskMeta) return;

    const normalized = editAutoArchiveAfter.trim();
    const threshold = normalized === '' ? null : Number(normalized);

    if (threshold != null && (!Number.isInteger(threshold) || threshold < 1)) {
      onError(tr('task.autoArchiveAfterHint'));
      return;
    }

    const createdAtYmd = task.createdAt.slice(0, 10);
    const normalizedStartYmd =
      editStartYmd.trim() === '' ? null : editStartYmd.trim();
    if (normalizedStartYmd && normalizedStartYmd < createdAtYmd) {
      setEditStartYmdError(tr('task.validation.startDateBeforeCreatedAt'));
      return;
    }

    setEditStartYmdError(null);
    onUpdateTaskMeta({
      taskId: task.id,
      title: editTitle,
      description: editDescription, // always string
      startYmd: normalizedStartYmd,
      autoArchiveAfter: threshold,
    });

    // UX: 저장 후 닫고 싶으면 이 줄을 켜도 됨.
    // closeEdit();
  };

  return (
    <div
      className={clsx(
        'rounded-2xl border p-3 transition',
        scheduledToday
          ? 'border-zinc-800 bg-zinc-950/40'
          : 'border-zinc-900 bg-zinc-950/20 opacity-80',
        variant == 'today' ? 'xl:px-5 xl:pt-5' : '',
      )}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 w-full md:max-w-[64%]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold text-zinc-100">
              {task.title}
            </div>

            <span className="rounded-full border border-zinc-800 bg-zinc-900/40 px-2 py-0.5 text-xs text-zinc-300">
              {categoryLabel}
            </span>

            {!task.isActive && (
              <span className="rounded-full border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 text-xs text-zinc-300">
                {tr('common.archived')}
              </span>
            )}
          </div>

          {description && (
            <p className="mt-1 truncate text-xs text-zinc-400">{description}</p>
          )}

          <div className="mt-1 text-xs text-zinc-500">
            <span
              className={clsx(
                variant == 'today' ? 'hidden md:inline-block' : 'inline-block',
              )}>
              {tr('task.days')}: {daysLabel} ·
            </span>{' '}
            {tr('task.plan')}: {task.durationMinutes}
            {tr('time.minuteShort')}{' '}
            <span
              className={clsx(variant == 'today' ? 'inline-block' : 'hidden')}>
              · {tr('task.todaySpent')}:{' '}
              {doneToday ? task.durationMinutes : totalMinutesToday}
              {tr('time.minuteShort')}
            </span>
            {task.autoArchiveAfter != null && (
              <span className="ml-2 text-zinc-400">
                · {tr('task.autoArchiveAfter')}: {autoArchiveProgressLabel}
              </span>
            )}
            {running && (
              <span className="ml-2 text-emerald-200">
                {tr('common.running')}
              </span>
            )}
            {!scheduledToday && (
              <span className="ml-2 text-zinc-600">
                {tr('empty.notScheduledToday')}
              </span>
            )}
            <div
              className={clsx(
                'mt-2 h-2 w-full overflow-hidden rounded-full border border-zinc-800 bg-zinc-900/40',
                variant == 'manage' && 'hidden',
              )}>
              <div
                className="h-full rounded-full bg-zinc-300/30 transition-all"
                style={{ width: `${progressPct}%` }}
                aria-hidden="true"
              />
            </div>
            <div
              className={clsx(
                'mt-1 hidden text-[11px] text-zinc-600 text-end',
                variant == 'today' && 'sm:block',
              )}>
              {progressPct}%
            </div>
          </div>
        </div>

        <div className="shrink-0 flex min-h-10 flex-wrap items-center justify-end gap-2 md:justify-normal md:gap-2">
          {variant == 'today' && (
            <button
              type="button"
              onClick={() => {
                if (!scheduledToday) {
                  onError(tr('note.taskNotScheduledToday'));
                  return;
                }
                if (running) onStopTimer(task);
                else onStartTimer(task);
              }}
              disabled={!scheduledToday || doneToday}
              className={[
                'rounded-xl border px-3 py-2 text-sm transition min-w-18 shrink-0',
                running
                  ? 'border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15'
                  : doneToday
                    ? 'border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-900/70'
                    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15',
                'disabled:cursor-not-allowed disabled:opacity-60',
              ].join(' ')}>
              {running ? (
                <span className="flex items-center gap-1">
                  <Pause size={14} />
                  {tr('time.stop')}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Play size={14} />
                  {tr('time.start')}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (!scheduledToday) {
                onError(tr('note.taskNotScheduledToday'));
                return;
              }
              onToggleToday(task);
            }}
            disabled={!scheduledToday}
            className={[
              'inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition',
              doneToday
                ? 'border-zinc-700 bg-zinc-800/40 text-zinc-400'
                : 'border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-900/70',
              'disabled:cursor-not-allowed disabled:opacity-60',
            ].join(' ')}>
            <span
              className={[
                'flex items-center justify-center h-4 w-4 rounded border transition',
                doneToday
                  ? 'border-zinc-500 bg-zinc-600'
                  : 'border-zinc-600 bg-transparent',
              ].join(' ')}
              aria-hidden="true">
              {doneToday && <Check size={12} className="text-white" />}
            </span>
            {tr('stats.done')}
          </button>

          {variant === 'today' && (
            <button
              type="button"
              onClick={onToggleMemo}
              className="rounded-xl inline-flex items-center gap-1 border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900/70">
              <StickyNote size={14} /> {tr('task.memo')}
            </button>
          )}

          {variant === 'manage' && (
            <>
              <button
                type="button"
                onClick={() => (editOpen ? closeEdit() : openEdit())}
                className="rounded-xl inline-flex items-center gap-1 border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900/70">
                <Pencil size={14} /> {tr('common.edit')}
              </button>

              {task.isActive && (
                <button
                  type="button"
                  onClick={() => onArchive(task.id)}
                  className="rounded-xl inline-flex items-center gap-1 border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900/70">
                  <Archive size={14} /> {tr('task.archive')}
                </button>
              )}

              {!task.isActive && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRestore?.(task.id)}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900/70">
                    {tr('task.restore')}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!onDelete) return;
                      const ok = window.confirm(
                        tr('note.deleteConfirm', { title: task.title }),
                      );
                      if (!ok) return;
                      onDelete(task.id);
                    }}
                    className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200 hover:bg-red-400/15">
                    {tr('task.delete')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {variant === 'today' && memoOpen && (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            {tr('task.memo')}
          </label>
          <textarea
            value={memoDraft}
            onChange={(e) => setMemoDraft(e.target.value)}
            onBlur={saveMemo}
            rows={3}
            placeholder={tr('task.memoPlaceholder')}
            className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={saveMemo}
              className="rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white">
              {tr('common.save')}
            </button>
          </div>
        </div>
      )}

      {variant === 'manage' && editOpen && (
        <div className="mt-3 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              {tr('task.title')}
            </label>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              {tr('task.description')}
            </label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              placeholder={tr('task.descriptionPlaceholder')}
              className="min-h-24 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              {tr('task.startDate')}
            </label>
            <input
              type="date"
              value={editStartYmd}
              onChange={(e) => {
                setEditStartYmd(e.target.value);
                setEditStartYmdError(null);
              }}
              className="w-44 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-400"
            />
            <p className="mt-1 text-xs text-zinc-500">
              {tr('task.startDateHint')}
            </p>
            {editStartYmdError && (
              <p className="mt-1 text-xs text-amber-200">{editStartYmdError}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              {tr('task.autoArchiveAfter')}
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={editAutoArchiveAfter}
              onChange={(e) => setEditAutoArchiveAfter(e.target.value)}
              placeholder="2"
              className="w-32 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
            />
            <p className="mt-1 text-xs text-zinc-500">
              {tr('task.autoArchiveAfterHint')}
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveTaskMeta}
              className="rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white">
              {tr('common.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
