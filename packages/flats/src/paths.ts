import { buildGeometry, type FlatGeometry, type FlatMeasurements, type Point } from './geometry.js';

/**
 * Построение путей чертежа.
 *
 * Конвенции линий — knowledge-base/02 §3, они же спецификация генератора:
 * контур толще внутренних швов, отстрочка пунктиром, скрытое точками.
 * Число пунктирных линий равно числу реальных параллельных строчек —
 * по нему фабрика определяет тип машины.
 *
 * Все кривые — кубические Безье с контрольными точками, выведенными из
 * концов отрезка. Ломаная из прямых читалась бы как чертёж, нарисованный
 * программистом, а документ идёт технологу.
 */

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const M = (p: Point): string => `M ${f(p.x)} ${f(p.y)}`;
const L = (p: Point): string => `L ${f(p.x)} ${f(p.y)}`;
const C = (c1: Point, c2: Point, p: Point): string =>
  `C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p.x)} ${f(p.y)}`;

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Магическая константа приближения дуги окружности кубической кривой. */
const KAPPA = 0.5523;

/**
 * Четверть эллипса от центра горловины (0, b) к высшей точке плеча (a, 0).
 * Горловина и шов втачивания бейки строятся одной формулой с разными полуосями —
 * поэтому они гарантированно параллельны, а не «примерно похожи».
 */
const neckArc = (a: number, b: number): string =>
  `${M({ x: 0, y: b })} ${C({ x: a * KAPPA, y: b }, { x: a, y: b * KAPPA }, { x: a, y: 0 })}`;

/** Точка на том же эллипсе при параметре t от центра (0) к плечу (1). */
const onNeck = (t: number, a: number, b: number): Point => ({
  x: a * Math.sin((t * Math.PI) / 2),
  y: b * Math.cos((t * Math.PI) / 2),
});

export interface FlatPaths {
  /** Силуэт правой половины. Левая — зеркалом, поэтому симметрия точная. */
  outline: string;
  /** Конструктивные швы: пройма, шов втачивания бейки, плечевой шов. */
  seams: string[];
  /** Отделочные строчки. Каждая линия — одна реальная строчка. */
  stitches: string[];
  /** Рубчик бейки горловины — условное обозначение рибаны. */
  ribs: string[];
  /** Линия центра переда или спинки — тонкая, вспомогательная. */
  center: string;
}

export interface PathOptions {
  /** Глубина подгибки низа, см. Определяет, где идёт отстрочка. */
  hemAllowance: number;
  /** Число параллельных строчек низа. Прямо соответствует типу машины. */
  hemStitchRows: number;
  /** Глубина подгибки низа рукава, см. */
  sleeveHemAllowance: number;
  sleeveStitchRows: number;
}

export const DEFAULT_PATH_OPTIONS: PathOptions = {
  hemAllowance: 2,
  hemStitchRows: 2,
  sleeveHemAllowance: 2,
  sleeveStitchRows: 2,
};

