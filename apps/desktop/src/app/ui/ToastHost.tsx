import { useEffect, useState } from 'react';
import type { NotifyLevel } from '../../domain/notifier';
import { subscribeToast } from '../../infrastructure/notification/ToastBus';

// (role: toast view model, type: interface)
interface ToastVM {
  id: string; // (role: unique id, type: string)
  level: NotifyLevel; // (role: level, type: NotifyLevel)
  message: string; // (role: message, type: string)
}

// (role: id generator, type: () => string)
function uid(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function ToastHost(props: {
  durationMs?: number; // (role: auto hide, type: number | undefined)
}) {
  const durationMs = props.durationMs ?? 2000;

  const [toast, setToast] = useState<ToastVM | null>(null);

  useEffect(() => {
    const unsub = subscribeToast((p) => {
      const item: ToastVM = { id: uid(), level: p.level, message: p.message };
      setToast(item);

      window.setTimeout(() => {
        setToast((cur) => (cur?.id === item.id ? null : cur));
      }, durationMs);
    });

    return unsub;
  }, [durationMs]);

  if (!toast) return null;

  // level별 스타일은 최소로만(원하면 더 세분화 가능)
  const border =
    toast.level === 'error'
      ? 'border-red-400/30'
      : toast.level === 'warning'
        ? 'border-amber-400/30'
        : toast.level === 'success'
          ? 'border-emerald-400/30'
          : 'border-zinc-800';

  const bg =
    toast.level === 'error'
      ? 'bg-red-400/10'
      : toast.level === 'warning'
        ? 'bg-amber-400/10'
        : toast.level === 'success'
          ? 'bg-emerald-400/10'
          : 'bg-zinc-950/90';

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2">
      <div
        className={[
          'rounded-2xl border px-4 py-3 text-sm text-zinc-100 shadow-lg backdrop-blur',
          border,
          bg,
        ].join(' ')}>
        {toast.message}
      </div>
    </div>
  );
}
