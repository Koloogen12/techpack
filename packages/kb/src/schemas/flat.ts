import { z } from 'zod';
import { RefBookMetaSchema, VerifiabilitySchema, verifiabilityRefinement } from './common.js';

/**
 * Условности технического рисунка.
 *
 * Существует ради одной величины, которую нельзя вывести из замеров: угла
 * отведения рукава. Всё остальное на чертеже выводится, и место таким числам
 * не в коде геометрии, а здесь — с источником и пометкой достоверности,
 * чтобы было видно, что оно непроверено.
 */
export const SLEEVE_KINDS = ['short', 'long'] as const;
export const SleeveKindSchema = z.enum(SLEEVE_KINDS);
export type SleeveKind = z.infer<typeof SleeveKindSchema>;

export const SleeveAngleSchema = z
  .object({
    kind: SleeveKindSchema,
    /**
     * Ниже этого угла рукав на чертеже не опускается.
     *
     * Именно МИНИМУМ, а не заданное значение: когда замеры сами дают более
     * крутой рукав, берутся они — точная геометрия лучше условности.
     * Условность включается только там, где точная укладка нечитаема.
     */
    min_angle_deg: z.number().min(5).max(60),
    note_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export type SleeveAngle = z.infer<typeof SleeveAngleSchema>;

export const FlatConventionsFileSchema = RefBookMetaSchema.extend({
  sleeve_angles: z.array(SleeveAngleSchema).min(1),
  /** Длина рукава, с которой он считается длинным, см. */
  long_sleeve_from_cm: z.number().positive(),
  long_sleeve_note_ru: z.string().min(1),
});

export type FlatConventionsFile = z.infer<typeof FlatConventionsFileSchema>;
