import { z } from 'zod';
import { MEASURE_KINDS } from '@specform/core';
import {
  CategorySchema,
  FabricKindSchema,
  RangeSchema,
  RefBookMetaSchema,
  VerifiabilitySchema,
  verifiabilityRefinement,
} from './common.js';

export const MeasureKindSchema = z.enum(MEASURE_KINDS);

/**
 * Класс точки измерения. Определяет допуск по умолчанию.
 * Источник: knowledge-base/03 §1, «Дефолтная шкала допусков для генератора».
 */
export const TOLERANCE_CLASSES = ['major_width', 'length', 'medium', 'minor'] as const;
export const ToleranceClassSchema = z.enum(TOLERANCE_CLASSES);
export type ToleranceClass = z.infer<typeof ToleranceClassSchema>;

const ToleranceValueSchema = z
  .object({
    /** Рабочий допуск, ±см. Подставляется в таблицу автоматически. */
    default: z.number().positive(),
    min: z.number().positive(),
    max: z.number().positive(),
  })
  .refine((t) => t.min <= t.default && t.default <= t.max, {
    message: 'default обязан лежать внутри min…max',
  });

export const ToleranceClassEntrySchema = z
  .object({
    class: ToleranceClassSchema,
    label_ru: z.string().min(1),
    examples_ru: z.array(z.string()).min(1),
    woven: ToleranceValueSchema,
    /** Трикотаж — допуски шире: полотно тянется, ОТК меряет relaxed. */
    knit: ToleranceValueSchema,
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const ToleranceClassesFileSchema = RefBookMetaSchema.extend({
  classes: z.array(ToleranceClassEntrySchema).length(TOLERANCE_CLASSES.length),
});

export type ToleranceClassEntry = z.infer<typeof ToleranceClassEntrySchema>;
export type ToleranceClassesFile = z.infer<typeof ToleranceClassesFileSchema>;

/**
 * Как движок получает значение точки.
 *
 *  anchor          — якорь масштаба, считается из сетки тела + прибавки. Ровно один на шаблон.
 *  ratio_to_anchor — якорь × безразмерное отношение с фото, с клэмпом в диапазон.
 *  independent     — не связано с якорем: высота бейки, глубина горловины и т.п.
 *  composed        — складывается из других точек с коэффициентами.
 *
 * Последнее нужно там, где замер ПО ОПРЕДЕЛЕНИЮ является суммой: длина рукава
 * от центра спинки идёт через плечо, то есть это полуширина плеч плюс сам рукав.
 * Пока она считалась отдельной пропорцией, на oversize плечи расширялись,
 * а этот замер — нет, и документ противоречил сам себе.
 */
export const DerivationSchema = z.enum(['anchor', 'ratio_to_anchor', 'independent', 'composed']);
export type Derivation = z.infer<typeof DerivationSchema>;

/**
 * За чем следует величина точки.
 *
 *  garment — за шириной изделия: она растёт вместе с прибавкой на посадку.
 *            Ширины, пройма, ширина рукава, ширина плеч (спущенное плечо
 *            на oversize действительно шире).
 *  body    — за обхватом тела: горловина, наклон плеча. Растут с размером.
 *  height  — за РОСТОМ: длина изделия и длина рукава. С размером они тоже
 *            растут, но заметно медленнее, поэтому поправка на размер идёт
 *            отдельным слагаемым из правила градации, а не множителем.
 *
 * Различение появилось после перебора пространства входов и уточнялось дважды.
 * Пока длина считалась от ширины ИЗДЕЛИЯ, мужская футболка RU 56 oversize
 * выходила длиной 102 см. После привязки к обхвату ТЕЛА туника исчезла,
 * но вылез длинный рукав: замер от центра спинки доходил до 105 см, потому
 * что человек на четыре размера больше не имеет рук на четверть длиннее —
 * он шире. Длины следуют за ростом.
 */
export const AnchorBasisSchema = z.enum(['garment', 'body', 'height']);
export type AnchorBasis = z.infer<typeof AnchorBasisSchema>;

export const PomPointSchema = z
  .object({
    /** Код точки в табеле мер. Печатается в PDF и в переписке с фабрикой. */
    code: z.string().regex(/^[A-Z]\d{2}$/),
    name_en: z.string().min(1),
    name_ru: z.string().min(1),
    /** Как мерить. Показывается новичку по ховеру вместе с мини-схемой. */
    how_to_measure_ru: z.string().min(1),
    measure_kind: MeasureKindSchema,
    /** Класс точки — источник допуска по умолчанию. */
    tolerance_class: ToleranceClassSchema,
    /**
     * Явный допуск из таблицы категории (knowledge-base/03 §2.x), ±см.
     * Приоритет: точка > класс. Таблица категории конкретнее общей шкалы,
     * поэтому если значение указано — оно и попадает в табель мер.
     */
    tolerance_cm: z.number().positive().optional(),
    derivation: DerivationSchema,
    /** За чем следует величина: за шириной изделия или за телом. */
    anchor_basis: AnchorBasisSchema.default('garment'),
    /**
     * Отношение к якорю по умолчанию — когда фото не дало пропорции.
     * Обязательно для ratio_to_anchor и independent, запрещено для anchor.
     */
    baseline_ratio: z.number().positive().optional(),
    /** Границы правдоподобия отношения. Клэмп применяется ПОСЛЕ пропорции с фото. */
    ratio_range: RangeSchema.optional(),
    /**
     * Из каких точек складывается величина. Только для derivation: composed.
     * Считается после остальных точек, поэтому ссылаться можно лишь на них.
     */
    composed_of: z
      .array(z.object({ code: z.string().regex(/^[A-Z]\d{2}$/), factor: z.number() }))
      .min(1)
      .optional(),
    /** Ключ правила градации из grading_increments. */
    grading_key: z.string().min(1),
    /** Точка обязательна в табеле мер — без неё документ неполон для ОТК. */
    required: z.boolean(),
    /** Показывается только в Pro-режиме: плотность для конструктора. */
    pro_only: z.boolean().default(false),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement)
  .superRefine((p, ctx) => {
    if (p.derivation === 'composed') {
      if (!p.composed_of?.length) {
        ctx.addIssue({
          code: 'custom',
          message: `точка ${p.code}: derivation composed требует composed_of`,
          path: ['composed_of'],
        });
      }
      if (p.baseline_ratio !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'составная точка не имеет собственного отношения к якорю',
          path: ['baseline_ratio'],
        });
      }
      return;
    }
    if (p.derivation === 'anchor') {
      if (p.baseline_ratio !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'якорь считается из сетки тела, отношение к самому себе бессмысленно',
          path: ['baseline_ratio'],
        });
      }
      return;
    }
    if (p.baseline_ratio === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `точка ${p.code}: без baseline_ratio движку нечего подставить, когда фото молчит`,
        path: ['baseline_ratio'],
      });
    }
    if (p.ratio_range && p.baseline_ratio !== undefined) {
      const { min, max } = p.ratio_range;
      if (p.baseline_ratio < min || p.baseline_ratio > max) {
        ctx.addIssue({
          code: 'custom',
          message: `baseline_ratio ${p.baseline_ratio} вне ratio_range ${min}…${max}`,
          path: ['baseline_ratio'],
        });
      }
    }
  });

