import type { Notifier } from '../../domain/notifier';

// (role: DI container for notifier, type: module state)
let notifier: Notifier | null = null;

// (role: set notifier dependency, type: (Notifier) => void)
export function setNotifier(next: Notifier): void {
  notifier = next;
}

// (role: get notifier dependency, type: () => Notifier)
export function getNotifier(): Notifier {
  if (!notifier) {
    // 개발 중 실수 방지: bootstrap을 빼먹으면 즉시 알 수 있게
    throw new Error(
      'Notifier is not initialized. Call initNotifier() in App bootstrap.',
    );
  }
  return notifier;
}
