import type { Centimeters } from '@specform/core';

/**
 * Геометрия технического чертежа футболки.
 *
 * Всё в сантиметрах, начало координат — точка пересечения линии высших точек
 * плеч с центром переда. Ось X вправо, ось Y вниз. Рисуется правая половина,
 * левая получается зеркалом (knowledge-base/02 §6, правило 2).
 *
 * Ключевое свойство, ради которого всё это существует (R7, R10): геометрия
 * ВЫВОДИТСЯ из замеров, а не рисуется отдельно. Правка ширины по груди
 * двигает пройму, угол рукава и боковой шов — потому что они посчитаны
 * из неё, а не срисованы. Конкурент этого не может: у него чертёж —
 * растровая картинка из генеративной модели.
 */

export interface Point {
  x: number;
  y: number;
}

/** Замеры, из которых строится чертёж. Коды — из шаблона точек футболки. */
export interface FlatMeasurements {
  /** T01 длина изделия от высшей точки плеча. */
  bodyLength: Centimeters;
  /**
   * T03 ширина по груди — замер изделия в плоском виде, от шва до шва.
   *
   * ВНИМАНИЕ на смысл: half-замер это ПОЛНАЯ ширина разложенного изделия
   * (половина обхвата), а не расстояние от центра до бокового шва.
   * На чертеже боковой шов стоит на половине этой величины.
   */
  chestFlat: Centimeters;
  /** T04 ширина по талии в плоском виде. */
  waistFlat: Centimeters;
  /** T05 ширина по низу в плоском виде. */
  hemFlat: Centimeters;
  /** T06 ширина плеч. */
  shoulderWidth: Centimeters;
  /** T09 пройма, хордой от плечевой точки до нижней точки проймы. */
  armhole: Centimeters;
  /** T10 длина рукава от плечевой точки по верхнему сгибу. */
  sleeveLength: Centimeters;
  /**
   * T12 ширина рукава под проймой в плоском виде.
   * Рукав рисуется в один слой, поэтому это и есть его ширина на чертеже.
   */
  bicep: Centimeters;
  /** T13 низ рукава в плоском виде — тоже ширина на чертеже как есть. */
  sleeveOpening: Centimeters;
  /** T14 ширина горловины. */
  neckWidth: Centimeters;
  /** T15 глубина горловины переда. */
  frontNeckDrop: Centimeters;
  /** T16 глубина горловины спинки. */
  backNeckDrop: Centimeters;
  /** T17 высота бейки горловины. */
  neckRibHeight: Centimeters;
  /** T18 наклон плеча — вертикаль от линии высших точек до плечевой точки. */
  shoulderSlope: Centimeters;
}

export interface FlatGeometry {
  /** Высшая точка плеча у горловины. */
  hps: Point;
  /** Плечевая точка — внешний конец плечевого шва. */
  shoulderPoint: Point;
  /** Нижняя точка проймы. */
  underarm: Point;
  /** Центр переда на уровне горловины. */
  neckCenter: Point;
  waist: Point;
  hem: Point;
  hemCenter: Point;
  /** Верхний конец рукава — конец верхнего сгиба. */
  sleeveTopEnd: Point;
  /** Нижний конец рукава — конец нижнего среза. */
  sleeveBottomEnd: Point;
  /** Угол рукава к горизонтали, радианы. Выведен из ширины рукава под проймой. */
  sleeveAngle: number;
  /** Габариты половины чертежа: от центра до крайней точки. */
  bounds: { width: number; height: number };
}

/** Талия по вертикали — доля длины изделия. Пропорция флэта, не замер. */
const WAIST_AT = 0.6;

/**
 * Построение контрольных точек из замеров.
 *
 * Два места, где геометрия решает нетривиальную задачу:
 *
 *  1. Глубина проймы не задана замером напрямую — она следует из хорды проймы
 *     и разницы полуширин плеча и груди по теореме Пифагора.
 *  2. Угол рукава тоже не замер: он подбирается так, чтобы перпендикулярное
 *     расстояние от нижней точки проймы до верхнего сгиба рукава совпало
 *     с шириной рукава под проймой. Поэтому правка этой ширины реально
 *     поворачивает рукав на чертеже.
 */
