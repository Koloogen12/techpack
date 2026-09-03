import { z } from 'zod';
import { RefBookMetaSchema, VerifiabilitySchema, verifiabilityRefinement } from './common.js';

/**
 * Ракурсы съёмки.
 *
 * Модель разбора не знает, что именно на снимке, если ей не сказать: шесть
 * файлов «фотографии одного изделия» она читает как шесть равноправных кадров
 * и одинаково добросовестно ищет спинку на снимке переда.
 *
 * Объявленный ракурс делает две вещи. Направляет промпт — от каждого кадра
 * спрашивается то, что на нём вообще может быть видно. И позволяет посчитать,
 * какой НЕДОСТАЮЩИЙ кадр переведёт больше всего замеров из предположений
 * в наблюдения: это единственный совет по точности, который стоит человеку
 * тридцати секунд, а не денег.
 */
export const PHOTO_VIEWS = [
  'front_flat',
  'back_flat',
  'detail_neck',
  'detail_hem',
  'detail_sleeve',
  'inside_out',
  'on_form',
  'sketch',
] as const;

export const PhotoViewSchema = z.enum(PHOTO_VIEWS);
export type PhotoView = z.infer<typeof PhotoViewSchema>;

export const PhotoViewEntrySchema = z
  .object({
    id: PhotoViewSchema,
    label_ru: z.string().min(1),
    /** Без обязательного ракурса разбор не запускается. */
    required: z.boolean(),
    how_to_shoot_ru: z.string().min(1),
    /**
     * Точки измерения, которые этот кадр делает наблюдаемыми.
     * Пусто — кадр не даёт замеров вообще (изнанка, съёмка на фигуре).
     */
    unlocks_pom: z.array(z.string().regex(/^[A-Z]\d{2}$/)),
    /** Признаки карты видимости, которые открывает кадр. */
    unlocks_features: z.array(z.string().min(1)),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const PhotoViewsFileSchema = RefBookMetaSchema.extend({
  views: z.array(PhotoViewEntrySchema).min(1),
}).superRefine((file, ctx) => {
  // Ровно один обязательный кадр: если их станет два, продукт молча начнёт
  // отказывать людям, приславшим одну фотографию, — а это основной сценарий.
  const required = file.views.filter((v) => v.required);
  if (required.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: `обязательный ракурс обязан быть ровно один, сейчас ${required.length}`,
      path: ['views'],
    });
  }
});

export type PhotoViewEntry = z.infer<typeof PhotoViewEntrySchema>;
export type PhotoViewsFile = z.infer<typeof PhotoViewsFileSchema>;
