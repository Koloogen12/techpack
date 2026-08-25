import { z } from 'zod';

/**
 * Библиотека артов бренда.
 *
 * Раппорт и макет — актив бренда, а не приложение к одному техпаку.
 * Один и тот же рисунок идёт на футболку, худи и свитшот одной капсулы,
 * и переносить его между паками копированием паспорта вручную значит
 * гарантированно однажды ошибиться в цифре шага или в отпечатке.
 *
 * Поэтому арт живёт отдельно и имеет свой паспорт. Пак ссылается на него
 * по идентификатору, а не пересказывает его поля.
 *
 * Отпечаток входа генерации хранится вместе с артом: через полгода надо
 * уметь ответить, из каких референсов и по какому брифу он получен —
 * иначе повторный заказ воспроизвести нечем.
 */

export const ARTWORK_KINDS = ['tile', 'placement'] as const;
export const ArtworkKindSchema = z.enum(ARTWORK_KINDS);
export type ArtworkKind = z.infer<typeof ArtworkKindSchema>;

export const AssetColorSchema = z.object({
  hex: z.string().regex(/^#[0-9A-F]{6}$/),
  share: z.number().min(0).max(1),
  book_code: z.string().min(1).nullable().optional(),
  book_source: z.enum(['brand', 'catalog']).nullable().optional(),
});

export const ArtworkAssetSchema = z.object({
  /** Короткое имя, которым арт зовут в анкете. */
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{1,40}$/, 'имя арта: латиница в нижнем регистре, цифры, дефис'),
  kind: ArtworkKindSchema,
  label_ru: z.string().min(1),
  /** Имя файла рядом с паспортом. */
  file: z.string().min(1),
  pixels: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /**
   * Отпечаток входа генерации. Пусто — арт принёс заказчик, а не сгенерирован.
   * Разница существенная: свой файл заказчика мы не перегенерируем никогда.
   */
  key: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  /** Бриф, по которому арт сделан. Нужен, чтобы повторить или развить. */
  brief: z.string().min(1).nullable(),
  /** Свойства раппорта. У локального макета их нет. */
  seam: z
    .object({
      ratio: z.number().nonnegative(),
      seamless: z.boolean(),
      mirrored: z.boolean(),
    })
    .nullable(),
  colors: z.array(AssetColorSchema),
  vector_available: z.boolean(),
  vector_verdict_ru: z.string().min(1),
  /** Дата добавления, ISO. */
  created_at: z.string().min(1),
  /**
   * Артикулы паков, где арт использован.
   *
   * «Использован в N паках» — это не украшение каталога: увидев, что рисунок
   * ушёл в три изделия, человек понимает, что правка тронет все три.
   */
  used_in: z.array(z.string().min(1)),
});

export type ArtworkAsset = z.infer<typeof ArtworkAssetSchema>;
export type AssetColor = z.infer<typeof AssetColorSchema>;
