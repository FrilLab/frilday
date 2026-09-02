import { useEffect } from 'react';
import type { Tab } from '../../../app/layout/HeaderTabs';
import type { Task, TaskDayState } from '../../../shared/types';

export type TimerShortcut = 'start' | 'pause' | 'finish' | 'today';

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented'
>;

export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function resolveTimerShortcut(
  event: ShortcutEvent,
  targetIsEditable: boolean,
): TimerShortcut | null {
  if (
    targetIsEditable ||
    event.defaultPrevented ||
    !event.altKey ||
    !event.shiftKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null;
  }

  switch (event.key.toLowerCase()) {
    case 's':
      return 'start';
    case 'p':
      return 'pause';
    case 'f':
      return 'finish';
    case 't':
      return 'today';
    default:
      return null;
  }
}

export function useTimerKeyboardShortcuts(props: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  todayTasks: Task[];
  taskDayStates: ReadonlyMap<string, TaskDayState>;
  runningTaskId: string | null;
  onStartTimer: (task: Task) => void;
  onPauseTimer: (task: Task) => void;
  onFinishTimer: (task: Task) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const {
    tab,
    setTab,
    todayTasks,
    taskDayStates,
    runningTaskId,
    onStartTimer,
    onPauseTimer,
    onFinishTimer,
    t,
  } = props;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveTimerShortcut(
        event,
        isEditableTarget(event.target),
      );
      if (!shortcut) return;

      event.preventDefault();

      if (shortcut === 'today') {
        setTab('today');
        window.setTimeout(() => {
          const timerControl = document.querySelector<HTMLElement>(
            '[data-timer-control="true"]:not(:disabled)',
          );
          timerControl?.focus();
        }, 0);
        return;
      }

      const runningTask = todayTasks.find((task) => task.id === runningTaskId);

      if (shortcut === 'pause') {
        if (runningTask) onPauseTimer(runningTask);
        return;
      }

      if (shortcut === 'finish') {
        if (
          runningTask &&
          window.confirm(t('note.finishConfirm', { title: runningTask.title }))
        ) {
          onFinishTimer(runningTask);
        }
        return;
      }

      if (runningTask || (tab !== 'today' && todayTasks.length === 0)) return;

      const nextTask = todayTasks.find((task) => {
        const state = taskDayStates.get(task.id);
        return state?.scheduled && !state.completed;
      });
      if (nextTask) onStartTimer(nextTask);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    tab,
    setTab,
    todayTasks,
    taskDayStates,
    runningTaskId,
    onStartTimer,
    onPauseTimer,
    onFinishTimer,
    t,
  ]);
}
