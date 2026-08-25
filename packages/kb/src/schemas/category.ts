import { z } from 'zod';
import {
  CategorySchema,
  FabricKindSchema,
  RefBookMetaSchema,
  VerifiabilitySchema,
  verifiabilityRefinement,
} from './common.js';
import { MachineTypeSchema, SpecialtySchema } from './construction.js';

/**
 * Операция технологической последовательности (knowledge-base/04 §5).
 *
 * РФ-формат: перечень неделимых операций в порядке выполнения с указанием
 * специальности, разряда, времени и оборудования. Из этого перечня фабрика
 * считает нормо-часы, поэтому он входит в чек-лист приёмки технолога.
 */
export const TechOperationSchema = z.object({
  step: z.number().int().positive(),
  operation_ru: z.string().min(1),
  /** Узел обработки. null — операция без шва: заутюжить, вывернуть, упаковать. */
  node_id: z.string().nullable(),
  specialty: SpecialtySchema,
  /** Заполняется только для операций без узла — иначе машина берётся из узла. */
  machine: MachineTypeSchema.nullable(),
  /** Норма времени, секунд. null — данных нет, см. gap файла. */
  time_sec: z.number().positive().nullable(),
});

export const CategoryDefaultsFileSchema = RefBookMetaSchema.extend({
  category: CategorySchema,
  fabric_kind: FabricKindSchema,
  /** Узлы, которые подставляются, пока фото не сказало иного. */
  default_nodes: z.array(z.string().min(1)).min(1),
  tech_sequence: z.array(TechOperationSchema).min(1),
})
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement)
  .superRefine((file, ctx) => {
    const steps = file.tech_sequence.map((o) => o.step);
    const expected = Array.from({ length: steps.length }, (_, i) => i + 1);
    if (steps.join() !== expected.join()) {
      ctx.addIssue({
        code: 'custom',
        message: `номера операций обязаны идти подряд с единицы, получено: ${steps.join(', ')}`,
        path: ['tech_sequence'],
      });
    }
    for (const op of file.tech_sequence) {
      if (op.node_id === null && op.machine === null) {
        ctx.addIssue({
          code: 'custom',
          message: `операция ${op.step} без узла обязана называть оборудование`,
          path: ['tech_sequence'],
        });
      }
    }
  });

/**
 * Карта «видно с фото / не видно» (knowledge-base/04 §7).
 *
 * Два потребителя. Первый — промпт vision-этапа: список видимого задаёт,
 * что модель вправе утверждать. Второй — блок предположений в документе:
 * каждый невидимый параметр обязан получить статус «предположение»
 * и пометку «уточнить у заказчика или по образцу».
 */
export const VisibleFeatureSchema = z.object({
  key: z.string().min(1),
  label_ru: z.string().min(1),
  hint_ru: z.string().min(1),
});

export const InvisibleFeatureSchema = z.object({
  key: z.string().min(1),
  label_ru: z.string().min(1),
  /** Что подставляется вместо наблюдения. */
  default_ru: z.string().min(1),
  /** Что пользователь должен сделать, чтобы значение перестало быть догадкой. */
  note_ru: z.string().min(1),
});

export const VisibilityMapFileSchema = RefBookMetaSchema.extend({
  visible: z.array(VisibleFeatureSchema).min(1),
  not_visible: z.array(InvisibleFeatureSchema).min(1),
})
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export type TechOperation = z.infer<typeof TechOperationSchema>;
export type CategoryDefaultsFile = z.infer<typeof CategoryDefaultsFileSchema>;
export type VisibleFeature = z.infer<typeof VisibleFeatureSchema>;
export type InvisibleFeature = z.infer<typeof InvisibleFeatureSchema>;
export type VisibilityMapFile = z.infer<typeof VisibilityMapFileSchema>;
