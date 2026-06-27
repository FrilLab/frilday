import { useContext } from 'react';
import type { WeekStats } from '../../../domain/stats/stats';
import { LocaleContext } from '../../../i18n/context';

interface StatsPanelProps {
  stats: WeekStats;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <span className="text-sm text-zinc-300">{label}</span>
      <span className="text-sm font-semibold text-zinc-100">{value}</span>
    </div>
  );
}

export function StatsPanel({ stats }: StatsPanelProps) {
  const { t } = useContext(LocaleContext);

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">
          {t('stats.weeklyStats')}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {t('stats.weekStart')}:{' '}
          <span className="font-medium text-zinc-200">{stats.weekStart}</span>
        </p>
      </div>

      <div className="grid gap-2">
        <StatRow
          label={t('stats.totalCompletionRate')}
          value={`${stats.totalRate.toFixed(1)}%`}
        />
        <StatRow
          label={t('stats.weekdayCompletionRate')}
          value={`${stats.weekdayRate.toFixed(1)}%`}
        />
        <StatRow
          label={t('stats.weekendCompletionRate')}
          value={`${stats.weekendRate.toFixed(1)}%`}
        />
        <StatRow
          label={t('stats.dailyCompletionRate')}
          value={`${stats.dailyRate.toFixed(1)}%`}
        />
        <StatRow
          label={t('stats.customCompletionRate')}
          value={`${stats.customRate.toFixed(1)}%`}
        />
      </div>

      <p className="mt-3 text-xs text-zinc-500">{t('stats.mvpRule')}</p>
    </div>
  );
}
