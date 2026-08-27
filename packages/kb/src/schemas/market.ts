import { z } from 'zod';
import {
  CategorySchema,
  RefBookMetaSchema,
  VerifiabilitySchema,
  verifiabilityRefinement,
} from './common.js';

/**
 * Нормы приёмки по рынкам сбыта.
 *
 * Российская фабрика читает ГОСТ, китайская — 执行标准 и AQL. Напечатать
 * одной стороне нормы другой значит напечатать пустое место: у китайского
 * ОТК нет ни доступа к ГОСТ 23193-78, ни обязанности его знать. Поэтому
 * лист приёмки в китайском комплекте собирается из СВОИХ норм, а не из
 * перевода наших.
 */

/** Обязательный регламент безопасности рынка. */
export const MarketSafetySchema = z
  .object({
    code: z.string().min(1),
    /** Класс или категория внутри регламента. */
    grade: z.string().min(1),
    text_local: z.string().min(1),
    text_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

/**
 * Стандарт, по которому изделие выпускается.
 *
 * Привязан к нашим категориям: у трикотажной футболки и у худи в КНР
 * разные стандарты, и печатать один на всё значит соврать в строке,
 * которую ОТК читает первой.
 */
export const ProductStandardSchema = z
  .object({
    code: z.string().min(1),
    text_local: z.string().min(1),
    text_ru: z.string().min(1),
    categories: z.array(CategorySchema).min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

/** Правило выборочного контроля партии. */
export const SamplingRuleSchema = z
  .object({
    code: z.string().min(1),
    /** Международный эквивалент — по нему стандарт узнаётся вне рынка. */
    equivalent: z.string().min(1),
    level: z.string().min(1),
    aql_major: z.number().positive(),
    aql_minor: z.number().positive(),
    text_local: z.string().min(1),
    text_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const MarketAcceptanceSchema = z.object({
  id: z.string().min(1),
  /** Язык комплекта, для которого эти нормы печатаются. */
  locale: z.enum(['ru', 'en', 'zh']),
  label_ru: z.string().min(1),
  label_local: z.string().min(1),
  /** Заголовок блока стандартов на языке рынка: у КНР это 执行标准. */
  standards_title_local: z.string().min(1),
  safety: MarketSafetySchema,
  product_standards: z.array(ProductStandardSchema).min(1),
  sampling: SamplingRuleSchema,
  measurement_note_local: z.string().min(1),
  measurement_note_ru: z.string().min(1),
});

export const MarketAcceptanceFileSchema = RefBookMetaSchema.extend({
  markets: z.array(MarketAcceptanceSchema).min(1),
});

export type MarketSafety = z.infer<typeof MarketSafetySchema>;
export type ProductStandard = z.infer<typeof ProductStandardSchema>;
export type SamplingRule = z.infer<typeof SamplingRuleSchema>;
export type MarketAcceptance = z.infer<typeof MarketAcceptanceSchema>;
export type MarketAcceptanceFile = z.infer<typeof MarketAcceptanceFileSchema>;
