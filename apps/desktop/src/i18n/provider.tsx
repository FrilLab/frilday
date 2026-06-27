import React, { useEffect, useMemo, useState } from 'react';
import type { Locale } from './messages';
import { LocaleContext } from './context';
import { translate } from './translate';
import { getSetting, setSetting } from '../infrastructure/tauri/store';

// (role: safe locale parser, type: (unknown)=>Locale)
function parseLocale(value: unknown): Locale {
  if (value === 'en' || value === 'ko' || value === 'ja') return value;
  return 'en';
}

export function LocaleProvider(props: {
  children: React.ReactNode; // (role: subtree, type: React.ReactNode)
}) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [localeLoaded, setLocaleLoaded] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const next = parseLocale(await getSetting<Locale>('locale', 'en'));
      if (alive) {
        setLocaleState(next);
        setLocaleLoaded(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // (role: set locale and persist, type: (Locale)=>void)
  const setLocale = (next: Locale) => {
    setLocaleState(next);
  };

  useEffect(() => {
    if (!localeLoaded) return;

    void setSetting('locale', locale).catch(() => {
      // ignore persistence failure
    });
  }, [locale, localeLoaded]);

  const t = useMemo(() => {
    return (key: string, params?: Record<string, string | number>) =>
      translate(locale, key, params);
  }, [locale]);

  // value 객체가 매 렌더마다 바뀌지 않게 메모이즈 (불필요한 re-render 감소)
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return (
    <LocaleContext.Provider value={value}>
      {props.children}
    </LocaleContext.Provider>
  );
}
