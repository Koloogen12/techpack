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
export const AnswersSchema = z
  .object({
    /** Идентификатор техпака. Задаётся снаружи ради воспроизводимости. */
    id: z.string().min(1),
    name: z.string().min(1),
    article: z.string().min(1),
    brand: z.string().optional(),
    season: z.string().optional(),
    description: z.string().optional(),

    // --- Пять вопросов мастера ---
    category: CategorySchema,
    gender: GenderSchema,
    base_size_ru: z.number().int().positive(),
    base_height_cm: z.number().positive(),
    fit_intent: FitIntentSchema,
    fabric_kind: FabricKindSchema,
    size_range: z.array(z.number().int().positive()).min(1),

    /** Тираж. Влияет только на пересчёт расхода — на замеры не влияет. */
    quantity: z.number().int().positive().optional(),

    /** Усилитель точности: один ручной замер калибрует весь масштаб. */
    manual: z
      .object({ code: z.string().regex(/^[A-Z]\d{2}$/), value_cm: z.number().positive() })
      .optional(),

    colorways: z
      .array(
        z.object({
          id: z.string().min(1),
          name_ru: z.string().min(1),
          hex_approx: z.string().optional(),
        }),
      )
      .optional(),

    /** Профиль парка машин фабрики. По умолчанию базовый цех. */
    machine_park: z.string().optional(),

    /** Реквизиты бренда для ярлыков. Без них обязательные поля остаются пробелами. */
    brand_profile: z
      .object({
        company_name: z.string().optional(),
        inn: z.string().optional(),
        address: z.string().optional(),
        trademark: z.string().optional(),
        country: z.string().optional(),
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