export const PomTemplateFileSchema = RefBookMetaSchema.extend({
  category: CategorySchema,
  fabric: FabricKindSchema,
  points: z.array(PomPointSchema).min(1),
}).superRefine((tpl, ctx) => {
  const anchors = tpl.points.filter((p) => p.derivation === 'anchor');
  if (anchors.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: `шаблон обязан иметь ровно один якорь масштаба, найдено ${anchors.length}`,
      path: ['points'],
    });
  }
  const codes = tpl.points.map((p) => p.code);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length) {
    ctx.addIssue({ code: 'custom', message: `дубли кодов: ${dupes.join(', ')}`, path: ['points'] });
  }
});

export type PomPoint = z.infer<typeof PomPointSchema>;
export type PomTemplateFile = z.infer<typeof PomTemplateFileSchema>;

/**
 * Правило градации.
 *
 * ВАЖНО: приращение хранится в тех же единицах, что и значение точки, к которой
 * применяется. Для half-measure точек (грудь, талия, низ) это половина
 * межразмерного приращения по обхвату: обхват +4.0 см → half +2.0 см.
 * Источник: knowledge-base/03 §4.2.
 */
export const GradingRuleSchema = z
  .object({
    key: z.string().min(1),
    label_ru: z.string().min(1),
    /** Приращение на один размер вверх, см. */
    per_size: z.number(),
    per_size_range: RangeSchema,
    /** Приращение на одну ростовку (шаг 6 см), см. */
    per_height: z.number(),
    /**
     * Множитель для трикотажа. Полотно «съедает» часть прибавки растяжимостью,
     * поэтому grade у трикотажа меньше — но числовой коэффициент в базе знаний
     * отсутствует, поэтому здесь 1.0 до калибровки по отшивам.
     */
    knit_multiplier: z.number().positive(),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement)
  .superRefine((r, ctx) => {
    const { min, max } = r.per_size_range;
    if (r.per_size < min || r.per_size > max) {
      ctx.addIssue({
        code: 'custom',
        message: `per_size ${r.per_size} вне диапазона ${min}…${max}`,
        path: ['per_size'],
      });
    }
  });

export const GradingFileSchema = RefBookMetaSchema.extend({
  /** Межразмерный шаг по обхвату груди, см. Основание всей градации. */
  chest_step: z.number().positive(),
  rules: z.array(GradingRuleSchema).min(1),
});

export type GradingRule = z.infer<typeof GradingRuleSchema>;
export type GradingFile = z.infer<typeof GradingFileSchema>;
