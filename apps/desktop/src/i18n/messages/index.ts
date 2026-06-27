import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';

export const messages = {
  en,
  ko,
  ja,
} as const;

export type Locale = keyof typeof messages;
