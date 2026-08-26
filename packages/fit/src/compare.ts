import { roundCm } from '@seamsterly/core';
import type { StyleSpec } from '@seamsterly/stylespec';
import { effectiveValue, type MeasuredSet } from './schema.js';

/**
 * Сравнение спеки с реальным изделием.
 *
 * Ключевое решение — метрика. Считать «среднюю ошибку в сантиметрах»
 * заманчиво, но фабрика работает не по средней ошибке, а по ДОПУСКУ,
 * который документ сам же объявил. Если ширина по груди отличается
 * на 0.8 см при допуске ±1.0, ОТК примет изделие: документ не соврал.
 * Если та же 0.8 см стоит на мелкой точке с допуском ±0.3 — соврал.
 *
 * Поэтому главная метрика — доля точек, попавших в собственный допуск.
 * Сантиметры остаются как вспомогательные: по ним видно направление сноса,
 * а это уже подсказка для калибровки справочника.
 */

export type Verdict = 'in_tolerance' | 'near_miss' | 'out_of_tolerance' | 'not_measured';

export interface PointComparison {
  code: string;
  name_ru: string;
  /** Что выдал пайплайн, см. */
  spec_cm: number;
  /** Что показала рулетка, см. Пусто — точку не мерили. */
  measured_cm: number | null;
  tolerance_cm: number;
  /** Отклонение спеки от факта. Положительное — мы завысили. */
  delta_cm: number | null;
  /** Отклонение в долях допуска: 1.0 — ровно на границе. */
  delta_in_tolerances: number | null;
  verdict: Verdict;
  /** Откуда пайплайн взял значение — важно при разборе промахов. */
  confidence: string;
}

export interface ComparisonResult {
  id: string;
  category: string;
  points: PointComparison[];
  /** Сколько точек удалось сравнить. */
  compared: number;
  /** Главная метрика: доля попавших в допуск, 0…1. */
  in_tolerance_rate: number;
  /** Средний модуль отклонения по сравненным точкам, см. */
  mean_abs_error_cm: number;
  /** Наибольшее отклонение, см. */
  max_abs_error_cm: number;
  /**
   * Средний ЗНАКОВЫЙ снос: систематически завышаем или занижаем.
   * Отличие от среднего модуля — здесь видно направление.
   */
  mean_bias_cm: number;
  /** Точки, промахнувшиеся мимо допуска, худшие сверху. */
  misses: PointComparison[];
}

/**
 * Промах «на грани»: вышли за допуск, но меньше чем на его половину сверх.
 * Такие точки чинятся калибровкой справочника, а не пересмотром подхода.
 */
const NEAR_MISS_LIMIT = 1.5;

export function compare(spec: StyleSpec, measured: MeasuredSet): ComparisonResult {
  const byCode = new Map(measured.values.map((v) => [v.code, effectiveValue(v)]));

  const points: PointComparison[] = spec.measurements.points.map((p) => {
    const actual = byCode.get(p.code);
    const tolerance = p.tolerance.value;

    if (actual === undefined) {
      return {
        code: p.code,
        name_ru: p.name_ru,
        spec_cm: p.base.value,
        measured_cm: null,
        tolerance_cm: tolerance,
        delta_cm: null,
        delta_in_tolerances: null,
        verdict: 'not_measured' as const,
        confidence: p.base.confidence,
      };
    }

    const delta = roundCm(p.base.value - actual);
    const ratio = Math.abs(delta) / tolerance;

    return {
      code: p.code,
      name_ru: p.name_ru,
      spec_cm: p.base.value,
      measured_cm: roundCm(actual),
      tolerance_cm: tolerance,
      delta_cm: delta,
      delta_in_tolerances: Math.round(ratio * 100) / 100,
      verdict:
        ratio <= 1
          ? ('in_tolerance' as const)
          : ratio <= NEAR_MISS_LIMIT
            ? ('near_miss' as const)
            : ('out_of_tolerance' as const),
      confidence: p.base.confidence,
    };
  });

  const compared = points.filter((p) => p.delta_cm !== null);
  const deltas = compared.map((p) => p.delta_cm!);
  const abs = deltas.map(Math.abs);

  const misses = compared
    .filter((p) => p.verdict !== 'in_tolerance')
    .sort((a, b) => b.delta_in_tolerances! - a.delta_in_tolerances!);

  return {
    id: measured.id,
    category: spec.style.category,
    points,
    compared: compared.length,
    in_tolerance_rate: compared.length
      ? compared.filter((p) => p.verdict === 'in_tolerance').length / compared.length
      : 0,
    mean_abs_error_cm: compared.length ? roundCm(mean(abs)) : 0,
    max_abs_error_cm: compared.length ? roundCm(Math.max(...abs)) : 0,
    mean_bias_cm: compared.length ? roundCm(mean(deltas)) : 0,
    misses,
  };
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Порог приёмки голден-набора.
 *
 * Взят из логики RAT-3, а не из головы: пробник по нашему техпаку должен
 * укладываться в те же две итерации, что и пробник конструктора. Документ,
 * у которого каждая пятая точка вне собственного допуска, столько итераций
 * не даст. Значение пересматривается по результатам первых отшивов.
 */
export const ACCEPTANCE = {
  /** Доля точек в допуске, ниже которой набор считается непройденным. */
  min_in_tolerance_rate: 0.8,
  /** Ни одна точка не должна промахиваться больше чем на два допуска. */
  max_delta_in_tolerances: 2,
} as const;

export function passes(result: ComparisonResult): boolean {
  if (result.compared === 0) return false;
  if (result.in_tolerance_rate < ACCEPTANCE.min_in_tolerance_rate) return false;
  return !result.points.some(
    (p) =>
      p.delta_in_tolerances !== null && p.delta_in_tolerances > ACCEPTANCE.max_delta_in_tolerances,
  );
}
