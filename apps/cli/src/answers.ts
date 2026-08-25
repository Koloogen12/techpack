import { z } from 'zod';
import { SpecFormError } from '@specform/core';
import { CategorySchema, FitIntentSchema, GenderSchema, FabricKindSchema } from '@specform/kb';

/**
 * Ответы мастера — файл-вход concierge-режима.
 *
 * Те же пять вопросов, что задаёт мастер в интерфейсе (ux/02, Э3 шаг 2).
 * Масштаб изделия приходит отсюда, а не из фотографий: абсолютные сантиметры
 * по снимку недостижимы (knowledge-base/03 §5.1).
 */
/**
 * Текстовое поле анкеты.
 *
 * Строка из одних пробелов формально непустая, но в документе выглядит
 * как пропуск. Обрезаем и требуем содержимое: «   » вместо названия модели
 * доезжало до обложки техпака.
 */
const text = (max = 200) => z.string().trim().min(1).max(max);

export const AnswersSchema = z
  .object({
    /** Идентификатор техпака. Задаётся снаружи ради воспроизводимости. */
    id: text(120),
    name: text(120),
    article: text(60),
    brand: text(120).optional(),
    season: text(60).optional(),
    description: z.string().trim().max(1000).optional(),

    // --- Пять вопросов мастера ---
    category: CategorySchema,
    gender: GenderSchema,
    base_size_ru: z.number().int().positive(),
    /**
     * Рост, см. Границы шире ГОСТ-ростовок намеренно: продукт не обязан
     * отказывать нетиповой фигуре. Но за ними поправка на ростовку
     * превращает изделие в бессмыслицу.
     */
    base_height_cm: z.number().min(140).max(210),
    fit_intent: FitIntentSchema,
    fabric_kind: FabricKindSchema,
    size_range: z.array(z.number().int().positive()).min(1).max(24),

    /** Тираж. Влияет только на пересчёт расхода — на замеры не влияет. */
    quantity: z.number().int().positive().optional(),

    /**
     * Макеты для нанесения. Пусто — вещь без принта, и это норма.
     * Размер и отступ необязательны: без них берутся типовые для зоны
     * и помечаются предположением, чтобы печатник видел, что их не задавали.
     */
    artwork: z
      .array(
        z.object({
          zone: text(40),
          technique: z.enum(['screen', 'dtf', 'dtg', 'sublimation', 'embroidery']).optional(),
          width_cm: z.number().positive().max(120).optional(),
          height_cm: z.number().positive().max(120).optional(),
          offset_cm: z.number().nonnegative().max(120).optional(),
          color_count: z.number().int().positive().max(24).optional(),
          color_codes: z.array(text(30)).max(24).optional(),
          file: z
            .object({
              name: text(200),
              format: text(10),
              pixels: z
                .object({
                  width: z.number().int().positive(),
                  height: z.number().int().positive(),
                })
                .optional(),
              transparent: z.boolean().optional(),
            })
            .optional(),
        }),
      )
      .max(6)
      .optional(),
    /** Светлое ли полотно. Сублимации это важно: краситель прозрачен. */
    light_fabric: z.boolean().optional(),

    /** Усилитель точности: один ручной замер калибрует весь масштаб. */
    manual: z
      .object({ code: z.string().regex(/^[A-Z]\d{2}$/), value_cm: z.number().positive() })
      .optional(),

    colorways: z
      .array(
        z.object({
          id: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]{1,24}$/, 'идентификатор цвета: латиница, цифры, дефис'),
          name_ru: text(60),
          hex_approx: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/, 'цвет в формате #RRGGBB')
            .optional(),
        }),
      )
      .max(24)
      .optional(),

    /** Профиль парка машин фабрики. По умолчанию базовый цех. */
    machine_park: z.string().optional(),

    /** Реквизиты бренда для ярлыков. Без них обязательные поля остаются пробелами. */
    brand_profile: z
      .object({
        company_name: text(200).optional(),
        inn: text(12).optional(),
        address: text(300).optional(),
        trademark: text(120).optional(),
        country: text(80).optional(),
      })
      .optional(),
  })
  .superRefine((a, ctx) => {
    if (!a.size_range.includes(a.base_size_ru)) {
      ctx.addIssue({
        code: 'custom',
        message: `базовый размер ${a.base_size_ru} обязан входить в ряд ${a.size_range.join(', ')}`,
        path: ['size_range'],
      });
    }
    const sorted = [...a.size_range].sort((x, y) => x - y);
    if (sorted.join() !== a.size_range.join()) {
      ctx.addIssue({
        code: 'custom',
        message: 'размерный ряд обязан идти по возрастанию',
        path: ['size_range'],
      });
    }

    const dupSizes = [...new Set(a.size_range.filter((ru, i) => a.size_range.indexOf(ru) !== i))];
    if (dupSizes.length) {
      ctx.addIssue({
        code: 'custom',
        message: `размеры повторяются: ${dupSizes.join(', ')}. Дубль размера даёт дубль артикула SKU`,
        path: ['size_range'],
      });
    }

    const dupColors = [...new Set((a.colorways ?? []).map((c) => c.id))];
    if (a.colorways && dupColors.length !== a.colorways.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'идентификаторы цветов повторяются — по ним строятся артикулы',
        path: ['colorways'],
      });
    }
  });

export type Answers = z.infer<typeof AnswersSchema>;

export function parseAnswers(raw: unknown): Answers {
  const parsed = AnswersSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('\n');
    throw new SpecFormError('SPEC_INVALID', `файл ответов не прошёл проверку:\n${issues}`, {
      userMessage: 'В анкете не хватает данных или они противоречат друг другу.',
      userAction: 'Проверьте поля, перечисленные ниже, и повторите',
      details: { issues },
    });
  }
  return parsed.data;
}

/**
 * Отпечаток ответов для ключа кэша vision.
 *
 * Входят только поля, влияющие на промпт и на трактовку снимков. Название,
 * артикул и сезон не входят: переименование техпака не должно приводить
 * к повторному платному разбору тех же фотографий.
 */
export function answersFingerprint(a: Answers): string {
  return [a.category, a.gender, a.base_size_ru, a.base_height_cm, a.fit_intent, a.fabric_kind].join(
    '|',
  );
}
