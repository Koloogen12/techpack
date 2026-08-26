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

/**
 * Класс посадки для условностей чертежа.
 *
 * Угол отведения рукава — функция ПОСАДКИ, а не только длины рукава:
 * у oversize и boxy рукав висит вдоль корпуса под 58–66°, у регулярной
 * посадки он отведён заметно сильнее, 30–45°. Смешивать эти диапазоны
 * нельзя — усреднённый угол неверен для обоих.
 */
export const FLAT_FIT_CLASSES = ['regular', 'oversize'] as const;
export const FlatFitClassSchema = z.enum(FLAT_FIT_CLASSES);
export type FlatFitClass = z.infer<typeof FlatFitClassSchema>;

export const SleeveAngleSchema = z
  .object({
    kind: SleeveKindSchema,
    /** Посадка, для которой верна условность. */
    fit_class: FlatFitClassSchema,
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
    /**
     * Верхняя граница диапазона конвенции.
     *
     * Нужна не движку, а проверке: реальные техпаки дают рукав в вилке,
     * и «не ниже» без «не выше» пропустило бы рукав, прижатый к корпусу
     * вплотную. Тест-бенчмарк сверяет нарисованный угол с обеими границами.
     */
    max_angle_deg: z.number().min(5).max(85),
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
export const PROPORTION_SCOPES = [
  'all',
  'short_sleeve',
  'long_sleeve',
  'cuff_rib',
  /** Пропорции капюшона: применимы только там, где он есть. */
  'hood',
  /** Пропорции пояса-рибаны: у изделия с подшитым низом их нет. */
  'waist_rib',
] as const;
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
    /**
     * Посадка, для которой верен диапазон. Пусто — верен для любой.
     *
     * Появилось вместе с набором реальных техпаков: у oversize и у регулярной
     * посадки рукав отведён по-разному, и один диапазон на обе давал бы
     * проверку, которую проходит и то и другое, то есть не проверку.
     */
    fit_class: FlatFitClassSchema.optional(),
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
  /** Доля замера H01, на которую капюшон поднимается на чертеже. */
  hood_draw_factor: z.number().positive().max(1),
  hood_draw_note_ru: z.string().min(1),
  /** Эталонные диапазоны пропорций. Проверяются тестом-бенчмарком. */
  proportions: z.array(FlatProportionSchema).min(1),
});

export type FlatConventionsFile = z.infer<typeof FlatConventionsFileSchema>;
