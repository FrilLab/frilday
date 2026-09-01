import { describe, expect, test } from 'bun:test';
import { createSerialQueue } from '../src/shared/utils/serialQueue';

describe('serial async queue', () => {
  test('starts each operation after the previous one resolves', async () => {
    const enqueue = createSerialQueue();
    const state: string[] = [];
    let signalFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondObservedState: string[] = [];

    const first = enqueue(async () => {
      signalFirstStarted();
      await firstReleased;
      state.push('first');
    });
    const second = enqueue(async () => {
      secondObservedState = [...state];
      state.push('second');
    });

    await firstStarted;
    expect(secondObservedState).toEqual([]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(secondObservedState).toEqual(['first']);
    expect(state).toEqual(['first', 'second']);
  });
});
