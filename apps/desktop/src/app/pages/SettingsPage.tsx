import { useContext } from 'react';
import type { Locale } from '../../i18n';
import { LocaleContext } from '../../i18n/context';

export function SettingsPage() {
  const { locale, setLocale, t } = useContext(LocaleContext);

  // (role: change handler, type: (e: React.ChangeEvent<HTMLSelectElement>)=>void)
  const onChangeLocale = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocale(e.target.value as Locale);
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

    </div>
  );
}
