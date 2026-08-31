import { z } from 'zod';
import { SeamsterError } from '@seamster/core';

/**
 * Замеры реального изделия, снятые рулеткой.
 *
 * Это вход, которого продукту не хватает больше всего: без него мы знаем,
 * что документ внутренне непротиворечив, но не знаем, врёт ли он
 * в сантиметрах. Формат один и тот же для двух задач:
 *
 *  1. Калибровка справочников по голден-набору (сейчас).
 *  2. Примерки образцов и fit comments в приложении — knowledge-base/01 §4,
 *     ux/01 F9. Там же «по спеке · факт · Δ · в допуске да/нет».
 *
 * Поэтому пакет называется по домену, а не по задаче.
 */

/** Как снят замер. Разные способы дают разную достоверность. */
export const MEASURE_METHODS = ['flat_tape', 'flat_ruler', 'on_form', 'from_pattern'] as const;
export const MeasureMethodSchema = z.enum(MEASURE_METHODS);
export type MeasureMethod = z.infer<typeof MeasureMethodSchema>;

export const METHOD_LABEL_RU: Record<MeasureMethod, string> = {
  flat_tape: 'рулеткой по разложенному изделию',
  flat_ruler: 'линейкой по разложенному изделию',
  on_form: 'на манекене или на человеке',
  from_pattern: 'с лекала',
};

/**
 * Достоверность способа.
 *
 * Замер на манекене систематически больше замера по разложенному изделию:
 * полотно натянуто. Смешивать их в одной выборке значит калибровать
 * справочник по способу измерения, а не по изделию.
 */
export const METHOD_TRUST: Record<MeasureMethod, 'reference' | 'usable' | 'weak'> = {
  flat_tape: 'reference',
  flat_ruler: 'reference',
  from_pattern: 'usable',
  on_form: 'weak',
};

export const MeasuredValueSchema = z.object({
  /** Код точки из шаблона категории. */
  code: z.string().regex(/^[A-Z]\d{2}$/),
  /** Значение в сантиметрах, как записано на бланке. */
  value_cm: z.number().positive(),
  /**
   * Второй замер той же точки, если делали контрольный.
   * Расхождение между ними — оценка погрешности самого измерения.
   */
  repeat_cm: z.number().positive().optional(),
  note: z.string().trim().max(300).optional(),
});

export const MeasuredSetSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    /** Путь к фотографии того же изделия. Замеры без снимка не калибруют. */
    photo: z.string().trim().min(1),
    /** Путь к файлу ответов мастера для этого изделия. */
    answers: z.string().trim().min(1),

    /** Кто мерил. Нужен, чтобы отследить систематику конкретного человека. */
    measured_by: z.string().trim().min(1).max(120),
    measured_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: MeasureMethodSchema,

    /** Что это за вещь на самом деле — своими словами. */
    garment_note: z.string().trim().max(500).optional(),
    /** Ярлычный размер вещи, если он есть. Может не совпадать с заявленным. */
    label_size: z.string().trim().max(40).optional(),

    values: z.array(MeasuredValueSchema).min(1),
  })
  .superRefine((set, ctx) => {
    const codes = set.values.map((v) => v.code);
    const dupes = [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))];
    if (dupes.length) {
      ctx.addIssue({
        code: 'custom',
        message: `точка измерена дважды под одним кодом: ${dupes.join(', ')}`,
        path: ['values'],
      });
    }

    for (const v of set.values) {
      if (v.repeat_cm === undefined) continue;
      // Расхождение двух замеров одной точки больше двух сантиметров означает,
      // что мерили по-разному — такую пару нельзя использовать как эталон.
      if (Math.abs(v.repeat_cm - v.value_cm) > 2) {
        ctx.addIssue({
          code: 'custom',
          message:
            `точка ${v.code}: два замера расходятся на ` +
            `${Math.abs(v.repeat_cm - v.value_cm).toFixed(1)} см — перемерьте`,
          path: ['values'],
        });
      }
    }
  });

export type MeasuredValue = z.infer<typeof MeasuredValueSchema>;
export type MeasuredSet = z.infer<typeof MeasuredSetSchema>;

export function parseMeasuredSet(raw: unknown): MeasuredSet {
  const parsed = MeasuredSetSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('\n');
    throw new SeamsterError('SPEC_INVALID', `бланк замеров не прошёл проверку:\n${issues}`, {
      userMessage: 'В бланке замеров не хватает данных или они противоречат друг другу.',
      userAction: 'Проверьте поля, перечисленные ниже, и повторите',
      details: { issues },
    });
  }
  return parsed.data;
}

/** Рабочее значение точки: среднее двух замеров, если есть контрольный. */
export function effectiveValue(v: MeasuredValue): number {
  return v.repeat_cm === undefined ? v.value_cm : (v.value_cm + v.repeat_cm) / 2;
}
