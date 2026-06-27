import { useContext } from 'react';
import { LocaleContext } from './context';

export function useLocale() {
  return useContext(LocaleContext);
}
