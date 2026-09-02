import { useContext, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Completion, Plan, Task } from '../../shared/types';
import {
  buildWeeklyTimeBudget,
  canAdjustPlanDate,
  totalPlannedMinutes,
  type WeeklyDayBudget,
  type WeeklyPlanItem,
} from '../../domain/schedule/weeklyTimeBudget';
import {
  getVisibleScheduleSlots,
  type CoreScheduleSlot,
} from '../../infrastructure/tauri/core';
import {
  buildWeekDates,
  startOfWeekMonday,
  toYmd,
} from '../../shared/utils/date';
import { LocaleContext } from '../../i18n/context';

type PlanMutation = (input: {
  taskId: string;
  date: string;
  planId?: string;
  durationMinutes: number | null;
}) => boolean | void;

type PlanDateMutation = (input: {
  taskId: string;
  date: string;
  planId?: string;
}) => boolean | void;

type PlanMoveMutation = (input: {
  taskId: string;
  planId: string;
  fromDate: string;
  destinationDate: string;
}) => boolean | void;

function formatDuration(
  minutes: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const value = Math.max(0, Math.floor(minutes || 0));
  const hours = Math.floor(value / 60);
  const remainder = value % 60;

  if (hours <= 0) return `${value}${t('time.minuteShort')}`;
  if (remainder === 0) return `${hours}${t('time.hourShort')}`;
  return `${hours}${t('time.hourShort')} ${remainder}${t('time.minuteShort')}`;
}

function normalizeWeekStart(ymd: string): string {
  return toYmd(startOfWeekMonday(new Date(`${ymd}T00:00:00`)));
}

