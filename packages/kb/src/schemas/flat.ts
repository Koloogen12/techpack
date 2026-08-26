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
     *
     * Потолок 80°, а не 60°: замер профессиональных флэтов показал, что
     * длинный рукав на них висит ВДОЛЬ корпуса, под 59–77° к горизонтали,
     * а не отведён в сторону. Прежний потолок физически запрещал нарисовать
     * то, что делает отрасль.
     */
    min_angle_deg: z.number().min(5).max(80),
    note_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export type SleeveAngle = z.infer<typeof SleeveAngleSchema>;

/**
 * К чему относится пропорция.
 *
 * Перечисление намеренно КОРОТКОЕ: сюда попадает только то, для чего нашёлся
 * источник. Капюшона и рибаны здесь нет не по недосмотру — ни один блэнк-бренд
 * не публикует их размеров (то же отраслевое молчание зафиксировано
 * в grading_increments.json). Значение появится вместе с источником.
 *
 * `cuff_rib` отделён от `long_sleeve` потому, что низ рукава с манжетой
 * и подшитый низ — разные величины: манжета стягивает рукав вдвое.
 */
export const PROPORTION_SCOPES = ['all', 'short_sleeve', 'long_sleeve', 'cuff_rib'] as const;
export const ProportionScopeSchema = z.enum(PROPORTION_SCOPES);
export type ProportionScope = z.infer<typeof ProportionScopeSchema>;

/**
 * Диапазон пропорции технического чертежа — эталон, с которым сверяется
 * построенная геометрия.
 *
 * Зачем данными, а не константами в тесте: у каждой величины есть ИСТОЧНИК
 * и метка достоверности. Число, вбитое в тест, невозможно оспорить — через
 * полгода никто не скажет, откуда взялись «0.55–0.75» и мерил ли их кто-нибудь.
 * Здесь же видно, что подтверждено размерными таблицами брендов, что снято
 * с профессиональных флэтов, а что осталось экспертной оценкой.
 */
export const FlatProportionSchema = z
  .object({
    id: z.string().min(1),
    label_ru: z.string().min(1),
    scope: ProportionScopeSchema,
    min: z.number(),
    max: z.number(),
    /** Как величина снимается с чертежа. Без этого диапазон нечем проверить. */
    how_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine((v, ctx) => {
    verifiabilityRefinement(v, ctx);
    if (v.min > v.max) {
      ctx.addIssue({ code: 'custom', message: 'min не может быть больше max', path: ['min'] });
    }
  });

export type FlatProportion = z.infer<typeof FlatProportionSchema>;

export const FlatConventionsFileSchema = RefBookMetaSchema.extend({
  sleeve_angles: z.array(SleeveAngleSchema).min(1),
  /** Длина рукава, с которой он считается длинным, см. */
  long_sleeve_from_cm: z.number().positive(),
  long_sleeve_note_ru: z.string().min(1),
  /** Эталонные диапазоны пропорций. Проверяются тестом-бенчмарком. */
  proportions: z.array(FlatProportionSchema).min(1),
});

export type FlatConventionsFile = z.infer<typeof FlatConventionsFileSchema>;
