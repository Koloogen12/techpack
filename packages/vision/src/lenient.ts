import { z } from 'zod';
import { SeamsterError, type Logger, silentLogger } from '@seamster/core';

/**
 * Терпимый разбор ответа модели по zod-схеме.
 *
 * Структурный вывод Anthropic держит форму JSON, но НЕ перечисления: SDK
 * (helpers/zod) переписывает `enum` в подсказку внутри description, и модель
 * может ответить значением вне списка. Штатный `messages.parse` в этом
 * случае бросает исключение — и вся генерация падала из-за одной зоны
 * дизайн-признака «hood» вместо «neckline» (прод, 24.09.2026).
 *
 * Здесь чужое значение перечисления заменяется на честное «иное / не
 * видно / неизвестно» из того же списка, замена пишется в лог, и разбор
 * продолжается. Всё, что не перечисление, по-прежнему обязано сойтись.
 */
export interface LenientResult<T> {
  value: T;
  /** Пути, где значение вне списка заменено на запасное. */
  coerced: string[];
}

const FALLBACKS = ['other', 'not_visible', 'unknown', 'none'] as const;

function fallbackFor(values: readonly unknown[]): unknown {
  for (const f of FALLBACKS) if (values.includes(f)) return f;
  return values[0];
}

function setAt(root: unknown, path: readonly PropertyKey[], value: unknown): void {
  let node = root as Record<PropertyKey, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const next = node[path[i]!];
    if (typeof next !== 'object' || next === null) return;
    node = next as Record<PropertyKey, unknown>;
  }
  node[path[path.length - 1]!] = value;
}

export function parseLenient<T extends z.ZodType>(
  schema: T,
  text: string,
  logger: Logger = silentLogger,
  label = 'vision',
): LenientResult<z.infer<T>> {
  // Модель через прокси любит обернуть JSON в ограждение — берём от первой
  // скобки до последней.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw: unknown;
  try {
    raw = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch (cause) {
    throw new SeamsterError('VISION_SCHEMA_MISMATCH', `${label}: в ответе нет JSON`, {
      userMessage: 'Разбор фотографий не завершился корректно.',
      userAction: 'Повторить бесплатно. Если повторяется — напишите нам.',
      details: { cause: String(cause).slice(0, 200) },
    });
  }
  const coerced: string[] = [];
  for (let round = 0; round < 8; round++) {
    const result = schema.safeParse(raw);
    if (result.success) {
      if (coerced.length)
        logger.warn(`${label}: значения вне словаря заменены на запасные`, {
          coerced: coerced.join(', '),
        });
      return { value: result.data, coerced };
    }
    const fixable = result.error.issues.filter(
      (issue) => issue.code === 'invalid_value' && Array.isArray(issue.values),
    );
    if (!fixable.length) {
      throw new SeamsterError('VISION_SCHEMA_MISMATCH', `${label}: ответ не сошёлся со схемой`, {
        userMessage: 'Разбор фотографий не завершился корректно.',
        userAction: 'Повторить бесплатно. Если повторяется — напишите нам.',
        details: {
          issues: result.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      });
    }
    for (const issue of fixable) {
      const values = (issue as { values: readonly unknown[] }).values;
      setAt(raw, issue.path as PropertyKey[], fallbackFor(values));
      coerced.push(issue.path.join('.'));
    }
  }
  throw new SeamsterError('VISION_SCHEMA_MISMATCH', `${label}: слишком много значений вне схемы`, {
    userMessage: 'Разбор фотографий не завершился корректно.',
    userAction: 'Повторить бесплатно. Если повторяется — напишите нам.',
  });
}
