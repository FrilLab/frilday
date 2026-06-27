import { isTauri } from '../tauri/runtime';

export type NotifyPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  try {
    if (isTauri()) {
      const notification = await import('@tauri-apps/plugin-notification');
      const result = await notification.requestPermission();
      if (result === 'granted' || result === 'denied') return result;
      if (result === 'default') return 'prompt';
      return 'unsupported';
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }

    const result = await Notification.requestPermission();
    if (result === 'granted' || result === 'denied' || result === 'default') {
      return result === 'default' ? 'prompt' : result;
    }
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

export async function sendTimerDoneNotification(payload: {
  title: string;
  body: string;
}): Promise<void> {
  try {
    if (isTauri()) {
      const notification = await import('@tauri-apps/plugin-notification');
      await notification.sendNotification({
        title: payload.title,
        body: payload.body,
      });
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    new Notification(payload.title, { body: payload.body });
  } catch {
    // ignore notification failures
  }
}
