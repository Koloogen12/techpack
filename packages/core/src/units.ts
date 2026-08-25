/**
 * Единицы измерения. Правила — ADR-0004.
 *
 * Внутренняя модель ВСЕГДА в сантиметрах. Дюймы существуют только как
 * отображение: ввод конвертируется в см на границе, хранение и расчёты — в см,
 * PDF и diff версий — в см.
 */

/**
 * Сантиметры. Алиас, а не branded-тип — осознанно:
 * точка конвертации в системе ровно одна (ввод пользователя), и брендирование
 * дало бы касты в каждой арифметической операции движка без выигрыша.
 * Риск закрыт тем, что наружу единица не утекает, и тестом round-trip.
 */
export type Centimeters = number;

export type LengthUnit = 'cm' | 'in';

const CM_PER_INCH = 2.54;

/** Точность хранения замеров — 0.1 см (ADR-0004 §1). */
export const CM_PRECISION = 1;

/**
 * Округление до точности хранения.
 * Применяется ОДИН раз — при записи значения в StyleSpec.
 * Промежуточные округления запрещены: они накапливают ошибку в градации на краях ряда.
 */
export function roundCm(value: number): Centimeters {
  const f = 10 ** CM_PRECISION;
  return Math.round(value * f) / f;
}

/** Округление допуска — та же точность, что и у замера. */
export const roundTolerance = roundCm;

export function inchesToCm(inches: number): Centimeters {
  return inches * CM_PER_INCH;
}

export function cmToInches(value: Centimeters): number {
  return value / CM_PER_INCH;
}

/** Единственная точка входа для пользовательского ввода длины. */
export function parseLength(value: number, unit: LengthUnit): Centimeters {
  return roundCm(unit === 'in' ? inchesToCm(value) : value);
}

/** Форматирование для отображения. Внутреннее значение не меняется. */
export function formatLength(value: Centimeters, unit: LengthUnit): string {
  const n = unit === 'in' ? cmToInches(value) : value;
  return n.toFixed(unit === 'in' ? 2 : 1);
}

/**
 * Как измеряется точка. Свойство точки, а не соглашение на уровне таблицы —
 * ADR-0004 §2. Движок никогда не догадывается, half это или обхват.
 */
export const MEASURE_KINDS = ['half', 'circumference', 'length', 'angle'] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number];

/** Обхват изделия → ширина в плоском виде. */
export function circumferenceToHalf(circumference: Centimeters): Centimeters {
  return circumference / 2;
}

/** Ширина в плоском виде → обхват изделия. */
export function halfToCircumference(half: Centimeters): Centimeters {
  return half * 2;
}

/** Ограничение значения правдоподобным диапазоном категории (клэмп POM-движка). */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`clamp: min ${min} больше max ${max}`);
  return Math.min(Math.max(value, min), max);
}
