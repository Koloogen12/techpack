import { z } from 'zod';
import { RefBookMetaSchema, VerifiabilitySchema, verifiabilityRefinement } from './common.js';

/**
 * Символы ухода по ГОСТ ISO 3758-2014.
 *
 * Порядок пяти символов строгий: стирка → отбеливание → сушка → глажение →
 * профессиональная чистка. Нарушение порядка на ярлыке — формальное
 * несоответствие, а ярлык входит в обязательную маркировку по ТР ТС 017.
 */
export const CARE_GROUPS = [
  'wash',
  'bleach',
  'tumble_dry',
  'natural_dry',
  'iron',
  'professional',
] as const;
export const CareGroupSchema = z.enum(CARE_GROUPS);
export type CareGroup = z.infer<typeof CareGroupSchema>;

export const CareVariantSchema = z.object({
  id: z.string().min(1),
  group: CareGroupSchema,
  label_ru: z.string().min(1),
  /**
   * Подписи на языках экспорта.
   *
   * Необязательны: справочник мог быть собран до появления переводов —
   * тогда раздел просто не поедет в нерусский комплект, а не упадёт.
   */
  label_en: z.string().min(1).optional(),
  label_zh: z.string().min(1).optional(),
});

export const CareProfileSchema = z
  .object({
    id: z.string().min(1),
    label_ru: z.string().min(1),
    /** Один вариант на группу. Пропуск группы допустим — символ не печатается. */
    variants: z.record(CareGroupSchema, z.string().min(1)),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const CareSymbolsFileSchema = RefBookMetaSchema.extend({
  /** Обязательный порядок символов на ярлыке. */
  order: z.array(CareGroupSchema).length(CARE_GROUPS.length),
  variants: z.array(CareVariantSchema).min(1),
  profiles: z.array(CareProfileSchema).min(1),
}).superRefine((file, ctx) => {
  const known = new Set(file.variants.map((v) => v.id));
  for (const profile of file.profiles) {
    for (const [group, variant] of Object.entries(profile.variants)) {
      if (!known.has(variant)) {
        ctx.addIssue({
          code: 'custom',
          message: `профиль ${profile.id}: неизвестный символ ${variant} в группе ${group}`,
          path: ['profiles'],
        });
      }
    }
  }
});

/**
 * Обязательные реквизиты маркировки по статье 9 ТР ТС 017/2011.
 *
 * Дифференциатор R9: у конкурента локальной нормативки нет вообще.
 * Незаполненный обязательный реквизит блокирует продажу, поэтому каждый
 * из них обязан либо иметь значение, либо явно значиться пробелом в документе.
 */
export const LabelRequisiteSchema = z
  .object({
    id: z.string().min(1),
    label_ru: z.string().min(1),
    /** Подписи на языках экспорта. Необязательны для старых справочников. */
    label_en: z.string().min(1).optional(),
    label_zh: z.string().min(1).optional(),
    /** Откуда берётся значение: профиль бренда, спека изделия, справочник. */
    fills_from: z.enum(['brand_profile', 'style', 'kb', 'manual']),
    required: z.boolean(),
    example_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const LabelingFileSchema = RefBookMetaSchema.extend({
  requisites: z.array(LabelRequisiteSchema).min(1),
});

export type CareProfile = z.infer<typeof CareProfileSchema>;
export type CareSymbolsFile = z.infer<typeof CareSymbolsFileSchema>;
export type LabelRequisite = z.infer<typeof LabelRequisiteSchema>;
export type LabelingFile = z.infer<typeof LabelingFileSchema>;
