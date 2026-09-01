import { useContext, useEffect, useMemo, useState } from 'react';
import { Check, Flag, Pause, Play, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { LocaleContext } from '../../../i18n/context';
import type { Task, TimeEntry } from '../../../shared/types';
import {
  getActiveTimerViewModel,
  getTrackedElapsedSeconds,
  type ActiveTimerPhase,
} from '../activeTimerModel';

function parseMillis(iso: string): number {
  const millis = new Date(iso).getTime();
  return Number.isFinite(millis) ? millis : Date.now();
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function useTimerClock(nowIso: string): string {
  const [nowMillis, setNowMillis] = useState(() => parseMillis(nowIso));

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMillis(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  return new Date(nowMillis).toISOString();
}

function statusLabel(
  status: ReturnType<typeof getActiveTimerViewModel>['status'],
  targetReached: boolean,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (status === 'overtime') return t('timer.overtime');
  if (status === 'paused' && targetReached) {
    return `${t('timer.paused')} · ${t('timer.targetReached')}`;
  }
  return t(`timer.${status}`);
}

export interface ActiveTimerProps {
  task: Pick<Task, 'id' | 'title' | 'durationMinutes'>;
  timeEntries: readonly TimeEntry[];
  dateYmd: string;
  nowIso: string;
  phase: ActiveTimerPhase;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onBackToPlan?: () => void;
}

export function ActiveTimer(props: ActiveTimerProps) {
  const { t } = useContext(LocaleContext);
  const clockIso = useTimerClock(props.nowIso);
  const actualElapsedSeconds = useMemo(
    () =>
      getTrackedElapsedSeconds(
        props.timeEntries,
        props.task.id,
        clockIso,
        props.dateYmd,
      ),
    [props.dateYmd, props.task.id, props.timeEntries, clockIso],
  );
  const titleId = `active-timer-title-${props.task.id}`;
  const view = getActiveTimerViewModel({
    phase: props.phase,
    plannedMinutes: props.task.durationMinutes,
    actualElapsedSeconds,
  });
  const progressPercent = Math.round(view.progressRatio * 100);
  const ringColor = view.targetReached ? '#fbbf24' : '#34d399';
  const ringBackground = `conic-gradient(${ringColor} ${progressPercent}%, rgb(39 39 42) ${progressPercent}% 100%)`;
  const displayValue = formatClock(view.displaySeconds);
  const isFinished = view.status === 'finished';
  const isPaused = view.status === 'paused';
  const isRunning = view.status === 'running' || view.status === 'overtime';
  const showOvertime =
    view.status === 'overtime' || (view.status === 'paused' && view.targetReached);

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-3xl border border-zinc-700/80 bg-zinc-900/70 shadow-2xl shadow-black/20">
      <div className="border-b border-zinc-800 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
              {t('timer.execution')}
            </p>
            <h2
              id={titleId}
              className="mt-1 truncate text-xl font-semibold text-zinc-50 sm:text-2xl">
              {props.task.title}
            </h2>
          </div>

          <span
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
              view.status === 'overtime'
                ? 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                : isRunning
                  ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
                  : isPaused
                    ? 'border-sky-300/30 bg-sky-300/10 text-sky-200'
                    : isFinished
                      ? 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300'
                      : 'border-zinc-700 bg-zinc-950/50 text-zinc-300',
            )}>
            {isFinished ? <Check size={14} /> : <span className="size-1.5 rounded-full bg-current" />}
            {statusLabel(view.status, view.targetReached, t)}
          </span>
        </div>
      </div>

      <div className="grid items-center gap-7 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(240px,0.9fr)_minmax(260px,1.1fr)] lg:gap-10 lg:py-9">
        <div className="flex justify-center">
          <div
            className="relative size-64 rounded-full p-3 shadow-[0_0_70px_rgba(52,211,153,0.08)] sm:size-72"
            style={{ background: ringBackground }}
            role="progressbar"
            aria-label={t('timer.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}>
            <div className="flex size-full flex-col items-center justify-center rounded-full bg-zinc-950 text-center">
              <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                {showOvertime
                  ? t('timer.overBy')
                  : view.status === 'finished'
                    ? t('timer.actual')
                    : view.status === 'ready'
                      ? t('timer.planned')
                      : t('timer.remaining')}
              </span>
              <span
                className="mt-2 font-mono text-5xl font-semibold tracking-tight text-zinc-50 sm:text-6xl"
                role="timer"
                aria-live="polite">
                {showOvertime ? '+' : ''}
                {displayValue}
              </span>
              <span className="mt-2 text-xs text-zinc-500">
                {t('timer.progressPercent', { percent: progressPercent })}
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-xs font-medium text-zinc-500">{t('timer.planned')}</p>
              <p className="mt-2 font-mono text-xl font-semibold text-zinc-100">
                {formatClock(view.plannedSeconds)}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-xs font-medium text-zinc-500">{t('timer.actual')}</p>
              <p className="mt-2 font-mono text-xl font-semibold text-zinc-100">
                {formatClock(view.actualSeconds)}
              </p>
            </div>
          </div>

          {view.targetReached && (
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">
              <Flag size={18} className="mt-0.5 shrink-0 text-amber-300" />
              <p>
                <span className="font-semibold">{t('timer.targetReached')}</span>
                <span className="mt-1 block text-amber-100/70">
                  {t('timer.overtimeHint')}
                </span>
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {view.status === 'ready' && (
              <button
                type="button"
                onClick={props.onStart}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-300/15 px-5 py-3 text-base font-semibold text-emerald-100 transition hover:bg-emerald-300/25 focus:outline-none focus:ring-2 focus:ring-emerald-300/60">
                <Play size={19} fill="currentColor" />
                {t('timer.start')}
              </button>
            )}

            {isRunning && (
              <button
                type="button"
                onClick={props.onPause}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-sky-300/30 bg-sky-300/15 px-5 py-3 text-base font-semibold text-sky-100 transition hover:bg-sky-300/25 focus:outline-none focus:ring-2 focus:ring-sky-300/60">
                <Pause size={19} />
                {t('timer.pause')}
              </button>
            )}

            {isPaused && (
              <button
                type="button"
                onClick={props.onResume}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-300/15 px-5 py-3 text-base font-semibold text-emerald-100 transition hover:bg-emerald-300/25 focus:outline-none focus:ring-2 focus:ring-emerald-300/60">
                <RotateCcw size={19} />
                {t('timer.resume')}
              </button>
            )}

            {!isFinished && view.status !== 'ready' && (
              <button
                type="button"
                onClick={props.onFinish}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800/70 px-5 py-3 text-base font-semibold text-zinc-100 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400/60">
                <Check size={19} />
                {t('timer.finish')}
              </button>
            )}

            {isFinished && props.onBackToPlan && (
              <button
                type="button"
                onClick={props.onBackToPlan}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800/70 px-5 py-3 text-base font-semibold text-zinc-100 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400/60">
                {t('timer.backToPlan')}
              </button>
            )}
          </div>

          <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500 lg:text-left">
            {view.status === 'finished'
              ? t('timer.finishedHint')
              : t('timer.actualTrackedHint')}
          </p>
        </div>
      </div>
    </section>
  );
}
