import { roundCm } from '@seamster/core';
import type { ComparisonResult, PointComparison } from './compare.js';

/**
 * Подсказки по калибровке справочников.
 *
 * Это та самая петля обучения продукта без ML-тренинга (CTO-SPEC §1.7):
 * рулетка показывает систематический снос, снос превращается в правку
 * отношения в справочнике, правка уходит в репозиторий через PR
 * с описанием причины.
 *
 * Осторожность здесь важнее полноты. Подсказка по двум изделиям — это
 * не закономерность, а совпадение; правка справочника по совпадению
 * ухудшит всё остальное. Поэтому подсказка выдаётся только когда снос
 * устойчив по знаку, заметен по величине и подтверждён несколькими вещами.
 */

export interface CalibrationHint {
  code: string;
  name_ru: string;
  /** По скольким изделиям посчитано. */
  samples: number;
  /** Средний относительный снос: 0.08 означает, что мы завышаем на 8%. */
  relative_bias: number;
  /** Средний снос в сантиметрах — для человеческого чтения. */
  bias_cm: number;
  /** На что домножить текущее отношение в справочнике. */
  suggested_ratio_factor: number;
  /** Насколько уверенно: сколько изделий подтверждают знак сноса. */
  agreement: number;
  reason_ru: string;
}

export interface CalibrationReport {
  /** Изделий в выборке. */
  samples: number;
  hints: CalibrationHint[];
  /** Точки со сносом, но недостаточным подтверждением — смотреть, не править. */
  watch: { code: string; name_ru: string; samples: number; relative_bias: number }[];
  /** Общий снос по всем точкам: признак ошибки в якоре, а не в отношениях. */
  overall_bias_cm: number;
}

/** Минимум изделий, при котором снос перестаёт быть совпадением. */
const MIN_SAMPLES = 3;

/** Снос меньше этого — шум измерения, а не систематика. */
const MIN_RELATIVE_BIAS = 0.04;

/**
 * Снос меньше этого в САНТИМЕТРАХ не считается систематикой, каким бы
 * большим он ни выглядел в процентах.
 *
 * Протокол требует читать ленту с точностью до половины сантиметра, значит
 * половина сантиметра — предел разрешения самого измерения. На мелких точках
 * относительный снос это правило нарушает: 0.3 см на бейке высотой 2 см
 * выглядят как 15% и просятся в подсказку, хотя это ровно та погрешность,
 * с которой человек читает рулетку. Найдено на демонстрационном прогоне.
 */
const MIN_ABSOLUTE_BIAS_CM = 0.5;

/** Доля изделий, которые обязаны подтвердить знак сноса. */
const MIN_AGREEMENT = 0.75;

export function calibrate(results: readonly ComparisonResult[]): CalibrationReport {
  const byCode = new Map<string, PointComparison[]>();

  for (const result of results) {
    for (const p of result.points) {
      if (p.delta_cm === null || p.measured_cm === null || p.measured_cm === 0) continue;
      byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
    }
  }

  const hints: CalibrationHint[] = [];
  const watch: CalibrationReport['watch'] = [];
  const allDeltas: number[] = [];

  for (const [code, points] of byCode) {
    for (const p of points) allDeltas.push(p.delta_cm!);

    const relatives = points.map((p) => p.delta_cm! / p.measured_cm!);
    const relativeBias = mean(relatives);
    const sign = Math.sign(relativeBias);
    const agreement = relatives.filter((r) => Math.sign(r) === sign).length / relatives.length;
    const name_ru = points[0]!.name_ru;

    const biasCm = mean(points.map((p) => p.delta_cm!));
    const enough = points.length >= MIN_SAMPLES;
    const notable =
      Math.abs(relativeBias) >= MIN_RELATIVE_BIAS && Math.abs(biasCm) >= MIN_ABSOLUTE_BIAS_CM;
    const consistent = agreement >= MIN_AGREEMENT;

    if (!notable) continue;

    if (!enough || !consistent) {
      watch.push({
        code,
        name_ru,
        samples: points.length,
        relative_bias: round(relativeBias, 3),
      });
      continue;
    }

    hints.push({
      code,
      name_ru,
      samples: points.length,
      relative_bias: round(relativeBias, 3),
      bias_cm: roundCm(biasCm),
      // Завысили на 8% — уменьшаем отношение в 1.08 раза.
      suggested_ratio_factor: round(1 / (1 + relativeBias), 4),
      agreement: round(agreement, 2),
      reason_ru:
        `На ${points.length} изделиях ${relativeBias > 0 ? 'завышаем' : 'занижаем'} ` +
        `в среднем на ${Math.abs(round(relativeBias * 100, 1))}% ` +
        `(${Math.abs(roundCm(biasCm))} см). ` +
        `Знак сноса подтверждают ${Math.round(agreement * 100)}% изделий.`,
    });
  }

  hints.sort((a, b) => Math.abs(b.relative_bias) - Math.abs(a.relative_bias));
  watch.sort((a, b) => Math.abs(b.relative_bias) - Math.abs(a.relative_bias));

  return {
    samples: results.length,
    hints,
    watch,
    overall_bias_cm: allDeltas.length ? roundCm(mean(allDeltas)) : 0,
  };
}

/**
 * Общий снос в одну сторону по всем точкам означает, что ошибка не в отдельных
 * отношениях, а в якоре масштаба: в размерной сетке или в прибавке на посадку.
 * Править отношения по одному в этом случае — лечить симптом.
 */
export function anchorSuspect(report: CalibrationReport): string | null {
  if (report.samples < MIN_SAMPLES) return null;
  const sameDirection = report.hints.filter(
    (h) => Math.sign(h.relative_bias) === Math.sign(report.overall_bias_cm),
  );
  if (report.hints.length >= 4 && sameDirection.length / report.hints.length >= 0.8) {
    return (
      `Снос идёт в одну сторону сразу по ${sameDirection.length} точкам ` +
      `(в среднем ${report.overall_bias_cm} см). Похоже, дело не в отдельных отношениях, ` +
      `а в якоре масштаба: проверьте прибавку на посадку и размерную сетку прежде, ` +
      `чем править отношения по одному.`
    );
  }
  return null;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