export function buildGeometry(m: FlatMeasurements, view: 'front' | 'back'): FlatGeometry {
  const neckHalf = m.neckWidth / 2;
  const shoulderHalf = m.shoulderWidth / 2;
  // Боковой шов стоит на половине ширины разложенного изделия — центр переда
  // делит эту ширину пополам. Спутать одно с другим значит удвоить изделие.
  const chestHalf = m.chestFlat / 2;
  const waistHalf = m.waistFlat / 2;
  const hemHalf = m.hemFlat / 2;
  const neckDrop = view === 'front' ? m.frontNeckDrop : m.backNeckDrop;

  const hps: Point = { x: neckHalf, y: 0 };
  const shoulderPoint: Point = { x: shoulderHalf, y: m.shoulderSlope };
  const neckCenter: Point = { x: 0, y: neckDrop };

  // --- Глубина проймы из хорды -----------------------------------------------
  const dx = chestHalf - shoulderHalf;
  const chord = Math.max(m.armhole, Math.abs(dx) + 1); // хорда не короче своей проекции
  const armholeDepth = Math.sqrt(chord * chord - dx * dx);
  const underarm: Point = { x: chestHalf, y: m.shoulderSlope + armholeDepth };

  const waist: Point = { x: waistHalf, y: m.bodyLength * WAIST_AT };
  const hem: Point = { x: hemHalf, y: m.bodyLength };
  const hemCenter: Point = { x: 0, y: m.bodyLength };

  const sleeveAngle = solveSleeveAngle(shoulderPoint, underarm, m.bicep);
  const dir = { x: Math.cos(sleeveAngle), y: Math.sin(sleeveAngle) };
  const perp = { x: -Math.sin(sleeveAngle), y: Math.cos(sleeveAngle) };

  const sleeveTopEnd: Point = {
    x: shoulderPoint.x + dir.x * m.sleeveLength,
    y: shoulderPoint.y + dir.y * m.sleeveLength,
  };
  const sleeveBottomEnd: Point = {
    x: sleeveTopEnd.x + perp.x * m.sleeveOpening,
    y: sleeveTopEnd.y + perp.y * m.sleeveOpening,
  };

  const width = Math.max(chestHalf, hemHalf, sleeveTopEnd.x, sleeveBottomEnd.x);
  const height = Math.max(m.bodyLength, sleeveBottomEnd.y, sleeveTopEnd.y);

  return {
    hps,
    shoulderPoint,
    underarm,
    neckCenter,
    waist,
    hem,
    hemCenter,
    sleeveTopEnd,
    sleeveBottomEnd,
    sleeveAngle,
    bounds: { width, height },
  };
}

/**
 * Угол рукава, при котором ширина под проймой совпадает с замером.
 *
 * Перпендикулярное расстояние от нижней точки проймы до прямой, выходящей
 * из плечевой точки под углом θ, равно |vx·sinθ − vy·cosθ|. Приравниваем
 * его к ширине рукава и решаем относительно θ.
 *
 * Уравнение вида a·sinθ + b·cosθ = c решается через вспомогательный угол.
 * Если решения нет (замеры несовместимы геометрически), берём разумный
 * дефолт — чертёж обязан построиться и в этом случае, просто ширина рукава
 * на нём будет отличаться от таблицы.
 */
function solveSleeveAngle(shoulder: Point, underarm: Point, bicep: number): number {
  const FALLBACK = (20 * Math.PI) / 180;

  const vx = underarm.x - shoulder.x;
  const vy = underarm.y - shoulder.y;

  // vx·sinθ − vy·cosθ = −bicep  (нижняя точка проймы лежит под линией рукава)
  const r = Math.hypot(vx, vy);
  if (r === 0) return FALLBACK;

  const ratio = -bicep / r;
  if (Math.abs(ratio) > 1) return FALLBACK;

  const phase = Math.atan2(-vy, vx);
  const theta = Math.asin(ratio) - phase;

  // Рукав идёт вниз и наружу: угол в разумных пределах, иначе чертёж «ломается».
  const MIN = (5 * Math.PI) / 180;
  const MAX = (55 * Math.PI) / 180;
  if (!Number.isFinite(theta) || theta < MIN || theta > MAX) return FALLBACK;
  return theta;
}

/** Фактическая ширина рукава под проймой на построенной геометрии. */
export function measuredBicep(g: FlatGeometry): number {
  const vx = g.underarm.x - g.shoulderPoint.x;
  const vy = g.underarm.y - g.shoulderPoint.y;
  return Math.abs(vx * Math.sin(g.sleeveAngle) - vy * Math.cos(g.sleeveAngle));
}
