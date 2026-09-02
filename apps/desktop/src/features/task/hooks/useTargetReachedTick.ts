import { useEffect, useRef } from 'react';
import { useFrilDayStore } from '../../../app/store/useFrilDayStore';
import { getNotifier } from '../../../app/di/notifierDI';
import { useLocale } from '../../../i18n/useLocale';
import {
  platformNotifications,
  platformSettings,
} from '../../../infrastructure/platform';

const TIMER_DONE_NOTIFY_KEY = 'settings.notifications.timerDone';

// Target feedback is a polling fallback for backgrounded/sleeping windows. It
// observes durable timestamps; it never changes session or completion state.
export function useTargetReachedTick() {
  const { t } = useLocale();
  const hasRunningSession = useFrilDayStore((state) =>
    state.timeEntries.some((timeEntry) => timeEntry.endedAt == null),
  );
  const notifiedSessionIds = useRef(new Set<string>());
  const inFlight = useRef(false);

  useEffect(() => {
    if (!hasRunningSession) return;

    let active = true;

    const check = async () => {
      if (!active || inFlight.current) return;
      inFlight.current = true;

      try {
        const reachedTasks = await useFrilDayStore
          .getState()
          .checkTargetReached();

        for (const reachedTask of reachedTasks) {
          if (!active || notifiedSessionIds.current.has(reachedTask.sessionId)) {
            continue;
          }

          // Mark before sending so a slow/failing platform notification cannot
          // cause the same session to fire repeatedly on the next tick.
          notifiedSessionIds.current.add(reachedTask.sessionId);
          getNotifier().notify({
            level: 'warning',
            message: t('notify.targetReached.body', {
              task: reachedTask.title,
            }),
          });

          try {
            const notifyEnabled = await platformSettings.get<boolean>(
              TIMER_DONE_NOTIFY_KEY,
              true,
            );
            if (!notifyEnabled || !active) continue;

            await platformNotifications.sendTimerDone({
              title: t('notify.targetReached.title'),
              body: t('notify.targetReached.body', {
                task: reachedTask.title,
              }),
            });
          } catch {
            // Native permission and delivery failures must not affect tracking.
          }
        }
      } finally {
        inFlight.current = false;
      }
    };

    void check();
    const id = window.setInterval(() => void check(), 1000);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [hasRunningSession, t]);
}
