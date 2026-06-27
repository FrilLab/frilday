import { useContext, useEffect, useState } from 'react';
import type { Locale } from '../../i18n';
import { LocaleContext } from '../../i18n/context';
import { getSetting, setSetting } from '../../infrastructure/tauri/store';
import { requestNotifyPermission } from '../../infrastructure/notification';

const TIMER_DONE_NOTIFY_KEY = 'settings.notifications.timerDone';

export function SettingsPage() {
  const { locale, setLocale, t } = useContext(LocaleContext);
  const [timerDoneEnabled, setTimerDoneEnabled] = useState<boolean>(true);
  const [permissionHint, setPermissionHint] = useState<string>('');

  useEffect(() => {
    let active = true;

    void (async () => {
      const saved = await getSetting<boolean>(TIMER_DONE_NOTIFY_KEY, true);
      if (!active) return;
      setTimerDoneEnabled(Boolean(saved));
    })();

    return () => {
      active = false;
    };
  }, []);

  // (role: change handler, type: (e: React.ChangeEvent<HTMLSelectElement>)=>void)
  const onChangeLocale = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocale(e.target.value as Locale);
  };

  const onToggleTimerDoneNotify = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const next = e.target.checked;

    if (!next) {
      setPermissionHint('');
      setTimerDoneEnabled(false);
      await setSetting(TIMER_DONE_NOTIFY_KEY, false);
      return;
    }

    const permission = await requestNotifyPermission();
    if (permission === 'granted') {
      setPermissionHint('');
      setTimerDoneEnabled(true);
      await setSetting(TIMER_DONE_NOTIFY_KEY, true);
      return;
    }

    setTimerDoneEnabled(false);
    await setSetting(TIMER_DONE_NOTIFY_KEY, false);
    setPermissionHint(t('settings.notifications.timerDone.hintDenied'));
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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">
              {t('settings.notifications.timerDone.title')}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t('settings.notifications.timerDone.desc')}
            </p>
            {permissionHint && (
              <p className="mt-2 text-xs text-amber-200">{permissionHint}</p>
            )}
          </div>

          <label className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100">
            <input
              type="checkbox"
              checked={timerDoneEnabled}
              onChange={onToggleTimerDoneNotify}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-zinc-100"
            />
            <span>{timerDoneEnabled ? 'ON' : 'OFF'}</span>
          </label>
        </div>
      </section>
    </div>
  );
}
