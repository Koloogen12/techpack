import { z } from 'zod';
import {
  FabricKindSchema,
  FitIntentSchema,
  GenderSchema,
  RefBookMetaSchema,
  VerifiabilitySchema,
  verifiabilityRefinement,
} from './common.js';

/**
 * Размерная сетка — обхваты ТЕЛА в сантиметрах.
 *
 * Правило knowledge-base/03 §3.2: внутренняя модель — сантиметровые обхваты;
 * ярлыки (46 / M / EU 40) — маппинг поверх и в расчёте не участвуют.
 */
export const SizeRowSchema = z
  .object({
    /** Российский размер: RU = Ог / 2. */
    ru: z.number().int().positive(),
    /** Обхват груди, см. Ведущий признак — от него считается якорь. */
    chest: z.number().positive(),
    /** Обхват талии, см. null — данных нет (см. gap справочника). */
    waist: z.number().positive().nullable(),
    /** Обхват бёдер, см. null — данных нет. */
    hip: z.number().positive().nullable(),
    /** Буквенная шкала. Варьируется на ±1 ступень между брендами — только ярлык. */
    int: z.string().min(1),
    eu: z.number().int().positive().nullable(),
    /**
     * US-размер. У женщин — номер шкалы ASTM, у мужчин — обхват груди
     * в дюймах с шагом 2". Мужской шаг крупнее российского, поэтому два
     * соседних RU могут лечь на один US: это свойство шкалы, не ошибка.
     */
    us: z.number().int().nullable(),
    /** Китайская 号型 (GB/T 1335): рост/обхват + полнота, напр. 165/92A. */
    cn: z.string().min(1).nullable(),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const SizeChartSchema = z
  .object({
    gender: GenderSchema,
    /** Базовый рост сетки, см. Ростовки идут шагом 6 см (ГОСТ 31396/31399). */
    base_height: z.number().positive(),
    height_step: z.number().positive(),
    /** Шаг между размерами по обхвату груди, см. */
    chest_step: z.number().positive(),
    /**
     * Полнотная группа, к которой относятся талия и бёдра таблицы.
     *
     * У ГОСТ на каждый обхват груди приходится пять-шесть полнот, и «просто
     * размер 46» не определяет талию. Не назвать группу значит выдать одну
     * из шести таблиц за единственную.
     */
    fullness_group: z.number().int().positive(),
    fullness_note_ru: z.string().min(1),
    /**
     * Откуда взят обхват талии.
     *
     * У женщин он в ГОСТ 31396 НЕ НОРМИРОВАН — там классификация идёт по
     * росту, груди и бёдрам. Значение выведено из вторичных источников,
     * и подписывать его «по ГОСТ» нельзя. Поле существует, чтобы это
     * различие нельзя было потерять при чтении таблицы.
     */
    waist_provenance: z.enum(['gost', 'derived']),
    /** Откуда именно выведен обхват талии. Обязателен, если он не из ГОСТ. */
    waist_note_ru: z.string().min(1).optional(),
    rows: z.array(SizeRowSchema).min(2),
  })
  .superRefine((chart, ctx) => {
    // Проверять подстроку в тексте было бы гаданием: объяснение обязано быть
    // отдельным полем, иначе его однажды перепишут и никто не заметит.
    if (chart.waist_provenance === 'derived' && !chart.waist_note_ru) {
      ctx.addIssue({
        code: 'custom',
        message: 'выведенный обхват талии обязан объяснить своё происхождение (waist_note_ru)',
        path: ['waist_note_ru'],
      });
    }
  });

export const SizeChartsFileSchema = RefBookMetaSchema.extend({
  charts: z.array(SizeChartSchema).min(1),
});

export type SizeRow = z.infer<typeof SizeRowSchema>;
export type SizeChart = z.infer<typeof SizeChartSchema>;
export type SizeChartsFile = z.infer<typeof SizeChartsFileSchema>;

/**
 * Прибавка на свободу облегания (ease).
 *
 * Определение knowledge-base/03 §3.3: ПОЛНЫЙ обхват изделия минус обхват тела, см.
 * Не полуобхват и не прибавка русской школы к полуобхвату — это разные величины,
 * путать их означает ошибку вдвое.
 */
export const EaseEntrySchema = z
  .object({
    category: z.string().min(1),
    fit: FitIntentSchema,
    fabric: FabricKindSchema,
    /** Рабочее значение прибавки, см. Берётся серединой диапазона. */
    default: z.number(),
    min: z.number(),
    max: z.number(),
    note: z.string().optional(),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement)
  .superRefine((e, ctx) => {
    if (e.min > e.max) {
      ctx.addIssue({ code: 'custom', message: 'min больше max', path: ['min'] });
    }
    if (e.default < e.min || e.default > e.max) {
      ctx.addIssue({
        code: 'custom',
        message: `default ${e.default} вне диапазона ${e.min}…${e.max}`,
        path: ['default'],
      });
    }
  });

export const EaseFileSchema = RefBookMetaSchema.extend({
  entries: z.array(EaseEntrySchema).min(1),
});

export type EaseEntry = z.infer<typeof EaseEntrySchema>;
export type EaseFile = z.infer<typeof EaseFileSchema>;
