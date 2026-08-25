import { z } from 'zod';
import {
  CategorySchema,
  RefBookMetaSchema,
  VerifiabilitySchema,
  verifiabilityRefinement,
} from './common.js';

/**
 * Нанесение на изделие: техники и зоны.
 *
 * Печать и вышивка — ОТДЕЛЬНЫЙ подрядчик, а не швейный цех
 * (knowledge-base/07 §3). Поэтому спецификация нанесения адресуется печатнику
 * и уходит отдельным листом, а не растворяется в конструкции.
 *
 * Ограничения бывают двух сортов, и путать их нельзя. Химия — сублимация
 * не ложится на хлопок — не подлежит согласованию ни с кем. Экономика —
 * с какого тиража выгодна шелкография — зависит от прайса подрядчика
 * и уходит в документ с пометкой «согласовать».
 */

export const PRINT_TECHNIQUES = [
  'screen',
  'dtf',
  'dtg',
  'sublimation',
  'embroidery',
  'pigment_roll',
] as const;
export const PrintTechniqueSchema = z.enum(PRINT_TECHNIQUES);
export type PrintTechnique = z.infer<typeof PrintTechniqueSchema>;

export const PRINT_FIBERS = ['cotton', 'polyester', 'blend'] as const;

/** От чего отмеряется положение макета. Словами печатник отмерить не может. */
export const PRINT_ANCHORS = ['hps', 'shoulder_seam'] as const;
export const PrintAnchorSchema = z.enum(PRINT_ANCHORS);
export type PrintAnchor = z.infer<typeof PrintAnchorSchema>;

export const PrintTechniqueEntrySchema = z
  .object({
    id: PrintTechniqueSchema,
    label_ru: z.string().min(1),
    label_en: z.string().min(1),
    fabric: z.object({
      fibers: z.array(z.enum(PRINT_FIBERS)).min(1),
      /** Краситель прозрачен: светлее фона не напечатать. */
      light_fabric_only: z.boolean(),
    }),
    colors: z.object({
      /** spot — каждый цвет отдельно; full — полноцветная печать. */
      model: z.enum(['spot', 'full']),
      /** Предел числа плашечных цветов. null для полноцветных техник. */
      max_spot_colors: z.number().int().positive().nullable(),
    }),
    setup_ru: z.string().min(1),
    /** Тираж, с которого техника становится осмысленной по деньгам. */
    economical_from_qty: z.number().int().positive(),
    /** Что чувствует рука на готовом изделии. */
    hand_feel: z.enum(['none', 'film', 'raised']),
    not_suitable_ru: z.array(z.string().min(1)).min(1),
    needs_subcontractor: z.boolean(),
    /**
     * Печатает ПОЛОТНО до раскроя, а не готовое изделие.
     *
     * Развилка, решающая судьбу сплошного раппорта: если полотно печатать
     * нельзя, раппорт наносится по готовым панелям и разойдётся на швах.
     */
    roll_capable: z.boolean(),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement)
  .superRefine((t, ctx) => {
    if (t.colors.model === 'spot' && t.colors.max_spot_colors === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'плашечная техника обязана назвать предел числа цветов',
        path: ['colors', 'max_spot_colors'],
      });
    }
  });

export const PrintZoneEntrySchema = z
  .object({
    id: z.string().min(1),
    label_ru: z.string().min(1),
    applies_to: z.array(CategorySchema).min(1),
    anchor: PrintAnchorSchema,
    typical_offset_cm: z.number().nonnegative(),
    typical_size_cm: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    seam_note_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const PrintTechniquesFileSchema = RefBookMetaSchema.extend({
  techniques: z.array(PrintTechniqueEntrySchema).length(PRINT_TECHNIQUES.length),
});

export const PrintZonesFileSchema = RefBookMetaSchema.extend({
  zones: z.array(PrintZoneEntrySchema).min(1),
});

export type PrintTechniqueEntry = z.infer<typeof PrintTechniqueEntrySchema>;
export type PrintZoneEntry = z.infer<typeof PrintZoneEntrySchema>;
export type PrintTechniquesFile = z.infer<typeof PrintTechniquesFileSchema>;
export type PrintZonesFile = z.infer<typeof PrintZonesFileSchema>;
