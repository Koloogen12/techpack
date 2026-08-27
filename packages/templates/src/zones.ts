import type { NodeZone } from '@seamsterly/kb';
import {
  boxHeight,
  boxWidth,
  pathPoints,
  readPaths,
  unionBox,
  type Box,
  type RawPath,
} from './svg.js';

/**
 * Зоны изделия на библиотечном силуэте.
 *
 * У покупного шаблона нет контрольных точек: сказать «вот здесь ровно
 * тридцать четвёртый сантиметр» он не может, и выноска на точку была бы
 * враньём. Зато сказать «вот здесь пройма» он может — и это ровно тот
 * язык, которым устроен наш справочник узлов: у каждого узла есть поле
 * зоны. Поэтому выноска указывает на ЗОНУ, и лист об этом говорит прямо.
 *
 * Ориентиры выводятся из самого рисунка, а не из долей рамки. Иначе у худи
 * «горловина» попадала бы на капюшон: у капюшонного силуэта верхняя
 * четверть листа — это капюшон, а у футболки — уже плечи.
 */

/**
 * Что на силуэте нарисовано на самом деле.
 *
 * Берётся из разметки шаблона, а не из геометрии: над плечами бывает и
 * воротник, и просто поле, а карман от тени не отличить. Зона, детали
 * которой на силуэте нет, точки привязки не получает вовсе — выноска в
 * пустоту хуже отсутствующей.
 */
export interface SilhouetteDetails {
  hood: boolean;
  closure: boolean;
  pocket: boolean;
  sleeves: boolean;
  /** Пояс-рибана: без него зона пояса не подписывается. */
  ribbedWaist: boolean;
}

export interface ZoneAnchor {
  zone: NodeZone;
  /** Точка внутри зоны, в координатах viewBox шаблона. */
  x: number;
  y: number;
}

export interface ViewLandmarks {
  box: Box;
  /** Ось изделия: середина торса, а не середина листа. */
  axis: number;
  /** Строка, где силуэт впервые становится широким: линия плеча. */
  shoulderY: number;
  /** Уровень проймы — там, где рукав отделяется от торса. */
  armpitY: number;
  /** Самая широкая строка вместе с рукавами: их размах. */
  sleeveY: number;
  sleeveMinX: number;
  /**
   * ТОРС на уровне проймы: ширина и края.
   *
   * Меряется по контуру торса, а раскинутые рукава игнорируются. Иначе
   * манера рисования пролезает в метрику через заднюю дверь: у одного
   * художника рукав отведён горизонтально, у другого опущен вниз, и общий
   * размах у одинаковых изделий отличается вдвое.
   */
  torsoWidth: number;
  torsoLeftX: number;
  torsoRightX: number;
  /**
   * Низ ТОРСА, а не низ листа.
   *
   * У оверсайза рукав свисает ниже изделия, и меряя длину до края габарита,
   * мы мерили бы длину рукава.
   */
  bodyBottomY: number;
  /** Есть ли над плечами заметная деталь: капюшон или воротник. */
  aboveShoulders: boolean;
  /**
   * Удалось ли выделить торс отдельно от рукавов.
   *
   * Ложь означает, что тела изделия набралось слишком мало строк, чтобы
   * медиана что-то значила: силуэт обрезан, вырожден или нарисован не так,
   * как мы умеем читать. По такому замеру не отказывают и на него не
   * ссылаются.
   */
  torsoMeasured: boolean;
}

/** На сколько полос делим вид по высоте при поиске ориентиров. */
const BANDS = 64;

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Внешний контур силуэта: его отрезки и его габарит.
 *
 * Ровно самый крупный путь и его дубли, а не «всё крупное». Карман, молния
 * и отстрочка тоже пересекают горизонталь, и приняв их за край торса, мы
 * намеряли бы ширину кармана. Дубли берём потому, что контур нередко
 * нарисован дважды — заливкой и обводкой.
 */
