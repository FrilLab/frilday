import { messages, type Locale } from './messages';
import type { TranslateParams } from './context';

export function translate(
  locale: Locale,
  key: string,
  params?: TranslateParams,
): string {
  const parts = key.split('.');

  let obj: unknown = messages[locale];

  for (const p of parts) {
    if (obj && typeof obj === 'object') {
      obj = (obj as Record<string, unknown>)[p];
    } else {
      obj = undefined;
    }
  }

  if (typeof obj !== 'string') return key;
  if (!params) return obj;

  return obj.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const value = params[name];
    return value == null ? match : String(value);
  });
}
