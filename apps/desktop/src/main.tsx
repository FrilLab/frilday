import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import App from './app/App.tsx';
import { LocaleProvider } from './i18n/provider.tsx';
import { appDb } from './infrastructure/tauri/db';
import { isTauri } from './infrastructure/tauri/runtime';
import { useDailyCheckStore } from './app/store/useDailyCheckStore';

type BootState = {
  ready: boolean;
};

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown initialization error';
  }
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : 'Unknown render error',
    };
  }

  componentDidCatch(error: unknown) {
    console.error('Root render failed', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
          <div className="w-full max-w-xl rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
            <h1 className="text-base font-semibold">App failed to render</h1>
            <p className="mt-2 text-sm text-zinc-300">{this.state.error}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function BootstrapApp() {
  const [boot, setBoot] = useState<BootState>({ ready: false });

  useEffect(() => {
    let alive = true;

    void (async () => {
      if (isTauri()) {
        try {
          await appDb.init();
        } catch (error) {
          const detail = formatError(error);
          console.error('App DB initialization failed', error);
          useDailyCheckStore.setState({
            errorMsg: `DB initialization failed. ${detail}`,
          });
        }
      }

      try {
        await useDailyCheckStore.getState().hydrate();
      } catch (error) {
        const detail = formatError(error);
        console.error('App bootstrap failed', error);
        useDailyCheckStore.setState({
          hydrated: true,
          errorMsg: `App bootstrap failed. ${detail}`,
        });
      }

      if (alive) {
        setBoot({ ready: true });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (!boot.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Loading data...
      </div>
    );
  }

  return (
    <RootErrorBoundary>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </RootErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootstrapApp />
  </StrictMode>,
);
