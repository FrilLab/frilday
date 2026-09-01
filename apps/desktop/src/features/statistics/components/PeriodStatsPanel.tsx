import { useContext } from 'react';
import type {
  CoreRateStats,
  CoreStatistics,
} from '../../../infrastructure/tauri/core';
import { LocaleContext } from '../../../i18n/context';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function ProgressBar(props: { value: number }) {
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
  label: string;
  range: string;
  stats: CoreRateStats;
}) {
  const { label, range, stats } = props;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-zinc-200">{label}</div>
        <div className="text-sm font-semibold text-zinc-100">
          {stats.rate.toFixed(1)}%
        </div>
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div className="text-xs text-zinc-500">{range}</div>
        <div className="text-xs text-zinc-500">
          ({stats.completedCount}/{stats.scheduledCount})
        </div>
      </div>

      <ProgressBar value={stats.rate} />
    </div>
  );
}

export function PeriodStatsPanel(props: { stats: CoreStatistics }) {
  const { t } = useContext(LocaleContext);
  const { stats } = props;
  const range = (start: string, end: string) => `${start} ~ ${end}`;

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
          range={range(stats.allStartYmd, stats.todayYmd)}
          stats={stats.allTime}
        />
        <StatCard
          label={t('period.thisMonth')}
          range={range(stats.monthStartYmd, stats.todayYmd)}
          stats={stats.month}
        />
        <StatCard
          label={t('period.thisWeek')}
          range={range(stats.week.weekStart, stats.weekEndYmd)}
          stats={stats.weekRange}
        />
      </div>
    </div>
  );
}
