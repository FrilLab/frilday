import { useEffect } from 'react';
import { useDailyCheckStore } from '../../../app/store/useDailyCheckStore';
import { useLocale } from '../../../i18n/useLocale';
import { sendTimerDoneNotification } from '../../../infrastructure/notification';
import { getSetting } from '../../../infrastructure/tauri/store';

const TIMER_DONE_NOTIFY_KEY = 'settings.notifications.timerDone';

// 자동 종료를 위한 tick
// (role: app-wide timer tick hook, type: () => void)
export function useAutoStopTick() {
  const { t } = useLocale();

  useEffect(() => {
    const id = window.setInterval(() => {
      const finishedTaskTitles = useDailyCheckStore
        .getState()
        .autoStopIfReached({ today: new Date() });

      if (finishedTaskTitles.length === 0) return;

      void (async () => {
        const notifyEnabled = await getSetting<boolean>(
          TIMER_DONE_NOTIFY_KEY,
          true,
        );
        if (!notifyEnabled) return;

        for (const taskTitle of finishedTaskTitles) {
          await sendTimerDoneNotification({
            title: t('notify.timerDone.title'),
            body: t('notify.timerDone.body', { task: taskTitle }),
          });
        }
      })();
    }, 5000);

    return () => window.clearInterval(id);
  }, [t]);
}
