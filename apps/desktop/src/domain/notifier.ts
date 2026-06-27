// (role: notification level, type: union)
export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';

// (role: notifier contract, type: interface)
export interface Notifier {
  notify: (input: {
    level: NotifyLevel; // (role: severity level, type: NotifyLevel)
    message: string; // (role: user-facing message, type: string)
    meta?: Record<string, unknown>; // (role: optional metadata, type: Record<string, unknown> | undefined)
  }) => void;
}
