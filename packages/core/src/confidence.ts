/**
 * Статусы уверенности значения — сквозной принцип продукта.
 * Источник: TECH-REQUIREMENTS-PIPELINE.md §0.2, ux/02 Приложение А, CTO-SPEC.md §1.3.
 *
 * В интерфейсе показываются человеческими словами (ux/00, словарь):
 *   fit_confirmed        → «подтверждено по образцу»
 *   user_input           → «указано вами»
 *   measured_by_scale    → «измерено по масштабу»
 *   estimated_from_photo → «оценка по фото»
 *   default_from_base    → «типовое значение»
 *   assumption           → «предположение — подтвердить по образцу»
 */
export const CONFIDENCE_LEVELS = [
  'fit_confirmed',
  'user_input',
  /**
   * Величина получена из снимка, но не оценкой пропорции, а пересчётом через
   * предмет известного размера в кадре (лист А4, банковская карта). Это уже
   * измерение, а не оценка: монокулярная неоднозначность масштаба снята.
   *
   * Ниже «указано вами» намеренно: человек держит вещь в руках и может нас
   * поправить, а мы работаем по фотографии.
   */
  'measured_by_scale',
  'estimated_from_photo',
  'default_from_base',
  'assumption',
] as const;

export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Иерархия доверия по убыванию. Чем больше число, тем выше доверие.
 * Используется при слиянии двух источников на одно поле: выигрывает более высокий ранг.
 */
const RANK: Record<Confidence, number> = {
  fit_confirmed: 6,
  user_input: 5,
  measured_by_scale: 4,
  estimated_from_photo: 3,
  default_from_base: 2,
  assumption: 1,
};

export function confidenceRank(c: Confidence): number {
  return RANK[c];
}

/**
 * Статус требует подтверждения по образцу перед запуском в производство.
 * Работает со статусом. Для проверки значения целиком есть `needsConfirmation(t: Tracked)`
 * в tracked.ts — имена разведены намеренно: коллизия в `export *` делает
 * реэкспорт неоднозначным и молча ломает счётчик предположений.
 */
export function levelNeedsConfirmation(c: Confidence): boolean {
  return c === 'assumption';
}

/** Значение посчитано системой, а не сообщено человеком. */
export function isDerived(c: Confidence): boolean {
  return c === 'estimated_from_photo' || c === 'default_from_base' || c === 'assumption';
}

/** Человекочитаемая подпись для интерфейса и PDF. Словарь ux/00. */
export const CONFIDENCE_LABEL_RU: Record<Confidence, string> = {
  fit_confirmed: 'подтверждено по образцу',
  user_input: 'указано вами',
  measured_by_scale: 'измерено по масштабу',
  estimated_from_photo: 'оценка по фото',
  default_from_base: 'типовое значение',
  assumption: 'предположение',
};
