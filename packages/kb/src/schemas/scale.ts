import { z } from 'zod';
import { RefBookMetaSchema, VerifiabilitySchema, verifiabilityRefinement } from './common.js';

/**
 * Опорные предметы известного размера.
 *
 * С одной фотографии абсолютный размер не получить — это монокулярная
 * неоднозначность масштаба, свойство оптики, а не качества разбора. Обычно
 * масштаб приходит от пользователя (размер и рост), но пользователь сообщает
 * ЗАМЫСЕЛ, а предмет в кадре даёт ФАКТ.
 *
 * Годятся только предметы, размер которых задан стандартом. «Примерно
 * с ладонь» опорой не является ни в каком приближении.
 */
export const SCALE_REFERENCES = ['a4_sheet', 'bank_card'] as const;
export const ScaleReferenceIdSchema = z.enum(SCALE_REFERENCES);
export type ScaleReferenceId = z.infer<typeof ScaleReferenceIdSchema>;

/** Какой стороной предмета мерили. */
export const SCALE_SIDES = ['long_side', 'short_side'] as const;
export const ScaleSideSchema = z.enum(SCALE_SIDES);
export type ScaleSide = z.infer<typeof ScaleSideSchema>;

export const ScaleReferenceSchema = z
  .object({
    id: ScaleReferenceIdSchema,
    label_ru: z.string().min(1),
    long_side_cm: z.number().positive(),
    short_side_cm: z.number().positive(),
    /**
     * Насколько предмету можно верить как опоре. Определяется не точностью
     * стандарта, а физическим размером: чем короче предмет, тем сильнее
     * та же ошибка определения его краёв искажает пересчёт.
     */
    trust: z.enum(['high', 'medium']),
    how_to_place_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement)
  .superRefine((r, ctx) => {
    if (r.short_side_cm >= r.long_side_cm) {
      ctx.addIssue({
        code: 'custom',
        message: 'длинная сторона обязана быть длиннее короткой',
        path: ['long_side_cm'],
      });
    }
  });

export const ScaleReferencesFileSchema = RefBookMetaSchema.extend({
  references: z.array(ScaleReferenceSchema).min(1),
});

export type ScaleReference = z.infer<typeof ScaleReferenceSchema>;
export type ScaleReferencesFile = z.infer<typeof ScaleReferencesFileSchema>;
