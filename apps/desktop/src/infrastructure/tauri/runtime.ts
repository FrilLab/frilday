export function isTauri(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtime = globalThis as typeof globalThis & {
    isTauri?: boolean;
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return Boolean(runtime.isTauri || runtime.__TAURI__ || runtime.__TAURI_INTERNALS__);
}
