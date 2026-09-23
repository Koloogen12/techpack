import { z } from 'zod';
import { CATEGORIES } from '@seamster/kb';
import { ObservationsSchema } from './observations.js';

/**
 * VisionReport — строго типизированный выход анализа фото.
 *
 * Контракт из TECH-REQUIREMENTS-PIPELINE.md §B. Свободного текста здесь нет
 * и не будет: модель отвечает по JSON Schema, которая выводится из этой же
 * zod-декларации, поэтому валидатор и промпт не могут разойтись.
 *
 * Главное ограничение, зашитое в саму форму ответа: модель НЕ называет
 * сантиметры. Абсолютный масштаб с одного фото недостижим (монокулярная
 * неоднозначность), поэтому она отдаёт только безразмерные отношения,
 * а масштаб приходит от пользователя (knowledge-base/03 §5).
 */

/** Версия схемы отчёта. Входит в ключ кэша: смена схемы = смена ключа. */
export const VISION_SCHEMA_VERSION = '6';

export const VisionConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type VisionConfidence = z.infer<typeof VisionConfidenceSchema>;

/**
 * Зоны дизайн-признаков. Не узлы обработки и не точки табеля: то, что делает
 * эту вещь этой вещью и чего в типовом изделии категории нет — окат буф, пояс,
 * клинья, декоративные строчки. Реестр узлов такого не описывает и описать
 * не может: это дизайн-контент, а не технология.
 */
export const DESIGN_ZONES = [
  'neckline',
  'collar',
  'shoulder',
  'sleeve',
  'bodice',
  'waist',
  'skirt',
  'hem',
  'back',
  'closure',
  'pocket',
  'trim',
  'other',
] as const;
export type DesignZone = (typeof DESIGN_ZONES)[number];

export const DesignFeatureSchema = z.object({
  zone: z.enum(DESIGN_ZONES),
  en: z
    .string()
    .describe('Термин швейной индустрии по-английски, до десяти слов: уходит в задание художнику'),
  ru: z.string().describe('То же по-русски, до восьми слов: уходит в документ'),
  confidence: VisionConfidenceSchema,
});
export type DesignFeature = z.infer<typeof DesignFeatureSchema>;

