import { kb as defaultKb, type KnowledgeBase } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';
import { measurementsFrom, needsSideView, type RenderOptions } from './render.js';
import { garmentDepth } from './side.js';

/**
 * Величины чертежа, которых нет в табеле мер.
 *
 * Их две, и обе приходят из справочников: глубина изделия для бокового вида
 * и минимальный угол отведения рукава. Собраны в одном месте намеренно —
 * вызывающих сторон четыре (документ, превью раппорта, лист колорвеев,
 * скрипт предпросмотра), и стоит одной забыть передать величину, как чертёж
 * молча возвращается к прежнему поведению: бок исчезает, рукав ложится
 * под 19°. Тихий откат хуже явной ошибки, поэтому сборка одна на всех.
 *
 * Сам чертёж в справочники по-прежнему не ходит: он получает числа
 * аргументами и остаётся чистой проекцией спеки.
 */
export function flatDefaults(
  spec: StyleSpec,
  base: KnowledgeBase = defaultKb(),
): Pick<RenderOptions, 'depthCm' | 'minSleeveAngleDeg' | 'hoodDrawFactor'> {
  const m = measurementsFrom(spec);
  const angle = base.sleeveAngle(m.sleeveLength, spec.base.fit_intent);
  const hoodDrawFactor = base.hoodDrawFactor();

  if (!needsSideView(spec)) {
    return { minSleeveAngleDeg: angle.min_angle_deg, hoodDrawFactor };
  }

  const body = base.bodyMeasurements(spec.base.gender, spec.base.base_size_ru);
  return {
    minSleeveAngleDeg: angle.min_angle_deg,
    hoodDrawFactor,
    depthCm: garmentDepth(m.chestFlat, {
      bodyChest: body.chest,
      widthToDepth: base.bodyRatio(spec.base.gender).width_to_depth,
    }),
  };
}