function shiftWeekStart(weekStartYmd: string, deltaDays: number): string {
  const date = new Date(`${weekStartYmd}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return normalizeWeekStart(toYmd(date));
}

function mutationSucceeded(result: boolean | void): boolean {
  return result !== false;
}

function PlanAdjustment(props: {
  item: WeeklyPlanItem;
  onClose: () => void;
  onSetPlanDuration?: PlanMutation;
  onSkipPlan?: PlanDateMutation;
  onRestorePlan?: PlanDateMutation;
  onMovePlan?: PlanMoveMutation;
  todayYmd: string;
}) {
  const { t } = useContext(LocaleContext);
  const {
    item,
    onClose,
    onSetPlanDuration,
    onSkipPlan,
    onRestorePlan,
    onMovePlan,
    todayYmd,
  } = props;
  const [draft, setDraft] = useState(
    String(item.plan.plannedDurationMinutes),
  );
  const [moveDraft, setMoveDraft] = useState(item.dateYmd);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isSkipped = item.plan.status === 'skipped';
  const isMoved = item.plan.status === 'moved';

  const saveDuration = () => {
    const durationMinutes = Number(draft.trim());
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 720
    ) {
      setValidationError(t('task.validation.durationInvalid'));
      return;
    }

    setValidationError(null);
    if (
      onSetPlanDuration &&
      mutationSucceeded(
        onSetPlanDuration({
          taskId: item.task.id,
          date: item.dateYmd,
          planId: item.plan.id,
          durationMinutes,
        }),
      )
    ) {
      onClose();
    }
  };

  const restore = () => {
    if (
      onRestorePlan &&
      mutationSucceeded(
        onRestorePlan({
          taskId: item.task.id,
          date: item.dateYmd,
          planId: item.plan.id,
        }),
      )
    ) {
      onClose();
    }
  };

  const skip = () => {
    if (
      onSkipPlan &&
      mutationSucceeded(onSkipPlan({ taskId: item.task.id, date: item.dateYmd }))
    ) {
      onClose();
    }
  };

  const move = () => {
    if (!onMovePlan || !moveDraft) return;
    setValidationError(null);
    if (
      mutationSucceeded(
        onMovePlan({
          taskId: item.task.id,
          planId: item.plan.id,
          fromDate: item.plan.date,
          destinationDate: moveDraft,
        }),
      )
    ) {
      onClose();
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-emerald-300/20 bg-zinc-950/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-zinc-200">
            {t('schedule.adjustPlan')}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            {t('schedule.adjustPlanHint')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-200"
          aria-label={t('common.close')}>
          ×
        </button>
      </div>

      {isSkipped ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-amber-200">{t('schedule.allSkipped')}</span>
          {onRestorePlan && (
            <button
              type="button"
              onClick={restore}
              className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1.5 text-xs text-emerald-100 hover:bg-emerald-300/20">
              {t('schedule.restorePlan')}
            </button>
          )}
        </div>
      ) : (
        <>
          {isMoved && (
            <p className="mt-3 text-xs text-sky-200/80">
              {t('schedule.movedPlanHint')}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              {t('task.planned')}
              <input
                type="number"
                min={1}
                max={720}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setValidationError(null);
                }}
                className="w-24 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-xs text-zinc-100 outline-none focus:border-emerald-300/60"
                aria-label={t('schedule.plannedDurationFor', {
                  task: item.task.title,
                })}
              />
            </label>
            <span className="pb-1.5 text-xs text-zinc-500">
              {t('time.minuteShort')}
            </span>
            {onSetPlanDuration && (
              <button
                type="button"
                onClick={saveDuration}
                className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1.5 text-xs text-emerald-100 hover:bg-emerald-300/20">
                {t('common.save')}
              </button>
            )}
          </div>

          {validationError && (
            <p className="mt-2 text-xs text-rose-300" role="alert">
              {validationError}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {item.plan.durationOverrideMinutes != null && onRestorePlan && (
              <button
                type="button"
                onClick={restore}
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
                {t('schedule.restoreRoutinePlan')}
              </button>
            )}
            {!isMoved && onSkipPlan && (
              <button
                type="button"
                onClick={skip}
                className="rounded-lg border border-amber-300/30 px-2.5 py-1.5 text-xs text-amber-100 hover:bg-amber-300/10">
                {t('schedule.skipPlan')}
              </button>
            )}
          </div>

          {onMovePlan && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-3">
              <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
                {t('schedule.moveTo')}
                <input
                  type="date"
                  min={todayYmd}
                  value={moveDraft}
                  onChange={(event) => {
                    setMoveDraft(event.target.value);
                    setValidationError(null);
                  }}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-sky-300/60"
                  aria-label={t('schedule.moveTo')}
                />
              </label>
              <button
                type="button"
                onClick={move}
                className="rounded-lg border border-sky-300/30 bg-sky-300/10 px-2.5 py-1.5 text-xs text-sky-100 hover:bg-sky-300/20">
                {t('schedule.movePlan')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WeeklyLoadOverview(props: {
  days: WeeklyDayBudget[];
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const { days, t } = props;
  const peakDayMinutes = Math.max(0, ...days.map((day) => day.plannedMinutes));
  const maxDailyMinutes = Math.max(1, peakDayMinutes);
  const weekTotal = totalPlannedMinutes(days);
  const dailyCapacityMinutes = days[0]?.capacityMinutes ?? 0;
  const activePlanCount = days.reduce(
    (total, day) =>
      total + day.plans.filter((item) => item.plan.executable).length,
    0,
  );
  const plannedDayCount = days.filter((day) => day.plannedMinutes > 0).length;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.5fr)]">
      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200/70">
          {t('schedule.weekPlanned')}
        </p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
          {formatDuration(weekTotal, t)}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          {t('schedule.weekSummary', {
            days: plannedDayCount,
            plans: activePlanCount,
          })}
        </p>
      </div>

      <div
        className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4"
        role="img"
        aria-label={t('schedule.dailyLoad')}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {t('schedule.dailyLoad')}
          </p>
          <span className="text-[11px] text-zinc-600">
            {t('schedule.maxDay', {
              duration: formatDuration(peakDayMinutes, t),
            })}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">
          {t('schedule.capacity', {
            duration: formatDuration(dailyCapacityMinutes, t),
          })}
        </p>
        <div className="mt-3 grid grid-cols-7 items-end gap-1.5 sm:gap-2">
          {days.map((day) => {
            const height =
              day.plannedMinutes === 0
                ? 0
                : Math.max(8, (day.plannedMinutes / maxDailyMinutes) * 100);

            return (
              <div key={day.dateYmd} className="min-w-0 text-center">
                <div className="flex h-24 items-end justify-center">
                  <div
                    className={clsx(
                      'w-full max-w-8 rounded-t-md transition-[height]',
                      day.overloaded ? 'bg-amber-300/70' : 'bg-emerald-300/60',
                    )}
                    style={{ height: `${height}%` }}
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-2 truncate text-[11px] font-medium text-zinc-300">
                  {t(`time.day.${day.day}`)}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                  {formatDuration(day.plannedMinutes, t)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayBudgetCard(props: {
  day: WeeklyDayBudget;
  todayYmd: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onOpenTask?: (taskId: string) => void;
  onSetPlanDuration?: PlanMutation;
  onSkipPlan?: PlanDateMutation;
  onRestorePlan?: PlanDateMutation;
  onMovePlan?: PlanMoveMutation;
}) {
  const {
    day,
    todayYmd,
    t,
    onOpenTask,
    onSetPlanDuration,
    onSkipPlan,
    onRestorePlan,
    onMovePlan,
  } = props;
  const [adjustingKey, setAdjustingKey] = useState<string | null>(null);
  const skippedCount = day.plans.filter((item) => !item.plan.executable).length;
  const allSkipped = day.plans.length > 0 && skippedCount === day.plans.length;
  const canAdjustDate = canAdjustPlanDate(day.dateYmd, todayYmd);

  return (
    <article
      className={clsx(
        'rounded-2xl border bg-zinc-950/40 p-3',
        day.overloaded ? 'border-amber-300/30' : 'border-zinc-800',
      )}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">
            {t(`time.day.${day.day}`)}
          </h3>
          <time
            className="mt-1 block text-[11px] text-zinc-500"
            dateTime={day.dateYmd}>
            {day.dateYmd}
          </time>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={clsx(
              'text-lg font-semibold',
              day.plannedMinutes > 0 ? 'text-emerald-200' : 'text-zinc-500',
            )}>
            {formatDuration(day.plannedMinutes, t)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-600">
            {t('task.planned')}
          </div>
        </div>
      </header>

      {day.overloaded && (
        <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">
          {t('schedule.highLoad', {
            planned: formatDuration(day.plannedMinutes, t),
            capacity: formatDuration(day.capacityMinutes, t),
          })}
        </div>
      )}

      {allSkipped && (
        <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900/50 px-2 py-1.5 text-xs text-zinc-400">
          {t('schedule.allSkipped')}
        </div>
      )}

      {day.plans.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-sm text-zinc-500">
          {t('schedule.noPlansForDay')}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {day.plans.map((item) => {
            const itemKey = `${item.task.id}:${item.plan.id}:${item.dateYmd}`;
            const isAdjusting = adjustingKey === itemKey;
            const isSkipped = !item.plan.executable;
            const isMoved = item.plan.status === 'moved';

            return (
              <article
                key={itemKey}
                className={clsx(
                  'rounded-xl border px-3 py-2.5',
                  isSkipped
                    ? 'border-amber-300/20 bg-amber-300/5'
                    : item.completed
                      ? 'border-emerald-400/30 bg-emerald-400/10'
                      : 'border-zinc-800 bg-zinc-900/30',
                )}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenTask?.(item.task.id)}
                      className="max-w-full truncate text-left text-sm font-medium text-zinc-100 hover:text-emerald-200"
                      aria-label={t('schedule.openRoutine', {
                        task: item.task.title,
                      })}>
                      {item.task.title}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                      {!item.task.isActive && (
                        <span className="text-zinc-500">{t('common.archived')}</span>
                      )}
                      {isSkipped && (
                        <span className="text-amber-200">{t('schedule.skipped')}</span>
                      )}
                      {isMoved && (
                        <span className="text-sky-200">{t('schedule.moved')}</span>
                      )}
                      {item.plan.durationOverrideMinutes != null && !isSkipped && (
                        <span className="text-violet-200">
                          {t('schedule.override')}
                        </span>
                      )}
                      {item.completed && (
                        <span className="text-emerald-200/80">
                          {t('schedule.completed')}
                        </span>
                      )}
                    </div>
                    {item.memoText && (
                      <div className="mt-1 truncate text-xs text-zinc-500">
                        {t('task.memo')}: {item.memoText}
                      </div>
                    )}
                  </div>

                  <div
                    className={clsx(
                      'shrink-0 text-right text-base font-semibold',
                      isSkipped
                        ? 'text-zinc-500 line-through'
                        : 'text-zinc-200',
                    )}>
                    {formatDuration(item.plan.plannedDurationMinutes, t)}
                    <div className="text-[10px] font-normal uppercase tracking-wide text-zinc-600">
                      {t('task.planned')}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-600">
                    {t('schedule.planDate', { date: item.dateYmd })}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {onOpenTask && (
                      <button
                        type="button"
                        onClick={() => onOpenTask(item.task.id)}
                        className="rounded-lg border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
                        {t('schedule.routine')}
                      </button>
                    )}
                    {canAdjustDate &&
                      (onSetPlanDuration || onSkipPlan || onRestorePlan || onMovePlan) && (
                        <button
                          type="button"
                          onClick={() =>
                            setAdjustingKey((current) =>
                              current === itemKey ? null : itemKey,
                            )
                          }
                          className="rounded-lg border border-emerald-300/30 bg-emerald-300/5 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-300/15">
                          {t('schedule.adjustPlan')}
                        </button>
                      )}
                    {!canAdjustDate &&
                      (onSetPlanDuration || onSkipPlan || onRestorePlan || onMovePlan) && (
                        <span className="rounded-lg border border-zinc-800 px-2 py-1 text-[11px] text-zinc-600">
                          {t('schedule.pastReadOnly')}
                        </span>
                      )}
                  </div>
                </div>

                {isAdjusting && canAdjustDate && (
                  <PlanAdjustment
                    item={item}
                    todayYmd={todayYmd}
                    onClose={() => setAdjustingKey(null)}
                    onSetPlanDuration={onSetPlanDuration}
                    onSkipPlan={onSkipPlan}
                    onRestorePlan={onRestorePlan}
                    onMovePlan={onMovePlan}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function SchedulePage(props: {
  tasks: Task[];
  completions: Completion[];
  plans: Plan[];
  weekStartYmd: string;
  todayYmd: string;
  getMemoText?: (taskId: string, date: string) => string;
  onOpenTask?: (taskId: string) => void;
  onSetPlanDuration?: PlanMutation;
  onSkipPlan?: PlanDateMutation;
  onRestorePlan?: PlanDateMutation;
  onMovePlan?: PlanMoveMutation;
  dailyCapacityMinutes?: number;
}) {
  const { t } = useContext(LocaleContext);
  const {
    tasks,
    completions,
    plans,
    weekStartYmd,
    todayYmd,
    getMemoText,
    onOpenTask,
    onSetPlanDuration,
    onSkipPlan,
    onRestorePlan,
    onMovePlan,
    dailyCapacityMinutes,
  } = props;

  const currentWeekStartYmd = useMemo(
    () => normalizeWeekStart(weekStartYmd),
    [weekStartYmd],
  );
  const [displayWeekStartYmd, setDisplayWeekStartYmd] = useState(
    currentWeekStartYmd,
  );

  useEffect(() => {
    setDisplayWeekStartYmd(currentWeekStartYmd);
  }, [currentWeekStartYmd]);

  const normalizedWeekStartYmd = useMemo(
    () => normalizeWeekStart(displayWeekStartYmd),
    [displayWeekStartYmd],
  );
  const [scheduleSlots, setScheduleSlots] = useState<CoreScheduleSlot[]>([]);

  useEffect(() => {
    let current = true;
    void getVisibleScheduleSlots({
      tasks,
      completions,
      plans,
      weekStartYmd: normalizedWeekStartYmd,
      // Archived routines must continue to contribute any historical Plans
      // and completions that fall inside the viewed week.
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
  }, [tasks, completions, plans, normalizedWeekStartYmd]);

  const weekDates = useMemo(
    () => buildWeekDates(normalizedWeekStartYmd),
    [normalizedWeekStartYmd],
  );
  const days = useMemo(
    () =>
      buildWeeklyTimeBudget({
        tasks,
        scheduleSlots,
        weekDates,
        completions,
        getMemoText,
        dailyCapacityMinutes,
      }),
    [
      tasks,
      scheduleSlots,
      weekDates,
      completions,
      getMemoText,
      dailyCapacityMinutes,
    ],
  );
  const weekEndYmd = weekDates[6] ?? normalizedWeekStartYmd;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              {t('common.schedule')}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {t('schedule.planningHint')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setDisplayWeekStartYmd((previous) =>
                  shiftWeekStart(previous, -7),
                )
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
              onClick={() =>
                setDisplayWeekStartYmd((previous) => shiftWeekStart(previous, 7))
              }
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900/70">
              {t('schedule.nextWeek')}
            </button>
          </div>
        </div>
        <div className="text-xs text-zinc-500">
          {t('schedule.weekRange', {
            start: normalizedWeekStartYmd,
            end: weekEndYmd,
          })}
        </div>
      </div>

      <WeeklyLoadOverview days={days} t={t} />

      <p className="mt-4 text-xs text-zinc-500">{t('schedule.durationHint')}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((day) => (
          <DayBudgetCard
            key={day.dateYmd}
            day={day}
            todayYmd={todayYmd}
            t={t}
            onOpenTask={onOpenTask}
            onSetPlanDuration={onSetPlanDuration}
            onSkipPlan={onSkipPlan}
            onRestorePlan={onRestorePlan}
            onMovePlan={onMovePlan}
          />
        ))}
      </div>
    </section>
  );
}
