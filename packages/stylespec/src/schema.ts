import { CategorySchema, FabricKindSchema, FitIntentSchema, GenderSchema } from '@specform/kb';
import { MEASURE_KINDS } from '@specform/core';
import { z } from 'zod';
import { tracked } from './tracked-schema.js';

/**
 * StyleSpec — единственный источник правды об изделии.
 *
 * Флэты, таблицы, PDF — его проекции (TECH-REQUIREMENTS-PIPELINE.md §0.1).
 * Здесь НЕ хранятся SVG, PDF, HTML и растровые изображения: только ссылки
 * на объекты в хранилище. Правда никогда не живёт в картинке.
 *
 * Версия 0.3.0 покрывает паспорт изделия, табель мер, конструкцию,
 * спецификацию материалов и маркировку — то есть полный комплект,
 * который фабрика ждёт от документа.
 */

/** Текущая версия схемы. Ломающее изменение — мажор, новый раздел — минор. */
export const SPEC_VERSION = '0.4.0';

export const StyleIdentitySchema = z.object({
  /** Внутренний идентификатор техпака. */
  id: z.string().min(1),
  /** Название модели, как его дал пользователь. */
  name: z.string().min(1),
  /** Артикул. Печатается в документе и в переписке с фабрикой. */
  article: z.string().min(1),
  category: CategorySchema,
  brand: z.string().optional(),
  season: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Якорные вводные пользователя.
 *
 * Дифференциатор R1: масштаб приходит отсюда, а не из «дефолтного M системы».
 * Абсолютные сантиметры по одному фото получить нельзя — монокулярная
 * неоднозначность масштаба (knowledge-base/03 §5.1).
 */
export const StyleBaseSchema = z.object({
  gender: GenderSchema,
  /** Базовый российский размер. От него считается якорь и от него же идёт градация. */
  base_size_ru: z.number().int().positive(),
  base_height_cm: z.number().positive(),
  fit_intent: FitIntentSchema,
  fabric_kind: FabricKindSchema,
  /** Размерный ряд, российские размеры по возрастанию. Обязан содержать базовый. */
  size_range: z.array(z.number().int().positive()).min(1),
});

export const GradedValueSchema = z.object({
  ru: z.number().int().positive(),
  value: tracked(z.number()),
});

/**
 * Точка табеля мер.
 *
 * Табель мер с допусками — главный документ приёмки: по нему работает ОТК
 * фабрики (knowledge-base/07 §6). Полнота этой таблицы и есть ядро ценности.
 */
export const PomValueSchema = z.object({
  code: z.string().regex(/^[A-Z]\d{2}$/),
  name_ru: z.string().min(1),
  name_en: z.string().min(1),
  /** Показывается новичку по ховеру: он не знает терминов. */
  how_to_measure_ru: z.string().min(1),
  measure_kind: z.enum(MEASURE_KINDS),
  /** Значение базового размера, см. */
  base: tracked(z.number()),
  /** Допуск ±см. Дифференциатор R2: конкурент допуски не ставит вообще. */
  tolerance: tracked(z.number().positive()),
  /** Градация по размерному ряду. Дифференциатор R3. Пусто — точка не градуируется. */
  graded: z.array(GradedValueSchema),
  required: z.boolean(),
  pro_only: z.boolean(),
});

export const MeasurementsSchema = z.object({
  /** Шаблон точек, из которого собрана таблица. */
  template_id: z.string().min(1),
  template_version: z.string().min(1),
  points: z.array(PomValueSchema).min(1),
});

/**
 * Узел обработки в собранном виде.
 *
 * Коды шва и стежка, SPI и тип машины — требование R5: фабрика читает техпак
 * через свой парк машин, и «сшить как на картинке» её не устраивает.
 * Поле presence отвечает на вопрос «откуда мы знаем, что этот узел здесь есть»:
 * увидели на фото, взяли типовым для категории или предположили.
 */
export const ConstructionNodeValueSchema = z.object({
  node_id: z.string().min(1),
  zone: z.string().min(1),
  label_ru: z.string().min(1),
  /** То же простыми словами — для основателя бренда без техбэкграунда. */
  plain_ru: z.string().min(1),
  seam_code: z.string().min(3),
  stitch_code: z.string().regex(/^\d{3}$/),
  spi: z.number().int().positive(),
  machine: z.string().min(1),
  specialty: z.string().min(1),
  seam_allowance_cm: tracked(z.number().positive()),
  finished_cm: tracked(z.number().positive()).nullable(),
  presence: tracked(z.boolean()),
  visible_on_photo: z.boolean(),
  /** Узел требует машины вне парка цеха (R6). */
  requires_special_equipment: z.boolean(),
  alternative: z
    .object({
      node_id: z.string().min(1),
      label_ru: z.string().min(1),
      machine: z.string().min(1),
    })
    .nullable(),
});

/** Операция технологической последовательности РФ-формата. */
export const TechStepSchema = z.object({
  step: z.number().int().positive(),
  operation_ru: z.string().min(1),
  node_id: z.string().nullable(),
  specialty: z.string().min(1),
  machine: z.string().min(1),
  /** Норма времени, секунд. null — данных цеха нет. */
  time_sec: z.number().positive().nullable(),
});

export const ConstructionSchema = z
  .object({
    /** Профиль парка машин, относительно которого проверялись узлы. */
    machine_park_profile: z.string().min(1),
    nodes: z.array(ConstructionNodeValueSchema).min(1),
    sequence: z.array(TechStepSchema).min(1),
  })
  .superRefine((c, ctx) => {
    // Узел без замены, требующий спецоборудования, — невыполнимое требование
    // без выхода. Фабрика вернёт документацию.
    for (const node of c.nodes) {
      if (node.requires_special_equipment && node.alternative === null) {
        ctx.addIssue({
          code: 'custom',
          message:
            `узел ${node.node_id} требует спецоборудования и не предлагает замены — ` +
            `фабрика получит требование, которое не сможет выполнить`,
          path: ['nodes'],
        });
      }
    }
    // Последовательность обязана ссылаться на узлы этого же документа.
    const ids = new Set(c.nodes.map((n) => n.node_id));
    for (const step of c.sequence) {
      if (step.node_id && !ids.has(step.node_id)) {
        ctx.addIssue({
          code: 'custom',
          message: `операция ${step.step} ссылается на узел ${step.node_id}, которого нет в документе`,
          path: ['sequence'],
        });
      }
    }
  });

/** Колорвей изделия. Отдельная сущность: спецификация и SKU строятся на каждый цвет. */
export const ColorwaySchema = z.object({
  id: z.string().min(1),
  name_ru: z.string().min(1),
  /** Ориентировочный цвет с фото. Точный оттенок сверяется по выкрасу. */
  hex_approx: z.string().optional(),
});

export const BomLineSchema = z.object({
  code: z.string().min(1),
  role: z.enum(['shell', 'rib', 'interlining', 'thread', 'label', 'packaging']),
  material_id: z.string().min(1),
  name_ru: z.string().min(1),
  name_en: z.string().min(1),
  composition: tracked(z.string().min(1)),
  /** Плотность, г/м². С фото не определяется никогда — всегда предположение. */
  gsm: tracked(z.number().positive()).nullable(),
  placement_ru: z.string().min(1),
  consumption: tracked(z.number().positive()).nullable(),
  consumption_unit: z.enum(['м', 'шт', 'компл']),
  /** Артикул поставщика заполняет бренд или фабрика — мы его не выдумываем. */
  supplier_article: z.null(),
  note: z.string().optional(),
});

export const BomSchema = z
  .object({
    colorways: z.array(ColorwaySchema).min(1),
    lines: z.array(BomLineSchema).min(1),
    /** Предварительный расход на изделие. Уточняется фабрикой по раскладке. */
    fabric_consumption_m: tracked(z.number().positive()),
    /** Тираж заказа, штук. Фабрика считает цену от него. */
    batch_qty: z.number().int().positive().nullable(),
    batch_consumption_m: z.number().positive().nullable(),
  })
  .superRefine((bom, ctx) => {
    // «Расход на тираж: 130 м» без указания самого тиража — число без смысла:
    // фабрика не может ни проверить его, ни посчитать от него цену. Раньше
    // тираж брался из анкеты, участвовал в расчёте и в документ не доходил.
    if ((bom.batch_consumption_m === null) !== (bom.batch_qty === null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'расход на тираж и сам тираж указываются только вместе',
        path: ['batch_qty'],
      });
    }
  });

export const LabelsSchema = z
  .object({
    care_symbols: z
      .array(
        z.object({ group: z.string().min(1), id: z.string().min(1), label_ru: z.string().min(1) }),
      )
      .min(1),
    requisites: z.array(
      z.object({
        id: z.string().min(1),
        label_ru: z.string().min(1),
        value: tracked(z.string().min(1)).nullable(),
        required: z.boolean(),
        /** Что сделать, чтобы реквизит заполнился. */
        action_ru: z.string().min(1).nullable(),
      }),
    ),
    sku_matrix: z
      .array(
        z.object({
          sku: z.string().min(1),
          colorway_id: z.string().min(1),
          colorway_ru: z.string().min(1),
          size_ru: z.number().int().positive(),
          /** Плейсхолдер: коды GTIN бренд получает в Нацкаталоге. */
          gtin: z.null(),
        }),
      )
      .min(1),
  })
  .superRefine((l, ctx) => {
    // Пустой обязательный реквизит обязан объяснять, как его заполнить.
    // Иначе пользователь видит пробел и не знает, что с ним делать.
    for (const r of l.requisites) {
      if (r.value === null && r.action_ru === null) {
        ctx.addIssue({
          code: 'custom',
          message: `реквизит ${r.id} не заполнен и не говорит, как его заполнить`,
          path: ['requisites'],
        });
      }
    }
  });

/** Ссылка на файл в объектном хранилище. Содержимого файла в спеке нет и не будет. */
export const AssetRefSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(['reference_photo', 'flat_svg', 'pdf', 'sample_photo']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const SpecMetaSchema = z.object({
  generated_at: z.string().datetime(),
  /**
   * Ключ контент-адресуемого кэша vision (ADR-0003).
   * Одинаковый ключ обязан давать одинаковый StyleSpec — на этом стоит
   * требование стопроцентной воспроизводимости.
   */
  vision_cache_key: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  /** Версии справочников, из которых собрана спека. Без них диффы версий необъяснимы. */
  kb_versions: z.record(z.string(), z.string()),
  /** Сколько значений требуют подтверждения по образцу. Цифра в кнопке «Предположения: N». */
  assumptions_count: z.number().int().nonnegative(),
});

export const StyleSpecSchema = z
  .object({
    spec_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    style: StyleIdentitySchema,
    base: StyleBaseSchema,
    measurements: MeasurementsSchema,
    /**
     * Конструкция. Необязательна: снапшоты версии 0.1.0 её не содержат,
     * и мигрируют простым повышением версии.
     */
    construction: ConstructionSchema.optional(),
    /** Спецификация материалов. Необязательна: снапшоты до 0.3.0 её не содержат. */
    bom: BomSchema.optional(),
    /** Маркировка. Необязательна по той же причине. */
    labels: LabelsSchema.optional(),
    assets: z.array(AssetRefSchema),
    meta: SpecMetaSchema,
  })
  .superRefine((spec, ctx) => {
    if (!spec.base.size_range.includes(spec.base.base_size_ru)) {
      ctx.addIssue({
        code: 'custom',
        message: `базовый размер ${spec.base.base_size_ru} обязан входить в размерный ряд ${spec.base.size_range.join(', ')}`,
        path: ['base', 'size_range'],
      });
    }

    const sorted = [...spec.base.size_range].sort((a, b) => a - b);
    if (sorted.join() !== spec.base.size_range.join()) {
      ctx.addIssue({
        code: 'custom',
        message: 'размерный ряд обязан идти по возрастанию',
        path: ['base', 'size_range'],
      });
    }

    const codes = spec.measurements.points.map((p) => p.code);
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dupes.length) {
      ctx.addIssue({
        code: 'custom',
        message: `дубли точек в табеле мер: ${[...new Set(dupes)].join(', ')}`,
        path: ['measurements', 'points'],
      });
    }

    // Счётчик предположений — не отдельное поле, а проекция данных.
    // Если он разошёлся с содержимым, документ врёт пользователю.
    const actual =
      spec.measurements.points.filter(
        (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
      ).length +
      (spec.construction?.nodes.filter((n) => n.presence.confidence === 'assumption').length ?? 0) +
      (spec.bom?.lines.filter(
        (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
      ).length ?? 0);
    if (actual !== spec.meta.assumptions_count) {
      ctx.addIssue({
        code: 'custom',
        message: `счётчик предположений (${spec.meta.assumptions_count}) разошёлся с данными (${actual})`,
        path: ['meta', 'assumptions_count'],
      });
    }

    // Градация обязана покрывать весь ряд, кроме базового размера,
    // иначе в экспорте появятся пустые колонки.
    const expected = spec.base.size_range.filter((ru) => ru !== spec.base.base_size_ru);
    for (const point of spec.measurements.points) {
      if (point.graded.length === 0) continue;
      const covered = point.graded.map((g) => g.ru).sort((a, b) => a - b);
      if (covered.join() !== expected.join()) {
        ctx.addIssue({
          code: 'custom',
          message: `точка ${point.code}: градация покрывает ${covered.join(', ') || '—'}, ожидалось ${expected.join(', ')}`,
          path: ['measurements', 'points'],
        });
      }
    }
  });

export type StyleSpec = z.infer<typeof StyleSpecSchema>;
export type PomValue = z.infer<typeof PomValueSchema>;
export type StyleBase = z.infer<typeof StyleBaseSchema>;
export type StyleIdentity = z.infer<typeof StyleIdentitySchema>;
export type Measurements = z.infer<typeof MeasurementsSchema>;
export type GradedValue = z.infer<typeof GradedValueSchema>;
export type AssetRef = z.infer<typeof AssetRefSchema>;
export type Construction = z.infer<typeof ConstructionSchema>;
export type ConstructionNodeValue = z.infer<typeof ConstructionNodeValueSchema>;
export type TechStep = z.infer<typeof TechStepSchema>;
export type Bom = z.infer<typeof BomSchema>;
export type BomLine = z.infer<typeof BomLineSchema>;
export type Colorway = z.infer<typeof ColorwaySchema>;
export type Labels = z.infer<typeof LabelsSchema>;