export const VisionReportSchema = z.object({
  category: z.object({
    value: z.enum([...CATEGORIES, 'other'] as unknown as [string, ...string[]]),
    confidence: VisionConfidenceSchema,
    /** Что именно на фото, если категория «другое». Нужно для гейта категорий. */
    other_description: z
      .string()
      .describe('Заполняется только когда value = other: что за изделие на фото'),
  }),

  silhouette: z.object({
    value: z.enum(['fitted', 'semi_fitted', 'loose', 'oversize']),
    confidence: VisionConfidenceSchema,
  }),

  fabric: z.object({
    /**
     * Класс ТКАНОГО полотна по фактуре.
     *
     * Отдельным полем, а не в общем списке с трикотажными: лён и кулирка —
     * разные вещи даже на глаз, и заставлять модель выбирать между ними
     * значит получать `unknown` на каждом тканом изделии. Так и было: платье
     * из мятого льна доехало до документа штапелем, потому что класса под
     * ткань в схеме не существовало вовсе.
     */
    woven_class: z.enum([
      'poplin',
      'twill',
      'denim',
      'suiting',
      'linen',
      'challis',
      'crepe',
      'unknown',
    ]),
    /**
     * Как полотно ведёт свет.
     *
     * Отделка, а не вкус: блеск даёт лощение, мерсеризация или само
     * переплетение, и фабрика закупает по нему другой артикул. На снимке
     * видно сразу — по бликам на складках.
     */
    surface: z.enum(['matte', 'sheen', 'glossy', 'unknown']),
    /** Класс ТРИКОТАЖНОГО полотна. Плотность в граммах с фото не определяется никогда. */
    knit_class: z.enum([
      'single_jersey',
      'interlock',
      'rib_1x1',
      'rib_2x2',
      'french_terry_2t',
      'french_terry_3t',
      'pique',
      'unknown',
    ]),
    confidence: VisionConfidenceSchema,
    is_knit: z.boolean().describe('Трикотаж (true) или ткань (false)'),
  }),

  /**
   * Безразмерные отношения к ширине по груди (точка T03).
   *
   * Ключ — код точки измерения из шаблона категории. Значение — во сколько раз
   * эта величина больше ширины по груди в плоском виде. Сантиметры не называются.
   */
  proportions: z.array(
    z.object({
      pom_code: z.string().describe('Код точки измерения, например T01'),
      ratio_to_chest: z
        .number()
        .describe('Отношение к ширине по груди в плоском виде. Строго больше нуля'),
      confidence: VisionConfidenceSchema,
      reason: z.string().describe('До восьми слов: ориентир и оговорка'),
    }),
  ),

  /**
   * Наблюдения по закрытым словарям — главный ответ (packages/core/src/observations.ts).
   *
   * Необязательно ТОЛЬКО ради старых отчётов в кэше и голден-наборе: модели
   * поле объявляется обязательным (VisionModelSchema). Без него сборка
   * читает свободный текст visible_elements регулярками — путь второго сорта.
   */
  observations: ObservationsSchema.optional(),

  /** Конструктивные элементы, которые видно. Каждый — с уверенностью. */
  visible_elements: z.array(
    z.object({
      key: z
        .string()
        .describe('Ключ признака из карты видимости, например neckline_type или topstitch_rows'),
      value: z.string().describe('Что наблюдается, до десяти слов'),
      confidence: VisionConfidenceSchema,
    }),
  ),

  /**
   * Дизайн-признаки: что отличает эту вещь от типового изделия категории.
   *
   * Единственное поле отчёта, которое уходит в промпт технического рисунка
   * выше чек-листа узлов. Без него чек-лист говорил «втачной рукав», и модель
   * слушалась его, а не снимка: рукава-буф с подиума терялись. Пустой список —
   * нормальный ответ для типовой вещи.
   */
  design_features: z
    .array(DesignFeatureSchema)
    .describe('Только видимое и только то, чего нет в типовом изделии категории'),

  /**
   * Число параллельных строчек в отделочных швах.
   *
   * Вынесено отдельным полем, потому что напрямую определяет тип машины:
   * две линии — распошив 406, три — 407, двойная джинсовая — 401 двухигольная
   * (knowledge-base/04 §7).
   */
  topstitching: z.array(
    z.object({
      location: z.enum(['hem', 'sleeve_hem', 'neckline', 'shoulder', 'side', 'pocket', 'other']),
      rows: z.number().int().describe('Количество параллельных строчек. 0 — строчка не видна'),
      confidence: VisionConfidenceSchema,
    }),
  ),

  colorways: z.array(
    z.object({
      name_ru: z.string(),
      /** Ориентировочный цвет. Точный оттенок сверяется по выкрасу, не по фото. */
      hex_approx: z.string().describe('Приблизительный цвет в формате #RRGGBB'),
    }),
  ),

  /**
   * Что на этих фото НЕ видно.
   *
   * Ключевое поле честности (дифференциатор R4). Всё отсюда уходит в документ
   * предположением с пометкой «уточнить по образцу», а не подставляется молча.
   */
  not_visible: z.array(
    z.object({
      key: z.string().describe('Ключ признака из карты видимости'),
      reason: z.string().describe('До шести слов: ракурс, изнанка, скрыто внутри'),
    }),
  ),

  /** Замечания о качестве снимков: тёмное, мелкое, под углом. */
  /**
   * Предмет известного размера в кадре.
   *
   * Единственное, что снимает монокулярную неоднозначность масштаба: без него
   * абсолютные сантиметры с фотографии получить нельзя в принципе. Модель
   * сообщает ОТНОШЕНИЕ предмета к опорной величине — ту же безразмерную
   * величину, в которой она уже отдаёт пропорции. Истинный размер предмета
   * берётся из справочника, а не отсюда: то, что мы знаем точно из стандарта,
   * не должно зависеть от того, что показалось на снимке.
   */
  scale_object: z.object({
    kind: z
      .enum(['a4_sheet', 'bank_card', 'none'])
      .describe('Какой опорный предмет виден. none — ничего подходящего нет'),
    side: z
      .enum(['long_side', 'short_side'])
      .describe('Какой стороной предмет измерен: длинной или короткой'),
    ratio_to_anchor: z
      .number()
      .describe(
        'Отношение измеренной стороны предмета к опорной величине изделия. ' +
          '0, если предмета нет',
      ),
    coplanar: z
      .boolean()
      .describe(
        'Предмет лежит В ТОЙ ЖЕ плоскости, что изделие, и не под углом к камере. ' +
          'false — если он стоит, приподнят, свисает с края или заметно искажён перспективой',
      ),
    confidence: VisionConfidenceSchema,
    reason: z.string().describe('До восьми слов: края предмета и плоскость'),
  }),
  photo_quality_notes: z.array(z.string()),
});

export type VisionReport = z.infer<typeof VisionReportSchema>;

/** Схема для МОДЕЛИ: словари обязательны. Хранение и старые отчёты — по VisionReportSchema. */
export const VisionModelSchema = VisionReportSchema.required({ observations: true });

/** Половина отчёта: структура и видимость — всё, кроме пропорций. */
export const StructurePartSchema = VisionModelSchema.pick({
  category: true,
  silhouette: true,
  fabric: true,
  observations: true,
  visible_elements: true,
  design_features: true,
  topstitching: true,
  colorways: true,
  not_visible: true,
  photo_quality_notes: true,
});
/** Половина отчёта: пропорции и опорный предмет. */
export const ProportionsPartSchema = VisionModelSchema.pick({
  proportions: true,
  scale_object: true,
});
