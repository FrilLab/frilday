import { useContext, useRef, useState } from 'react';
import type { Locale } from '../../i18n';
import { LocaleContext } from '../../i18n/context';
import {
  MAX_DAILY_CAPACITY_MINUTES,
  MIN_DAILY_CAPACITY_MINUTES,
} from '../../domain/schedule/weeklyTimeBudget';

export function SettingsPage(props: {
  dailyCapacityMinutes: number;
  onSetDailyCapacity: (minutes: number) => boolean;
}) {
  const { locale, setLocale, t } = useContext(LocaleContext);
  const capacityInputRef = useRef<HTMLInputElement>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  // (role: change handler, type: (e: React.ChangeEvent<HTMLSelectElement>)=>void)
  const onChangeLocale = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocale(e.target.value as Locale);
  };

  const saveCapacity = () => {
    const minutes = Number(capacityInputRef.current?.value.trim() ?? '');
    if (
      !Number.isInteger(minutes) ||
      minutes < MIN_DAILY_CAPACITY_MINUTES ||
      minutes > MAX_DAILY_CAPACITY_MINUTES
    ) {
      setCapacityError(t('settings.capacity.validation'));
      return;
    }

    if (props.onSetDailyCapacity(minutes)) {
      setCapacityError(null);
    }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto xl:p-6 md:p-4 p-2">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">
              {t('settings.language.title')}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t('settings.language.desc')}
            </p>
          </div>

          <div className="shrink-0">
            <label className="sr-only">{t('settings.language.title')}</label>

            <select
              value={locale}
              onChange={onChangeLocale}
              className="h-10 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-700">
              <option value="en">{t('settings.language.options.en')}</option>
              <option value="ko">{t('settings.language.options.ko')}</option>
              <option value="ja">{t('settings.language.options.ja')}</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">
              {t('settings.capacity.title')}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t('settings.capacity.desc')}
            </p>
          </div>

          <div className="flex shrink-0 items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              <span>{t('settings.capacity.label')}</span>
              <input
                key={props.dailyCapacityMinutes}
                type="number"
                min={MIN_DAILY_CAPACITY_MINUTES}
                max={MAX_DAILY_CAPACITY_MINUTES}
                defaultValue={props.dailyCapacityMinutes}
                ref={capacityInputRef}
                onChange={() => {
                  setCapacityError(null);
                }}
                className="h-10 w-28 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 text-right text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-700"
                aria-label={t('settings.capacity.label')}
              />
            </label>
            <button
              type="button"
              onClick={saveCapacity}
              className="h-10 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 text-sm text-emerald-100 hover:bg-emerald-300/20">
              {t('common.save')}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {t('settings.capacity.range')}
        </p>
        {capacityError && (
          <p className="mt-2 text-xs text-rose-300" role="alert">
            {capacityError}
          </p>
        )}
      </section>

    </div>
  );
}
