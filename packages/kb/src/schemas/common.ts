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
  /**
   * Чем именно подтверждено значение. Обязательно при verified: true.
   *
   * Флаг «проверено» без объяснения нечем оспорить: через полгода никто
   * не вспомнит, что именно сошлось, и поднятый флаг станет неотличим
   * от забытого. Симметрично полю gap.
   */
  note_ru: z.string().optional(),
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
  if (v.verified && !v.note_ru) {
    ctx.addIssue({
      code: 'custom',
      message: 'verified: true требует поля note_ru — чем именно значение подтверждено',
      path: ['note_ru'],
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

/**
 * Категории трикотажа. Всё остальное гейтится честным отказом.
 *
 * Порядок расширения задан рынком, а не удобством кода: худи на молнии и
 * поло держат 13 и 8 фабрик-контрактников из четырнадцати опрошенных,
 * а поло — единственная растущая категория верха (Lamoda, +80% за год).
 * Ткань (брюки, рубашка, юбка) сюда не входит: у неё вдвое жёстче допуски,
 * своя таблица прибавок и полсотни разделов конструкции вместо тринадцати.
 */
export const CategorySchema = z.enum([
  'tshirt',
  'longsleeve',
  'sweatshirt',
  'hoodie',
  'zip_hoodie',
  'polo',
  'tank_top',
]);
export type Category = z.infer<typeof CategorySchema>;

export const CATEGORIES: readonly Category[] = [
  'tshirt',
  'longsleeve',
  'sweatshirt',
  'hoodie',
  'zip_hoodie',
  'polo',
  'tank_top',
];

export const CATEGORY_LABEL_RU: Record<Category, string> = {
  tshirt: 'футболка',
  longsleeve: 'лонгслив',
  sweatshirt: 'свитшот',
  hoodie: 'худи',
  zip_hoodie: 'худи на молнии',
  polo: 'поло',
  tank_top: 'майка',
};

/**
 * Те же названия на языках экспорта.
 *
 * Отдельными картами, а не полем в справочнике: это ЗАМКНУТЫЕ перечисления,
 * и запись в карте обязана появиться вместе с новым значением перечисления —
 * иначе TypeScript не соберёт проект. Забыть перевод категории нельзя
 * по устройству.
 */
export const CATEGORY_LABEL_EN: Record<Category, string> = {
  tshirt: 't-shirt',
  longsleeve: 'long sleeve tee',
  sweatshirt: 'sweatshirt',
  hoodie: 'hoodie',
  zip_hoodie: 'zip-through hoodie',
  polo: 'polo shirt',
  tank_top: 'tank top',
};

export const CATEGORY_LABEL_ZH: Record<Category, string> = {
  tshirt: 'T恤',
  longsleeve: '长袖T恤',
  sweatshirt: '卫衣',
  hoodie: '连帽卫衣',
  zip_hoodie: '拉链连帽卫衣',
  polo: 'POLO衫',
  tank_top: '背心',
};

/** Силуэт / посадка. Спрашивается у пользователя в мастере, определяет прибавку. */
export const FitIntentSchema = z.enum(['fitted', 'semi_fitted', 'loose', 'oversize']);
export type FitIntent = z.infer<typeof FitIntentSchema>;

export const FIT_INTENT_LABEL_EN: Record<FitIntent, string> = {
  fitted: 'fitted',
  semi_fitted: 'regular',
  loose: 'loose',
  oversize: 'oversized',
};

export const FIT_INTENT_LABEL_ZH: Record<FitIntent, string> = {
  fitted: '修身',
  semi_fitted: '常规',
  loose: '宽松',
  oversize: '超大廓形',
};

export const FIT_INTENT_LABEL_RU: Record<FitIntent, string> = {
  fitted: 'прилегающая',
  semi_fitted: 'обычная',
  loose: 'свободная',
  oversize: 'oversize',
};

export const GenderSchema = z.enum(['women', 'men']);
export type Gender = z.infer<typeof GenderSchema>;

/**
 * Грамматический род названия категории.
 *
 * Нужен для наименования товара на ярлыке: реквизит по статье 9 ТР ТС 017
 * читает живой человек, а «свитшот женская» — это брак печати, а не мелочь.
 * Худи не склоняется и в отраслевой речи среднего рода: «худи женское».
 */
export const CATEGORY_GRAMMATICAL_GENDER: Record<Category, 'f' | 'm' | 'n'> = {
  tshirt: 'f',
  longsleeve: 'm',
  sweatshirt: 'm',
  hoodie: 'n',
  // «Худи на молнии женское» — та же несклоняемая форма, что и у худи.
  zip_hoodie: 'n',
  // «Поло» тоже не склоняется: на ярлыке «поло женское».
  polo: 'n',
  tank_top: 'f',
};

const GENDER_FORMS: Record<Gender, Record<'f' | 'm' | 'n', string>> = {
  women: { f: 'женская', m: 'женский', n: 'женское' },
  men: { f: 'мужская', m: 'мужской', n: 'мужское' },
};

/** «Футболка женская», «Свитшот мужской», «Худи женское». */
export function categoryWithGender(category: Category, gender: Gender): string {
  const label = CATEGORY_LABEL_RU[category];
  const form = GENDER_FORMS[gender][CATEGORY_GRAMMATICAL_GENDER[category]];
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${form}`;
}
