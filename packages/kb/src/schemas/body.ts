import { z } from 'zod';
import { RefBookMetaSchema, VerifiabilitySchema, verifiabilityRefinement } from './common.js';
import { GenderSchema } from './common.js';

/**
 * Сечение торса на уровне груди.
 *
 * Существует ради бокового вида чертежа и больше ни ради чего. Причина,
 * по которой справочник вообще понадобился: ГЛУБИНУ изделия не задаёт
 * ни один наш замер и не может задать. Табель мер описывает изделие
 * разложенным, а разложенное изделие плоское — в нём глубины нет.
 *
 * Поэтому глубина ВЫВОДИТСЯ, и место вывода — здесь, в справочнике
 * с источником и пометкой достоверности, а не константой в коде чертежа.
 * Число, которое нельзя проверить, обязано лежать там, где видно, что оно
 * непроверено.
 */
export const BodyRatioSchema = z
  .object({
    gender: GenderSchema,
    /**
     * Ширина торса, делённая на его глубину, на уровне груди.
     *
     * Больше единицы всегда: торс шире, чем толще. Значение около 1
     * означало бы круглое сечение, около 2 — плоское как доска.
     */
    width_to_depth: z.number().min(1).max(2),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export type BodyRatio = z.infer<typeof BodyRatioSchema>;

export const BodyCrossSectionFileSchema = RefBookMetaSchema.extend({
  ratios: z.array(BodyRatioSchema).min(1),
  /** Что именно испортится, если число неверно. Ответ на «а насколько это важно». */
  accuracy_note_ru: z.string().min(1),
});

export type BodyCrossSectionFile = z.infer<typeof BodyCrossSectionFileSchema>;
