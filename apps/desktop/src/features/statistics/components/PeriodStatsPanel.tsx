import { useContext } from 'react';
import type { Completion, Task } from '../types';
import { dayOfWeek } from '../date';
import { isScheduledOn } from '../../../domain/schedule';
import { isDoneOn } from '../../../domain/completion';
import { LocaleContext } from '../../../i18n/context';

// (role: clamp helper, type: (number, number, number)=>number)
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// (role: date add helper, type: (string, number)=>string)
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// (role: start of week monday (ymd), type: (string)=>string)
function startOfWeekMondayYmd(todayYmd: string): string {
  const d = new Date(`${todayYmd}T00:00:00`);
  const jsDow = d.getDay(); // 0 Sun .. 6 Sat
  const offset = (jsDow + 6) % 7; // Mon=0, Tue=1, ... Sun=6
  return addDaysYmd(todayYmd, -offset);
}

// (role: start of month (ymd), type: (string)=>string)
function startOfMonthYmd(todayYmd: string): string {
  const d = new Date(`${todayYmd}T00:00:00`);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

// (role: min ymd from completions, type: (Completion[], string)=>string)
function earliestCompletionYmd(
  completions: Completion[],
  fallbackYmd: string,
): string {
  if (!completions || completions.length === 0) return fallbackYmd;
  // YYYY-MM-DD lexical order works
  return completions.reduce(
    (min, c) => (c.date < min ? c.date : min),
    completions[0].date,
  );
}

// (role: range stats, type: (Task[], Completion[], string, string)=>{scheduledCount:number, doneCount:number, rate:number})
function calcRangeCompletion(
  tasks: Task[],
  completions: Completion[],
  startYmd: string,
  endYmd: string,
) {
  const activeTasks = tasks.filter((t) => t.isActive);

  let scheduledCount = 0;
  let doneCount = 0;

  for (let cur = startYmd; cur <= endYmd; cur = addDaysYmd(cur, 1)) {
    const dow = dayOfWeek(new Date(`${cur}T00:00:00`));

    for (const t of activeTasks) {
      if (!isScheduledOn(t, dow)) continue;

      scheduledCount += 1;

      if (isDoneOn(completions, t.id, cur)) {
        doneCount += 1;
      }
    }
  }

  const rate = scheduledCount === 0 ? 0 : (doneCount / scheduledCount) * 100;

  return { scheduledCount, doneCount, rate };
}

function ProgressBar(props: {
  value: number; // (role: progress percent, type: number)
}) {
  const pct = clamp(Number.isFinite(props.value) ? props.value : 0, 0, 100);

  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className="h-full rounded-full bg-emerald-400/60"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatCard(props: {
  label: string; // (role: title, type: string)
  range: string; // (role: date range label, type: string)
  doneCount: number; // (role: done, type: number)
  scheduledCount: number; // (role: scheduled, type: number)
  rate: number; // (role: percent, type: number)
}) {
  const { label, range, doneCount, scheduledCount, rate } = props;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-zinc-200">{label}</div>
        <div className="text-sm font-semibold text-zinc-100">
          {rate.toFixed(1)}%
        </div>
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div className="text-xs text-zinc-500">{range}</div>
        <div className="text-xs text-zinc-500">
          ({doneCount}/{scheduledCount})
        </div>
      </div>

      <ProgressBar value={rate} />
    </div>
  );
}

export function PeriodStatsPanel(props: {
  tasks: Task[]; // (role: all tasks, type: Task[])
  completions: Completion[]; // (role: completion logs, type: Completion[])
  todayYmd: string; // (role: today ymd, type: string)
}) {
  const { t } = useContext(LocaleContext);
  const { tasks, completions, todayYmd } = props;

  const weekStart = startOfWeekMondayYmd(todayYmd);
  const weekEnd = addDaysYmd(weekStart, 6);

  const monthStart = startOfMonthYmd(todayYmd);
  const monthEnd = todayYmd; // month-to-date

  // Current MVP definition:
  // "All time" means from earliest completion date (not from first task create date).
  const allStart = earliestCompletionYmd(completions, todayYmd);
  const allEnd = todayYmd;

  const week = calcRangeCompletion(tasks, completions, weekStart, weekEnd);
  const month = calcRangeCompletion(tasks, completions, monthStart, monthEnd);
  const all = calcRangeCompletion(tasks, completions, allStart, allEnd);

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">
          {t('common.completion')}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {t('period.basedOnScheduledVsChecked')}
        </p>
      </div>

      <div className="grid gap-2">
        <StatCard
          label={t('period.allTime')}
          range={`${allStart} ~ ${allEnd}`}
          doneCount={all.doneCount}
          scheduledCount={all.scheduledCount}
          rate={all.rate}
        />
        <StatCard
          label={t('period.thisMonth')}
          range={`${monthStart} ~ ${monthEnd}`}
          doneCount={month.doneCount}
          scheduledCount={month.scheduledCount}
          rate={month.rate}
        />
        <StatCard
          label={t('period.thisWeek')}
          range={`${weekStart} ~ ${weekEnd}`}
          doneCount={week.doneCount}
          scheduledCount={week.scheduledCount}
          rate={week.rate}
        />
      </div>
    </div>
  );
}
