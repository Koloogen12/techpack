import { z } from 'zod';

/**
 * Общая обвязка любого справочника.
 *
 * Принцип CTO-SPEC.md §1.7: справочники — это код. Они версионируются в репо
 * и меняются через PR с описанием причины (ошибка QA, фидбек фабрики).
 * Петля обучения продукта работает без ML-тренинга.
 */
export const RefBookMetaSchema = z.object({
  /** Идентификатор справочника, совпадает с именем файла. */
  id: z.string().min(1),
  /** Semver. Ломающее изменение структуры — мажор. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  /**
   * Откуда взяты данные. Минимум один источник — файл базы знаний или URL.
   * Справочник без источника не грузится.
   */
  sources: z.array(z.string().min(1)).min(1),
});

/**
 * Метка достоверности записи.
 *
 * `verified: false` означает: значение перенесено из базы знаний с пометкой ★/⚠️
 * либо является экспертной оценкой — то есть подлежит калибровке по результатам
 * отшивов и интервью с технологами (CTO-SPEC.md §5, риск «KB-значения дают брак»).
 *
 * Приоритет верификации — по частоте использования значения.
 */
export const VerifiabilitySchema = z.object({
  verified: z.boolean(),
  /** Адрес источника: файл базы знаний с якорем секции или URL. */
  source: z.string().min(1),
  /** Почему не проверено и что нужно, чтобы проверить. Обязательно при verified: false. */
  gap: z.string().optional(),
});

export type Verifiability = z.infer<typeof VerifiabilitySchema>;

/** Непроверенная запись обязана объяснять, чего ей не хватает. */
export const verifiabilityRefinement = <T extends Verifiability>(v: T, ctx: z.RefinementCtx) => {
  if (!v.verified && !v.gap) {
    ctx.addIssue({
      code: 'custom',
      message: 'verified: false требует поля gap — что именно нужно, чтобы проверить значение',
      path: ['gap'],
    });
  }
};

/** Диапазон правдоподобия. Используется для клэмпа значений POM-движком. */
export const RangeSchema = z
  .object({ min: z.number(), max: z.number() })
  .refine((r) => r.min <= r.max, { message: 'min не может быть больше max' });

export type Range = z.infer<typeof RangeSchema>;

/** Класс материала верхнего уровня. Определяет допуски, градацию и набор узлов. */
export const FabricKindSchema = z.enum(['knit', 'woven']);
export type FabricKind = z.infer<typeof FabricKindSchema>;

/** Категории трикотажного ядра MVP. Всё остальное гейтится честным отказом. */
export const CategorySchema = z.enum(['tshirt', 'longsleeve', 'sweatshirt', 'hoodie']);
export type Category = z.infer<typeof CategorySchema>;

export const CATEGORIES: readonly Category[] = ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'];

export const CATEGORY_LABEL_RU: Record<Category, string> = {
  tshirt: 'футболка',
  longsleeve: 'лонгслив',
  sweatshirt: 'свитшот',
  hoodie: 'худи',
};

/** Силуэт / посадка. Спрашивается у пользователя в мастере, определяет прибавку. */
export const FitIntentSchema = z.enum(['fitted', 'semi_fitted', 'loose', 'oversize']);
export type FitIntent = z.infer<typeof FitIntentSchema>;

export const FIT_INTENT_LABEL_RU: Record<FitIntent, string> = {
  fitted: 'прилегающая',
  semi_fitted: 'обычная',
  loose: 'свободная',
  oversize: 'oversize',
};

export const GenderSchema = z.enum(['women', 'men']);
export type Gender = z.infer<typeof GenderSchema>;
