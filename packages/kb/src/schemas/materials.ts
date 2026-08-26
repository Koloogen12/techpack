import { z } from 'zod';
import {
  CategorySchema,
  RangeSchema,
  RefBookMetaSchema,
  VerifiabilitySchema,
  verifiabilityRefinement,
} from './common.js';

const WithDefault = RangeSchema.extend({ default: z.number() });

/** Роль материала в изделии. Определяет группу в спецификации материалов. */
export const MATERIAL_ROLES = [
  'shell',
  'rib',
  'interlining',
  'thread',
  /**
   * Фурнитура: шнур, люверсы, наконечники, молния, пуговицы.
   *
   * Роль появилась не «на будущее»: у худи в технологической
   * последовательности стояли операции «установить люверсы» и «вдеть шнур»,
   * а в спецификации материалов этих позиций не было вовсе — фабрика
   * получала операцию без строки закупки.
   */
  'hardware',
  'label',
  'packaging',
] as const;
export const MaterialRoleSchema = z.enum(MATERIAL_ROLES);
export type MaterialRole = z.infer<typeof MaterialRoleSchema>;

export const MATERIAL_ROLE_LABEL_EN: Record<MaterialRole, string> = {
  shell: 'shell fabric',
  rib: 'rib trim',
  interlining: 'interlining',
  thread: 'thread',
  hardware: 'hardware and trims',
  label: 'label',
  packaging: 'packaging',
};

export const MATERIAL_ROLE_LABEL_ZH: Record<MaterialRole, string> = {
  shell: '面料',
  rib: '罗纹',
  interlining: '衬布',
  thread: '缝纫线',
  hardware: '五金辅料',
  label: '唛头',
  packaging: '包装',
};

export const MATERIAL_ROLE_LABEL_RU: Record<MaterialRole, string> = {
  shell: 'основное полотно',
  rib: 'отделочное полотно (рибана, кашкорсе)',
  interlining: 'прокладочные материалы',
  thread: 'нитки',
  hardware: 'фурнитура',
  label: 'ярлыки и этикетки',
  packaging: 'упаковка',
};

/**
 * Насколько параметр материала определяется по фото.
 *
 * Класс полотна по фактуре — да; плотность в граммах — никогда
 * (knowledge-base/05 §1.1, колонка «С фото?»). Отсюда: GSM всегда попадает
 * в документ как предположение с пометкой «уточнить у заказчика или по образцу».
 */
export const PhotoDetectabilitySchema = z.enum(['structure', 'partial', 'no']);

export const MaterialSchema = z
  .object({
    id: z.string().min(1),
    name_ru: z.string().min(1),
    name_en: z.string().min(1),
    name_zh: z.string().min(1),
    composition_default_en: z.string().min(1),
    composition_default_zh: z.string().min(1),
    translation_verified: z.boolean(),
    translation_gap: z.string().min(1),
    role: MaterialRoleSchema,
    structure_ru: z.string().min(1),
    /** Типовой состав. С фото не определяется — всегда предположение. */
    composition_default_ru: z.string().min(1),
    /** Плотность, г/м². С фото не определяется никогда. */
    gsm: WithDefault.optional(),
    applications: z.array(CategorySchema),
    /**
     * Штук на изделие — только для фурнитуры. У полотна расход считается
     * раскладкой, у ниток и упаковки хватает единицы: там ошибка на штуку
     * ничего не стоит, а у люверсов их ровно два, и снабжение закупает по
     * этому числу.
     */
    qty_per_unit: z.number().positive().optional(),
    photo_detectable: PhotoDetectabilitySchema,
    /** Профиль символов ухода из care_symbols. */
    care_profile_id: z.string().min(1).optional(),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const MaterialsFileSchema = RefBookMetaSchema.extend({
  materials: z.array(MaterialSchema).min(1),
});

/**
 * Нормы предварительного расхода полотна.
 *
 * Дифференциатор R9 / слабость конкурента №14: расход не считают вообще,
 * «невозможно без лекал». Фабрике он нужен для калькуляции, поэтому мы даём
 * предварительную оценку с явной пометкой «уточняется фабрикой по раскладке».
 */
export const ConsumptionFormulaSchema = z
  .object({
    category: CategorySchema,
    /** Ширина полотна в рулоне, см. */
    fabric_width_cm: WithDefault,
    /** Расход на изделие размера M, погонных метров. */
    consumption_m: WithDefault,
    /** Трикотаж часто поставляется чулком — расход меньше. */
    tube_width_cm: z.number().positive().optional(),
    tube_consumption_m: WithDefault.optional(),
    /** Потери на раскладку, %. */
    marker_waste_percent: WithDefault,
    /** Запас на усадку, %. */
    shrinkage_percent: WithDefault,
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const ConsumptionFileSchema = RefBookMetaSchema.extend({
  formulas: z.array(ConsumptionFormulaSchema).min(1),
});

export type Material = z.infer<typeof MaterialSchema>;
export type MaterialsFile = z.infer<typeof MaterialsFileSchema>;
export type ConsumptionFormula = z.infer<typeof ConsumptionFormulaSchema>;
export type ConsumptionFile = z.infer<typeof ConsumptionFileSchema>;
