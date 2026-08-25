import { type Confidence, confidenceRank, levelNeedsConfirmation } from './confidence.js';

/**
 * Обёртка значения вместе с его происхождением.
 *
 * Принцип CTO-SPEC.md §1.3: «значение без источника не компилируется».
 * Тип делает это буквальным — создать Tracked без confidence и source нельзя.
 */
export interface Tracked<T> {
  readonly value: T;
  readonly confidence: Confidence;
  /**
   * Откуда именно взялось значение. Не свободный текст, а адрес:
   *   'kb:pom_templates/tshirt#T03'   — из справочника
   *   'vision:v1#chest_ratio'         — из анализа фото
   *   'user:wizard.base_size'         — сообщено пользователем
   *   'engine:pom/grading'            — вычислено движком
   */
  readonly source: string;
  /** Человеческим языком: что с этим делать. Например «уточнить у фабрики». */
  readonly note?: string;
}

export function track<T>(
  value: T,
  confidence: Confidence,
  source: string,
  note?: string,
): Tracked<T> {
  return note === undefined ? { value, confidence, source } : { value, confidence, source, note };
}

export const fitConfirmed = <T>(value: T, source: string, note?: string): Tracked<T> =>
  track(value, 'fit_confirmed', source, note);

export const userInput = <T>(value: T, source: string, note?: string): Tracked<T> =>
  track(value, 'user_input', source, note);

/** Пересчитано через предмет известного размера в кадре — измерение, не оценка. */
export const measuredByScale = <T>(value: T, source: string, note?: string): Tracked<T> =>
  track(value, 'measured_by_scale', source, note);

export const fromPhoto = <T>(value: T, source: string, note?: string): Tracked<T> =>
  track(value, 'estimated_from_photo', source, note);

export const fromBase = <T>(value: T, source: string, note?: string): Tracked<T> =>
  track(value, 'default_from_base', source, note);

export const assume = <T>(value: T, source: string, note?: string): Tracked<T> =>
  track(value, 'assumption', source, note);

/**
 * Слияние двух источников на одно поле.
 * Выигрывает более высокий ранг доверия; при равенстве — второй аргумент
 * (он считается более поздним по времени).
 */
export function mergeTracked<T>(a: Tracked<T>, b: Tracked<T>): Tracked<T> {
  return confidenceRank(b.confidence) >= confidenceRank(a.confidence) ? b : a;
}

/**
 * Преобразование значения с сохранением происхождения.
 * Используется, например, при конвертации единиц: число меняется, источник — нет.
 */
export function mapTracked<T, U>(t: Tracked<T>, fn: (value: T) => U): Tracked<U> {
  return t.note === undefined
    ? { value: fn(t.value), confidence: t.confidence, source: t.source }
    : { value: fn(t.value), confidence: t.confidence, source: t.source, note: t.note };
}

/**
 * Пересчёт значения движком поверх исходного.
 * Понижает доверие до указанного уровня и переписывает источник —
 * тихо унаследовать чужой confidence нельзя.
 */
export function derive<T, U>(
  t: Tracked<T>,
  fn: (value: T) => U,
  confidence: Confidence,
  source: string,
  note?: string,
): Tracked<U> {
  return track(fn(t.value), confidence, source, note);
}

export function needsConfirmation(t: Tracked<unknown>): boolean {
  return levelNeedsConfirmation(t.confidence);
}

/** Развернуть значение. Явная функция вместо `.value` — чтобы разворот был виден в коде. */
export function unwrap<T>(t: Tracked<T>): T {
  return t.value;
}

/** Сколько значений в наборе требуют подтверждения. Считает счётчик «Предположения: N». */
export function countAssumptions(items: readonly Tracked<unknown>[]): number {
  return items.reduce((n, t) => (needsConfirmation(t) ? n + 1 : n), 0);
}
