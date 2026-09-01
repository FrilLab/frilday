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

  test('preserves operation results while continuing after a rejection', async () => {
    const enqueue = createSerialQueue<number>();
    const first = enqueue(async () => 1);
    const rejected = enqueue(async () => {
      throw new Error('expected failure');
    });
    const third = enqueue(async () => 3);

    expect(await first).toBe(1);
    await expect(rejected).rejects.toThrow('expected failure');
    expect(await third).toBe(3);
  });
});
