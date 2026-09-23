import { useContext, useEffect, useRef, useState } from 'react';
import type { Locale } from '../../i18n';
import { LocaleContext } from '../../i18n/context';
import {
  MAX_DAILY_CAPACITY_MINUTES,
  MIN_DAILY_CAPACITY_MINUTES,
} from '../../domain/schedule/weeklyTimeBudget';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleCalendarState,
  importGoogleCalendarEvents,
  refreshGoogleCalendars,
  saveGoogleCalendarSelection,
  type GoogleCalendarViewState,
} from '../../infrastructure/tauri/googleCalendar';
import { toYmd } from '../../shared/utils/date';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Google Calendar integration failed.';
}

function GoogleCalendarSettings() {
  const { t } = useContext(LocaleContext);
  const [state, setState] = useState<GoogleCalendarViewState | null>(null);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void getGoogleCalendarState()
      .then((nextState) => {
        if (!current) return;
        setState(nextState);
        setSelectedCalendarIds(nextState.selectedCalendarIds);
      })
      .catch((nextError: unknown) => {
        if (current) setError(errorMessage(nextError));
      });

    return () => {
      current = false;
    };
  }, []);

  const applyState = (nextState: GoogleCalendarViewState) => {
    setState(nextState);
    setSelectedCalendarIds(nextState.selectedCalendarIds);
  };

  const runAction = async (
    action: string,
    operation: () => Promise<GoogleCalendarViewState>,
  ) => {
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      applyState(await operation());
      if (action === 'save') setNotice(t('settings.googleCalendar.saved'));
    } catch (actionError: unknown) {
      setError(errorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleCalendar = (calendarId: string) => {
    setSelectedCalendarIds((current) =>
      current.includes(calendarId)
        ? current.filter((id) => id !== calendarId)
        : [...current, calendarId],
    );
    setNotice(null);
    setError(null);
  };

  const selectionDirty =
    state != null &&
    [...selectedCalendarIds].sort().join('\u0000') !==
      [...state.selectedCalendarIds].sort().join('\u0000');

  const busyLabel =
    busyAction === 'sync'
      ? t('settings.googleCalendar.syncing')
      : busyAction === 'refresh'
        ? t('settings.googleCalendar.refreshing')
        : busyAction === 'connect'
          ? t('settings.googleCalendar.connecting')
          : busyAction === 'disconnect'
            ? t('settings.googleCalendar.disconnecting')
            : busyAction === 'save'
              ? t('settings.googleCalendar.saving')
              : null;

  const saveSelection = () => {
    if (selectedCalendarIds.length === 0) {
      setError(t('settings.googleCalendar.selectAtLeastOne'));
      return;
    }
    void runAction('save', () =>
      saveGoogleCalendarSelection(selectedCalendarIds),
    );
  };

  const syncNow = async () => {
    if (!state?.connected || selectedCalendarIds.length === 0) return;
    setBusyAction('sync');
    setError(null);
    setNotice(null);
    try {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 90);
      end.setDate(end.getDate() + 365);
      const result = await importGoogleCalendarEvents(toYmd(start), toYmd(end));
      applyState(await getGoogleCalendarState());
      setNotice(
        t('settings.googleCalendar.syncComplete', {
          imported: result.importedEventCount,
          removed: result.removedEventCount,
        }),
      );
    } catch (syncError: unknown) {
      setError(errorMessage(syncError));
      try {
        applyState(await getGoogleCalendarState());
      } catch {
        // Preserve the actionable sync error when the state refresh also fails.
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-100">
            {t('settings.googleCalendar.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            {t('settings.googleCalendar.desc')}
          </p>
        </div>

        {state && !state.connected && (
          <button
            type="button"
            disabled={busyAction !== null || !state.clientConfigured}
            onClick={() => void runAction('connect', connectGoogleCalendar)}
            className="h-10 rounded-xl border border-sky-300/30 bg-sky-300/10 px-3 text-sm text-sky-100 hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50">
            {state.reauthorizationRequired
              ? t('settings.googleCalendar.reconnect')
              : t('settings.googleCalendar.connect')}
          </button>
        )}
      </div>

      {!state && !error && (
        <p className="mt-4 text-sm text-zinc-500">
          {t('settings.googleCalendar.loading')}
        </p>
      )}

      {state && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`rounded-full px-2.5 py-1 text-xs ${
                state.connected
                  ? 'bg-emerald-300/10 text-emerald-200'
                  : state.reauthorizationRequired
                    ? 'bg-amber-300/10 text-amber-200'
                    : 'bg-zinc-800 text-zinc-400'
              }`}>
              {state.connected
                ? t('settings.googleCalendar.connected')
                : state.reauthorizationRequired
                  ? t('settings.googleCalendar.reauthorizationRequired')
                  : t('settings.googleCalendar.disconnected')}
            </span>
            <span className="text-xs text-zinc-500">
              {t('settings.googleCalendar.scope')}
            </span>
          </div>

          {!state.clientConfigured && (
            <p className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
              {t('settings.googleCalendar.clientSetup')}
            </p>
          )}

          {(state.connected || state.reauthorizationRequired) && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyAction !== null || !state.connected}
                onClick={() =>
                  void runAction('refresh', refreshGoogleCalendars)
                }
                className="h-9 rounded-xl border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
                {t('settings.googleCalendar.refresh')}
              </button>
              <button
                type="button"
                disabled={
                  busyAction !== null ||
                  !state.connected ||
                  selectedCalendarIds.length === 0 ||
                  selectionDirty
                }
                onClick={() => void syncNow()}
                className="h-9 rounded-xl border border-sky-300/30 bg-sky-300/10 px-3 text-sm text-sky-100 hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50">
                {busyAction === 'sync'
                  ? t('settings.googleCalendar.syncing')
                  : t('settings.googleCalendar.syncNow')}
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  void runAction('disconnect', disconnectGoogleCalendar)
                }
                className="h-9 rounded-xl border border-rose-300/20 px-3 text-sm text-rose-200 hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-50">
                {t('settings.googleCalendar.disconnect')}
              </button>
            </div>
          )}

          {state.connected && state.calendars.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-200">
                  {t('settings.googleCalendar.calendars')}
                </p>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={saveSelection}
                  className="h-9 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 text-sm text-emerald-100 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-50">
                  {t('common.save')}
                </button>
              </div>
              <div className="space-y-2">
                {state.calendars.map((calendar) => (
                  <label
                    key={calendar.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-3 hover:border-zinc-700">
                    <input
                      type="checkbox"
                      checked={selectedCalendarIds.includes(calendar.id)}
                      onChange={() => toggleCalendar(calendar.id)}
                      className="mt-0.5 accent-sky-400"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-zinc-100">
                        {calendar.summary}
                        {calendar.primary && (
                          <span className="ml-2 text-xs text-zinc-500">
                            {t('settings.googleCalendar.primary')}
                          </span>
                        )}
                      </span>
                      {calendar.description && (
                        <span className="mt-1 block truncate text-xs text-zinc-500">
                          {calendar.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {state.connected && state.calendars.length === 0 && (
            <p className="text-sm text-zinc-500">
              {t('settings.googleCalendar.noCalendars')}
            </p>
          )}

          {(state.lastSyncAt || state.lastSyncError || state.connected) && (
            <div className="space-y-1 text-xs">
              {state.lastSyncAt && (
                <p className="text-zinc-500">
                  {t('settings.googleCalendar.lastSync')}{' '}
                  {new Date(state.lastSyncAt).toLocaleString()}
                </p>
              )}
              {!state.lastSyncAt && state.connected && !state.lastSyncError && (
                <p className="text-zinc-500">
                  {t('settings.googleCalendar.neverSynced')}
                </p>
              )}
              {state.lastSyncError && (
                <p className="text-amber-200">
                  {t('settings.googleCalendar.lastSyncError')}: {state.lastSyncError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}
      {busyLabel && (
        <p className="mt-3 text-sm text-sky-200" aria-live="polite">
          {busyLabel}
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-emerald-300">{notice}</p>}
    </section>
  );
}

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

      <GoogleCalendarSettings />

    </div>
  );
}
