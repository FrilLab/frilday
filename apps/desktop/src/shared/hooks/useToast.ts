import { useRef, useState } from 'react';

export function useToast(durationMs: number = 2000) {
  const [toast, setToast] = useState<string | null>(null); // (role: toast message, type: string | null)
  const timerRef = useRef<number | null>(null); // (role: timeout id, type: number | null)

  const showToast = (msg: string) => {
    setToast(msg);

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, durationMs);
  };

  const clearToast = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  };

  return { toast, showToast, clearToast };
}
