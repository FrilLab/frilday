import { useContext, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Completion, Task } from '../../shared/types';
import { buildWeekSchedule, WEEK_ORDER } from '../../domain/scheduleView';
import {
  buildWeekDates,
  startOfWeekMonday,
  toYmd,
} from '../../shared/utils/date';
import { LocaleContext } from '../../i18n/context';

// (role: display helper, type: (number)=>string)
function formatDuration(
  minutes: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const m = Math.max(0, Math.floor(minutes || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;

  if (h <= 0) return `${m}${t('time.minuteShort')}`;
  if (r === 0) return `${h}${t('time.hourShort')}`;
  return `${h}${t('time.hourShort')} ${r}${t('time.minuteShort')}`;
}

// (role: block height unit, type: number)
const HOUR_PX = 44;

// (role: minutes->hour blocks, type: (number)=>number)
function toHourBlocks(minutes: number): number {
  return Math.max(1, Math.ceil((minutes || 0) / 60));
}

function normalizeWeekStart(ymd: string): string {
  return toYmd(startOfWeekMonday(new Date(`${ymd}T00:00:00`)));
}

function shiftWeekStart(weekStartYmd: string, deltaDays: number): string {
  const d = new Date(`${weekStartYmd}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return normalizeWeekStart(toYmd(d));
}

export function SchedulePage(props: {
  tasks: Task[]; // (role: all tasks, type: Task[])
  completions: Completion[]; // (role: completion logs, type: Completion[])
  weekStartYmd: string; // (role: current-week monday, type: string (YYYY-MM-DD))
  getMemoText?: (taskId: string, date: string) => string;
  onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useContext(LocaleContext);
  const { tasks, completions, weekStartYmd, getMemoText, onOpenTask } = props;

  const currentWeekStartYmd = useMemo(
    () => normalizeWeekStart(weekStartYmd),
    [weekStartYmd],
  );
  const [displayWeekStartYmd, setDisplayWeekStartYmd] =
    useState(currentWeekStartYmd);

  const normalizedWeekStartYmd = useMemo(
    () => normalizeWeekStart(displayWeekStartYmd),
    [displayWeekStartYmd],
  );
  const canGoNext = normalizedWeekStartYmd < currentWeekStartYmd;

  const week = buildWeekSchedule(tasks, completions, normalizedWeekStartYmd, {
    includeArchived: false,
    getMemoText,
  });

  const weekDates = useMemo(
    () => buildWeekDates(normalizedWeekStartYmd),
    [normalizedWeekStartYmd],
  );
  const weekEndYmd = weekDates[6] ?? normalizedWeekStartYmd;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-100">
            {t('common.schedule')}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setDisplayWeekStartYmd((prev) => shiftWeekStart(prev, -7))
              }
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900/70">
              {t('schedule.prevWeek')}
            </button>
            <button
              type="button"
              onClick={() => setDisplayWeekStartYmd(currentWeekStartYmd)}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900/70">
              {t('schedule.thisWeek')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!canGoNext) return;
                setDisplayWeekStartYmd((prev) => shiftWeekStart(prev, 7));
              }}
              disabled={!canGoNext}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900/70 disabled:cursor-not-allowed disabled:opacity-50">
              {t('schedule.nextWeek')}
            </button>
          </div>
        </div>
        <div className="text-xs whitespace-nowrap text-zinc-500">
          {t('schedule.weekRange', {
            start: normalizedWeekStartYmd,
            end: weekEndYmd,
          })}
        </div>
        <p className="mt-1 whitespace-pre-line text-sm text-zinc-400">
          {t('note.scheduleDescription')}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {WEEK_ORDER.map((dow, dowIndex) => {
          const items = week[dow];
          const columnDateYmd = weekDates[dowIndex] ?? normalizedWeekStartYmd;

          const totalMinutes = items.reduce(
            (acc, it) => acc + (it.durationMinutes || 0),
            0,
          );

          const doneCount = items.reduce((acc, it) => {
            const doneThatDay = completions.some(
              (c) => c.taskId === it.taskId && c.date === columnDateYmd,
            );
            return acc + (doneThatDay ? 1 : 0);
          }, 0);

          return (
            <div
              key={dow}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">
                    {t(`time.day.${dow}`)}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {columnDateYmd.slice(5)}
                  </div>
                </div>

                <div className="shrink-0 flex gap-1 text-right text-xs text-zinc-500">
                  <div className="text-zinc-400">
                    {formatDuration(totalMinutes, t)}
                  </div>
                  <div>
                    ({doneCount}/{items.length})
                  </div>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="mt-3 text-sm text-zinc-500">
                  {t('task.noTasksInSchedule')}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {items.map((it) => {
                    const blocks = toHourBlocks(it.durationMinutes);
                    const heightPx = blocks * HOUR_PX;

                    const doneThatDay = completions.some(
                      (c) => c.taskId === it.taskId && c.date === columnDateYmd,
                    );

                    const blockStyle = {
                      ['--h' as string]: `${heightPx}px`,
                    } as React.CSSProperties;

                    return (
                      <button
                        type="button"
                        key={`${dow}_${it.taskId}`}
                        onClick={() => onOpenTask?.(it.taskId)}
                        className={clsx(
                          'h-auto w-full rounded-xl border px-3 py-2 text-left transition',
                          'lg:[height:var(--h)]',
                          doneThatDay
                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15'
                            : 'border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50',
                        )}
                        style={blockStyle}>
                        <div className="flex min-h-5 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div
                              className={clsx(
                                'truncate text-sm font-medium',
                                doneThatDay
                                  ? 'text-emerald-200'
                                  : 'text-zinc-100',
                              )}>
                              {it.title}
                            </div>
                            {it.description ? (
                              <div
                                className={clsx(
                                  'mt-1 truncate text-xs',
                                  doneThatDay
                                    ? 'text-emerald-200/70'
                                    : 'text-zinc-400',
                                )}>
                                {it.description}
                              </div>
                            ) : null}
                            {it.memoText ? (
                              <div
                                className={clsx(
                                  'mt-1 truncate text-xs',
                                  doneThatDay
                                    ? 'text-emerald-200/70'
                                    : 'text-zinc-500',
                                )}>
                                {t('task.memo')}: {it.memoText}
                              </div>
                            ) : null}
                          </div>

                          <div
                            className={clsx(
                              'shrink-0 text-xs',
                              doneThatDay
                                ? 'text-emerald-200/80'
                                : 'text-zinc-400',
                            )}>
                            {formatDuration(it.durationMinutes, t)}
                          </div>
                        </div>

                        {blocks >= 2 && (
                          <div
                            className={clsx(
                              'mt-2 hidden text-xs lg:block',
                              doneThatDay
                                ? 'text-emerald-200/60'
                                : 'text-zinc-600',
                            )}>
                            {/* room for future */}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