function outlineOf(paths: readonly RawPath[]): { segments: Segment[]; box: Box } | null {
  const area = (b: Box): number => (b.maxX - b.minX) * (b.maxY - b.minY);
  let biggest: RawPath | null = null;
  for (const p of paths) if (!biggest || area(p.box) > area(biggest.box)) biggest = p;
  if (!biggest) return null;
  const top = area(biggest.box);
  if (top <= 0) return null;

  const segments: Segment[] = [];
  for (const p of paths) {
    if (area(p.box) < top * 0.95) continue;
    const pts = pathPoints(p.d);
    if (pts.length < 2) continue;
    const closed = /[zZ]/.test(p.d);
    const count = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < count; k++) {
      const a = pts[k]!;
      const b = pts[(k + 1) % pts.length]!;
      if (a.y !== b.y) segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  return { segments, box: biggest.box };
}

/**
 * Где горизонталь пересекает контур, слева направо.
 *
 * Совпадающие пересечения схлопываются в одно: контур нередко нарисован
 * дважды — заливкой и обводкой, — и без этого каждая пара «краёв торса»
 * оказывалась бы двумя копиями одного и того же края.
 */
function crossings(segments: readonly Segment[], y: number, epsilon: number): number[] {
  const xs: number[] = [];
  for (const s of segments) {
    const lo = Math.min(s.y1, s.y2);
    const hi = Math.max(s.y1, s.y2);
    if (y < lo || y >= hi) continue;
    xs.push(s.x1 + ((y - s.y1) / (s.y2 - s.y1)) * (s.x2 - s.x1));
  }
  xs.sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of xs) {
    if (out.length === 0 || x - out[out.length - 1]! > epsilon) out.push(x);
  }
  return out;
}

/**
 * Ширина ТОРСА на заданной высоте.
 *
 * Торс — пара пересечений, между которыми лежит ось изделия. Ниже проймы
 * горизонталь пересекает контур шесть раз: левый рукав, торс, правый рукав.
 * Крайние пары — рукава, и брать общий размах значило бы мерить не изделие,
 * а то, под каким углом художник его развёл.
 */
