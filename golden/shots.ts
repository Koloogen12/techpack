import type { PhotoView } from '@seamster/kb';

/**
 * Из чего состоит голден-набор: какие снимки, каким ракурсом, к какой анкете.
 *
 * Один список на прогрев кэша, выгрузку фикстур и тесты — иначе они разъедутся
 * и разбор в тесте перестанет соответствовать разбору, который мы оплатили.
 */
export interface GoldenShot {
  /** Имя фикстуры в golden/vision-reports. */
  id: string;
  category: 'tshirt' | 'longsleeve' | 'sweatshirt' | 'hoodie';
  /** Файл анкеты без каталога. */
  answers: string;
  photos: { file: string; view: PhotoView }[];
}

const core = (category: GoldenShot['category']): GoldenShot => ({
  id: category,
  category,
  answers: `${category}-women-46.json`,
  photos: [
    { file: `golden/photos/${category}-front.png`, view: 'front_flat' },
    { file: `golden/photos/${category}-back.png`, view: 'back_flat' },
  ],
});

export const GOLDEN_SHOTS: readonly GoldenShot[] = [
  core('tshirt'),
  core('longsleeve'),
  core('sweatshirt'),
  core('hoodie'),
  {
    // Отдельный набор под масштабный объект: тот же худи, но с листом А4
    // на груди. Нужен, чтобы распознавание масштаба проверялось живым выходом
    // модели, а не выдуманным отчётом.
    id: 'hoodie-a4',
    category: 'hoodie',
    answers: 'hoodie-women-46.json',
    photos: [{ file: 'golden/photos/hoodie-front-a4.png', view: 'front_flat' }],
  },
];
