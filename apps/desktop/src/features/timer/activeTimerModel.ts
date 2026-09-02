import type { TimeEntry } from '../../shared/types';

export type ActiveTimerPhase = 'ready' | 'running' | 'paused' | 'finished';

export type ActiveTimerStatus =
  | 'ready'
  | 'running'
  | 'paused'
  | 'overtime'
  | 'finished';

export interface ActiveTimerViewModel {
  status: ActiveTimerStatus;
  plannedSeconds: number;
  actualSeconds: number;
  remainingSeconds: number;
  overtimeSeconds: number;
  progressRatio: number;
  targetReached: boolean;
  displaySeconds: number;
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Derive the execution-facing timer state from application state.
 *
 * `actualElapsedSeconds` is intentionally an input rather than a counter
 * owned by the component. Callers can derive it from persisted timestamps,
 * which keeps a render tick from becoming a source of timing drift.
 */
export function getActiveTimerViewModel(input: {
  phase: ActiveTimerPhase;
  plannedMinutes: number;
  actualElapsedSeconds: number;
}): ActiveTimerViewModel {
  const plannedSeconds = Math.floor(
    nonNegativeFinite(input.plannedMinutes) * 60,
  );
  const actualSeconds = Math.floor(
    nonNegativeFinite(input.actualElapsedSeconds),
  );
  const targetReached = plannedSeconds > 0 && actualSeconds >= plannedSeconds;
  const remainingSeconds = Math.max(plannedSeconds - actualSeconds, 0);
  const overtimeSeconds = Math.max(actualSeconds - plannedSeconds, 0);
  const status: ActiveTimerStatus =
    input.phase === 'running' && targetReached ? 'overtime' : input.phase;

  return {
    status,
    plannedSeconds,
    actualSeconds,
    remainingSeconds,
    overtimeSeconds,
    progressRatio:
      plannedSeconds > 0
        ? Math.min(actualSeconds / plannedSeconds, 1)
        : 0,
    targetReached,
    displaySeconds:
      status === 'ready'
        ? plannedSeconds
        : status === 'overtime' || (status === 'paused' && targetReached)
          ? overtimeSeconds
          : status === 'finished'
            ? actualSeconds
            : remainingSeconds,
  };
}

/**
 * Calculate tracked time from durable session state. Running entries use the
 * supplied wall-clock timestamp and are never incremented by render count;
 * paused time is excluded because a paused entry has no active segment.
 */
export function getTrackedElapsedSeconds(
  entries: readonly TimeEntry[],
  taskId: string,
  nowIso: string,
  dateYmd?: string,
): number {
  const nowMillis = new Date(nowIso).getTime();
  let elapsedMillis = 0;

  for (const entry of entries) {
    if (entry.taskId !== taskId) continue;
    if (
      dateYmd != null &&
      entry.date !== dateYmd &&
      entry.endedAt != null
    ) {
      continue;
    }

    const startedMillis = new Date(entry.startedAt).getTime();
    if (!Number.isFinite(startedMillis)) {
      continue;
    }

    const persistedMillis = Number(entry.accumulatedMillis);
    const accumulatedMillis = Number.isFinite(persistedMillis)
      ? Math.max(0, persistedMillis)
      : 0;

    if (entry.endedAt != null) {
      const endedMillis = new Date(entry.endedAt).getTime();
      if (!Number.isFinite(endedMillis)) continue;

      // Entries written before durable lifecycle fields were introduced have
      // zero accumulatedMillis. Recover their exact duration from timestamps.
      elapsedMillis +=
        accumulatedMillis > 0
          ? accumulatedMillis
          : Math.max(0, endedMillis - startedMillis);
      continue;
    }

    if (entry.pausedAt != null) {
      elapsedMillis += accumulatedMillis;
      continue;
    }

    const activeStartedMillis = entry.activeStartedAt
      ? new Date(entry.activeStartedAt).getTime()
      : startedMillis;
    if (!Number.isFinite(activeStartedMillis)) continue;
    const currentMillis = Number.isFinite(nowMillis) ? nowMillis : activeStartedMillis;
    elapsedMillis +=
      accumulatedMillis + Math.max(0, currentMillis - activeStartedMillis);
  }

  return Math.floor(elapsedMillis / 1000);
}
