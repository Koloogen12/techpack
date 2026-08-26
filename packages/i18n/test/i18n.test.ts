import { describe, expect, it } from 'vitest';
import { LOCALES, messages, type Messages } from '../src/index.js';

/**
 * Словарь проверяется не на «переведено красиво», а на «переведено ЦЕЛИКОМ
 * и не по-русски». Половина подписей на незнакомом языке заставит фабрику
 * написать письмо и ждать ответа — цикл размещения заказа удлинится на сутки.
 */

const KEYS = Object.keys(messages('ru')) as (keyof Messages)[];

describe('словарь документа', () => {
  it.each(LOCALES)('%s заполнен целиком', (locale) => {
    const m = messages(locale);
    for (const key of KEYS) {
      const value = m[key];
      if (typeof value === 'function') continue;
      // Оговорка о переводе пуста только у русского: он не перевод.
      if (key === 'translation_notice' || key === 'translation_verified_notice') continue;
      expect(value, `${locale}.${String(key)}`).toBeTruthy();
    }
  });

  it.each(['en', 'zh'] as const)('в %s не осталось кириллицы', (locale) => {
    const m = messages(locale);
    for (const key of KEYS) {
      const value = m[key];
      if (typeof value !== 'string') continue;
      // Единственное исключение — оговорка о переводе: она ссылается
      // на русский оригинал по имени.
      if (key === 'translation_notice') continue;
      expect(/[а-яА-ЯёЁ]/.test(value), `${locale}.${String(key)}: ${value}`).toBe(false);
    }
  });

  it('в китайском есть иероглифы, а не транслитерация', () => {
    const m = messages('zh');
    expect(/[一-鿿]/.test(m.section_measurements)).toBe(true);
    expect(/[一-鿿]/.test(m.pom_how)).toBe(true);
  });

  it('нумерация листов согласована в каждом языке', () => {
    expect(messages('ru').sheet_of(2, 7)).toBe('Лист 2 из 7');
    expect(messages('en').sheet_of(2, 7)).toBe('Sheet 2 of 7');
    expect(messages('zh').sheet_of(2, 7)).toContain('7');
  });

  it('нерусский комплект несёт оговорку о переводе, русский — нет', () => {
    // Иначе фабрика примет наши формулировки за выверенные и померяет
    // по ним, а мы узнаем об этом на приёмке партии.
    expect(messages('ru').translation_notice).toBe('');
    expect(messages('en').translation_notice.length).toBeGreaterThan(50);
    expect(messages('zh').translation_notice.length).toBeGreaterThan(20);
  });
});
