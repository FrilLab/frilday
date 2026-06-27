import type { NotifyLevel } from '../../domain/notifier';

// (role: toast payload, type: interface)
export interface ToastPayload {
  level: NotifyLevel; // (role: severity, type: NotifyLevel)
  message: string; // (role: message, type: string)
}

// (role: toast listener, type: (ToastPayload)=>void)
type Listener = (p: ToastPayload) => void;

// (role: in-memory pubsub, type: module state)
const listeners = new Set<Listener>();

// (role: subscribe function, type: (Listener)=>()=>void)
export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// (role: publish toast event, type: (ToastPayload)=>void)
export function publishToast(payload: ToastPayload): void {
  for (const l of listeners) l(payload);
}