export function buildPaths(
  m: FlatMeasurements,
  view: 'front' | 'back',
  options: PathOptions = DEFAULT_PATH_OPTIONS,
): { geometry: FlatGeometry; paths: FlatPaths } {
  const g = buildGeometry(m, view);
  const neckDrop = view === 'front' ? m.frontNeckDrop : m.backNeckDrop;

  // --- Пройма ------------------------------------------------------------------
  // Форма настоящей проймы: от плечевой точки идёт вниз с прогибом внутрь,
  // затем выходит наружу к нижней точке. Прямая линия читалась бы как реглан.
  const armDy = g.underarm.y - g.shoulderPoint.y;
  const armhole = C(
    { x: g.shoulderPoint.x - armDy * 0.1, y: g.shoulderPoint.y + armDy * 0.38 },
    { x: g.underarm.x - armDy * 0.08, y: g.underarm.y - armDy * 0.22 },
    g.underarm,
  );

  // --- Рукав ------------------------------------------------------------------
  // Верхний сгиб слегка выгнут ВВЕРХ: прямая читается трапецией, а прогиб
  // внутрь — вмятиной. Обе контрольные точки идут вдоль сгиба и лишь приподняты.
  const rise = m.sleeveLength * 0.05;
  const capA = lerp(g.shoulderPoint, g.sleeveTopEnd, 0.35);
  const capB = lerp(g.shoulderPoint, g.sleeveTopEnd, 0.78);
  const sleeveTop = C(
    { x: capA.x, y: capA.y - rise },
    { x: capB.x, y: capB.y - rise * 0.45 },
    g.sleeveTopEnd,
  );
  const sleeveEnd = L(g.sleeveBottomEnd);
  // Нижний срез рукава почти прямой, с лёгким провисом к пройме.
  const underMid = lerp(g.sleeveBottomEnd, g.underarm, 0.55);
  const sleeveUnder = C(
    lerp(g.sleeveBottomEnd, g.underarm, 0.25),
    { x: underMid.x, y: underMid.y + m.sleeveOpening * 0.06 },
    g.underarm,
  );

  // --- Боковой шов: от проймы через талию к низу -------------------------------
  const sideToWaist = C(
    {
      x: g.underarm.x - (g.underarm.x - g.waist.x) * 0.5,
      y: g.underarm.y + (g.waist.y - g.underarm.y) * 0.45,
    },
    {
      x: g.waist.x + (g.underarm.x - g.waist.x) * 0.2,
      y: g.waist.y - (g.waist.y - g.underarm.y) * 0.25,
    },
    g.waist,
  );
  const waistToHem = C(
    { x: g.waist.x - (g.waist.x - g.hem.x) * 0.3, y: g.waist.y + (g.hem.y - g.waist.y) * 0.35 },
    { x: g.hem.x, y: g.hem.y - (g.hem.y - g.waist.y) * 0.3 },
    g.hem,
  );

  const outline = [
    // Горловина — четверть эллипса от центра переда к высшей точке плеча.
    neckArc(g.hps.x, neckDrop),
    L(g.shoulderPoint),
    sleeveTop,
    sleeveEnd,
    sleeveUnder,
    sideToWaist,
    waistToHem,
    L(g.hemCenter),
  ].join(' ');

  // --- Конструктивные швы ------------------------------------------------------
  // Шов втачивания бейки — тот же эллипс с полуосями, увеличенными на высоту бейки.
  const bandA = g.hps.x + m.neckRibHeight * 0.55;
  const bandB = neckDrop + m.neckRibHeight;

  const seams = [`${M(g.shoulderPoint)} ${armhole}`, neckArc(bandA, bandB)];

  // --- Отстрочки: столько линий, сколько реальных строчек ----------------------
  const stitches: string[] = [];

  for (let i = 0; i < options.hemStitchRows; i++) {
    const offset = options.hemAllowance - i * 0.35;
    stitches.push(
      `${M({ x: 0, y: g.hem.y - offset })} L ${f(g.hem.x - 0.2)} ${f(g.hem.y - offset)}`,
    );
  }

  const perp = { x: -Math.sin(g.sleeveAngle), y: Math.cos(g.sleeveAngle) };
  const dir = { x: Math.cos(g.sleeveAngle), y: Math.sin(g.sleeveAngle) };
  for (let i = 0; i < options.sleeveStitchRows; i++) {
    const back = options.sleeveHemAllowance - i * 0.35;
    const a = { x: g.sleeveTopEnd.x - dir.x * back, y: g.sleeveTopEnd.y - dir.y * back };
    const b = { x: a.x + perp.x * m.sleeveOpening, y: a.y + perp.y * m.sleeveOpening };
    stitches.push(`${M(a)} ${L(b)}`);
  }

  // --- Рубчик бейки: частые тонкие линии поперёк детали ------------------------
  // Символ рибаны из библиотеки условных обозначений (knowledge-base/02 §4):
  // технолог узнаёт бейку с одного взгляда, без подписи. Обе точки берутся
  // при одном параметре на двух эллипсах, поэтому штрихи ложатся ровно.
  const ribs: string[] = [];
  const RIB_COUNT = 9;
  for (let i = 1; i < RIB_COUNT; i++) {
    const t = i / RIB_COUNT;
    ribs.push(`${M(onNeck(t, g.hps.x, neckDrop))} ${L(onNeck(t, bandA, bandB))}`);
  }

  const center = `${M(g.neckCenter)} L 0 ${f(g.hem.y)}`;

  return { geometry: g, paths: { outline, seams, stitches, ribs, center } };
}
