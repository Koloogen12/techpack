import { z } from 'zod';
import { CategorySchema, FitIntentSchema } from '@seamster/kb';

/**
 * Что известно о шаблоне библиотеки.
 *
 * Разделено на то, что видно из файлов (габарит, число видов, путь), и то,
 * что опознала модель по превью (категория, посадка, детали). Второе живёт
 * рядом с первым, а не вместо него: если каталогизацию придётся переделать
 * на другой модели, файлы и их геометрия останутся теми же.
 */

/** Признаки, по которым шаблон подбирается под изделие. */
export const TemplateTraitsSchema = z.object({
  category: CategorySchema.nullable(),
  /** Свободная категория, если наша перечисление её не покрывает. */
  category_other: z.string().nullable(),
  fit: FitIntentSchema.nullable(),
  hood: z.boolean(),
  /** Тип застёжки: сквозная молния, половинная, без застёжки. */
  closure: z.enum(['none', 'full_zip', 'half_zip', 'buttons', 'other']),
  pocket: z.enum(['none', 'kangaroo', 'patch', 'welt', 'other']),
  sleeve: z.enum(['none', 'short', 'long', 'raglan', 'other']),
  /** Рибаны манжет и низа — узнаваемая черта трикотажной группы. */
  ribbed: z.boolean(),
  /** Что ещё стоит знать: капюшон на подкладке, кроп, реглан, вытачки. */
  features: z.array(z.string()),
  /** Уверенность модели в категории. */
  confidence: z.enum(['high', 'medium', 'low']),
});
export type TemplateTraits = z.infer<typeof TemplateTraitsSchema>;

export const TemplateEntrySchema = z.object({
  id: z.string().min(1),
  /** Грубая группа из структуры датасета: чем разложены файлы. */
  group: z.string().min(1),
  source_file: z.string().min(1),
  svg_front: z.string().min(1),
  svg_back: z.string().nullable(),
  preview: z.string().nullable(),
  aspect: z.number().positive(),
  paths_front: z.number().int().nonnegative(),
  paths_back: z.number().int().nonnegative(),
  notes: z.array(z.string()),
  /** Заполняется каталогизацией по превью. Пусто — шаблон ещё не разобран. */
  traits: TemplateTraitsSchema.nullable().optional(),
  /**
   * Сколько раз шаблон выбрали.
   *
   * Счётчик — очередь на повышение: часто выбираемый силуэт заслуживает
   * ручной разметки контрольных точек и переезда в мастера, где он начнёт
   * деформироваться под замеры, а не только масштабироваться.
   */
  promotion_score: z.number().int().nonnegative().optional(),
});
export type TemplateEntry = z.infer<typeof TemplateEntrySchema>;

export const TemplateManifestSchema = z.object({
  id: z.literal('template_library'),
  version: z.string().min(1),
  description: z.string().min(1),
  source: z.string().min(1),
  ingested_entries: z.number().int().nonnegative(),
  entries: z.array(TemplateEntrySchema),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;
