import { EN } from './en.js';
import { RU } from './ru.js';
import { ZH } from './zh.js';
import type { Locale, Messages } from './messages.js';

export * from './messages.js';

const CATALOGUE: Record<Locale, Messages> = { ru: RU, en: EN, zh: ZH };

export function messages(locale: Locale): Messages {
  return CATALOGUE[locale];
}
