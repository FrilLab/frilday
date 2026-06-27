import { createContext } from 'react';
import type { Locale } from './messages';

export type TranslateParams = Record<string, string | number>;

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslateParams) => string;
}

export const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});