function torsoAt(
  segments: readonly Segment[],
  y: number,
  axis: number,
  epsilon: number,
): { min: number; max: number } | null {
  const xs = crossings(segments, y, epsilon);
  if (xs.length < 2) return null;
  let left = -Infinity;
  let right = Infinity;
  for (const x of xs) {
    if (x <= axis && x > left) left = x;
    if (x >= axis && x < right) right = x;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null;
  return { min: left, max: right };
}

export function landmarksOf(svg: string): ViewLandmarks | null {
  const paths = readPaths(svg);
  const box = unionBox(paths.map((p) => p.box));
  if (!box) return null;

  const outline = outlineOf(paths);
  if (!outline || outline.segments.length < 4) return null;
  const { segments } = outline;

  const height = boxHeight(box);
  const rowY = (i: number): number => box.minY + ((i + 0.5) / BANDS) * height;
  // Допуск совпадения — доля ширины листа: меньше него две линии на чертеже
  // и так неразличимы.
  const eps = boxWidth(box) * 0.004;
  // Ось — середина внешнего контура. Он симметричен; медиана пересечений
  // была бы чувствительна к тому, где деталей нарисовано больше.
  const axis = (outline.box.minX + outline.box.maxX) / 2;

  const span = (i: number): number => {
    const xs = crossings(segments, rowY(i), eps);
    return xs.length >= 2 ? xs[xs.length - 1]! - xs[0]! : 0;
  };
  const torso = (i: number): number => {
    const t = torsoAt(segments, rowY(i), axis, eps);
    return t ? t.max - t.min : 0;
  };

  let sleeveRow = 0;
  for (let i = 1; i < BANDS; i++) if (span(i) > span(sleeveRow)) sleeveRow = i;
  const maxSpan = span(sleeveRow);

  // Линия плеча — первая сверху полоса, где силуэт становится широким.
  // У капюшонного изделия над ней остаётся капюшон, у футболки — ничего.
  let shoulderRow = 0;
  while (shoulderRow < BANDS - 1 && span(shoulderRow) < maxSpan * 0.5) shoulderRow++;

  // Ширина торса — МЕДИАНА пары вокруг оси по телу изделия.
  //
  // Пара вокруг оси и есть торс: выше проймы она равна всему размаху (рукав
  // с торсом одно пятно), ниже — либо тоже всему размаху (короткий рукав
  // кончился), либо просвету между свисающими рукавами. Отличает тело от
  // плеч не число пересечений, а высота: отступаем от линии плеча вниз на
  // пятую часть остатка и меряем всё, что ниже. Медиана — потому что
  // отделение по строкам прерывистое, контур касается сам себя, и
  // одиночный замер прыгает.
  const bodyStart = Math.min(BANDS - 1, shoulderRow + Math.round((BANDS - shoulderRow) * 0.2));
  const body: { row: number; w: number }[] = [];
  for (let i = bodyStart; i < BANDS; i++) {
    const w = torso(i);
    if (w > 0) body.push({ row: i, w });
  }

  const torsoMeasured = body.length >= 5;
  if (body.length === 0) return null;
  const sorted = body.map((x) => x.w).sort((a, b) => a - b);
  const torsoWidth = sorted[Math.floor(sorted.length / 2)]!;
  if (!(torsoWidth > 0)) return null;

  // Пройма — первая строка ниже плеча, где торс уже набрал свою ширину.
  let armpitRow = bodyStart;
  for (let i = shoulderRow + 1; i < BANDS; i++) {
    const w = torso(i);
    if (w > 0 && w <= torsoWidth * 1.3) {
      armpitRow = i;
      break;
    }
  }

  // Низ торса — последняя строка, где он ещё узнаётся по ширине. Ниже неё
  // пара вокруг оси — это просвет между рукавами, а не изделие.
  let bottomRow = armpitRow;
  for (const { row, w } of body) {
    if (w >= torsoWidth * 0.6 && w <= torsoWidth * 1.6) bottomRow = row;
  }

  const atArmpit = torsoAt(segments, rowY(armpitRow), axis, eps);

  return {
    box,
    axis,
    shoulderY: rowY(shoulderRow),
    armpitY: rowY(armpitRow),
    sleeveY: rowY(sleeveRow),
    sleeveMinX: crossings(segments, rowY(sleeveRow), eps)[0] ?? box.minX,
    torsoWidth,
    torsoLeftX: atArmpit?.min ?? axis - torsoWidth / 2,
    torsoRightX: atArmpit?.max ?? axis + torsoWidth / 2,
    bodyBottomY: rowY(bottomRow),
    aboveShoulders: shoulderRow > BANDS * 0.06,
    torsoMeasured,
  };
}

/**
 * Точки привязки выносок.
 *
 * Каждая — представитель зоны, а не размерная точка. Зоны, которых на
 * силуэте не видно (маркировка), не возвращаются вовсе: выноска в пустоту
 * хуже отсутствующей.
 */
export function zonesOf(svg: string, details: SilhouetteDetails): Map<NodeZone, ZoneAnchor> {
  const L = landmarksOf(svg);
  const out = new Map<NodeZone, ZoneAnchor>();
  if (!L) return out;

  const top = L.box.minY;
  const height = boxHeight(L.box);
  const cx = L.axis;
  const w = Math.max(1, L.torsoWidth);
  const bodyLength = Math.max(1, L.bodyBottomY - L.shoulderY);
  const add = (zone: NodeZone, x: number, y: number): void => {
    out.set(zone, { zone, x, y });
  };

  // Зоны, которые есть у любого изделия: горловина, плечи, бока, низ.
  // Их край виден на силуэте всегда, чем бы он ни был.
  add('neckline', cx, L.shoulderY + height * 0.02);
  add('shoulders', cx - w * 0.3, L.shoulderY + height * 0.01);
  add('sides', L.torsoLeftX, L.armpitY + bodyLength * 0.45);
  add('hem', cx, L.bodyBottomY);

  // Зоны отдельных деталей — только если деталь на силуэте нарисована.
  // Иначе выноска указывала бы на пустое место, а лист обещал бы карман,
  // которого на рисунке нет.
  if (details.hood && L.aboveShoulders) add('hood', cx, top + (L.shoulderY - top) * 0.5);
  // Рукав показываем у самого края размаха: там его ни с чем не спутать.
  if (details.sleeves) add('sleeves', L.sleeveMinX + w * 0.12, L.sleeveY);
  if (details.closure) add('closure', cx, L.shoulderY + bodyLength * 0.35);
  if (details.pocket) add('pockets', cx, L.shoulderY + bodyLength * 0.62);
  if (details.ribbedWaist) add('waistband', cx + w * 0.28, L.bodyBottomY);
  return out;
}
