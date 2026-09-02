import { describe, expect, test } from 'bun:test';
import { resolveTimerShortcut } from '../src/features/task/hooks/useTimerKeyboardShortcuts';

function event(
  key: string,
  overrides: Partial<KeyboardEvent> = {},
): Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented'
> {
  return {
    key,
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...overrides,
  };
}

describe('timer keyboard shortcuts', () => {
  test('maps the documented guarded shortcuts', () => {
    expect(resolveTimerShortcut(event('s'), false)).toBe('start');
    expect(resolveTimerShortcut(event('P'), false)).toBe('pause');
    expect(resolveTimerShortcut(event('f'), false)).toBe('finish');
    expect(resolveTimerShortcut(event('t'), false)).toBe('today');
  });

  test('does not intercept normal typing or unrelated modifier combinations', () => {
    expect(resolveTimerShortcut(event('s'), true)).toBeNull();
    expect(resolveTimerShortcut(event('s', { shiftKey: false }), false)).toBeNull();
    expect(resolveTimerShortcut(event('s', { ctrlKey: true }), false)).toBeNull();
    expect(resolveTimerShortcut(event('x'), false)).toBeNull();
  });
});
