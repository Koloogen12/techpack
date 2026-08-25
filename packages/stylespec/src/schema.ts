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
 * Версия 0.1.0 покрывает паспорт изделия и табель мер. Разделы конструкции,
 * материалов и маркировки добавляются вместе со своими движками — отдельной
 * минорной версией и миграцией, а не пустыми заготовками «на будущее».
 */

/** Текущая версия схемы. Ломающее изменение — мажор, новый раздел — минор. */
export const SPEC_VERSION = '0.1.0';

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
    const actual = spec.measurements.points.filter(
      (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
    ).length;
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
