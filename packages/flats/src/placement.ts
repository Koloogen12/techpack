import type { ArtworkPlacement, StyleSpec } from '@seamster/stylespec';

/**
 * Геометрия макета нанесения на техническом рисунке.
 *
 * Спецификация задаёт макет сантиметрами: отступ от высшей точки плеча,
 * смещение от середины переда, ширина и высота. Рисунок — растр с изделием
 * неизвестного масштаба. Мост между ними — габарит изделия на рисунке против
 * длины изделия из табеля: столько-то пикселей на сантиметр. Масштаб
 * приближённый (капюшон и бейка над плечом добавляют высоты), и лист говорит
 * об этом вслух; сантиметры в таблице остаются истиной для печатника, а
 * рамка на рисунке — иллюстрацией места.
 *
 * Чистая геометрия без DOM: одна и та же функция рисует рамку в кабинете
 * и печатает её в документе.
 */

export type PlacementView = 'front' | 'back' | 'sleeve';

/** Габарит изделия на картинке вида, в пикселях картинки. */
export interface GarmentBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Низ изделия по середине переда, px. Габарит снизу ограничен рукавами,
   * когда они длиннее тела (узкий длинный рукав на джемпере), и длина
   * изделия из табеля ложилась бы на рукав, а не на низ. Нет — низ по габариту.
   */
  hemY?: number;
}

export interface PlacementGeometry {
  view: PlacementView;
  /** Пикселей на сантиметр. */
  pxPerCm: number;
  /** Высшая точка плеча по вертикали, px. */
  hpsY: number;
  /** Середина переда (спинки) по горизонтали, px. */
  cfX: number;
  box: GarmentBox;
  /** Как назначен масштаб — человеку. */
  note_ru: string;
}

export interface PlacementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** На каком виде живёт зона: спинка, рукав, всё остальное — перед. */
export function viewOfZone(zone: string): PlacementView {
  if (zone.startsWith('back')) return 'back';
  if (zone.startsWith('sleeve')) return 'sleeve';
  return 'front';
}

/** Вид рисунка, на котором показывается зона: рукав — на переде. */
export function imageViewOfZone(zone: string): 'front' | 'back' {
  return viewOfZone(zone) === 'back' ? 'back' : 'front';
}

const value = (spec: StyleSpec, code: string): number | null =>
  spec.measurements.points.find((p) => p.code === code)?.base.value ?? null;

/**
 * Масштаб и опорные точки вида по габариту изделия на картинке.
 *
 * Высота габарита — это длина изделия от высшей точки плеча (T01) плюс то,
 * что торчит над плечом: капюшон (около 0,6 его высоты — он нарисован
 * плоско, не в полный рост) или бейка горловины. Без T01 масштаба нет.
 */
export function garmentGeometry(
  spec: StyleSpec,
  box: GarmentBox,
  view: 'front' | 'back',
): PlacementGeometry | null {
  const length = value(spec, 'T01') ?? value(spec, 'J01');
  if (!length || length <= 0) return null;
  const nodes = new Set((spec.construction?.nodes ?? []).map((n) => n.node_id));
  const hood = nodes.has('hood_set_in') || nodes.has('hood_lined_set_in');
  const hoodCm = hood ? 0.6 * (value(spec, 'H01') ?? 34) : 1.5;
  const heightCm = length + hoodCm;
  const bottom = box.hemY && box.hemY > box.y0 ? box.hemY : box.y1;
  const pxPerCm = (bottom - box.y0) / heightCm;
  if (!Number.isFinite(pxPerCm) || pxPerCm <= 0) return null;
  return {
    view,
    pxPerCm,
    hpsY: box.y0 + hoodCm * pxPerCm,
    cfX: (box.x0 + box.x1) / 2,
    box,
    note_ru:
      `Масштаб назначен по длине изделия ${length} см из табеля` +
      (hood ? ' с поправкой на капюшон' : '') +
      '; рамка показывает место, размеры печатнику — в сантиметрах таблицы.',
  };
}

/**
 * Рамка макета на картинке вида, px. Смещение вбок задано по носке
 * (положительное — влево по носке): спереди это правая сторона рисунка,
 * сзади — левая. Рукав рисуется на левом по рисунку рукаве переда.
 */
export function placementRect(
  placement: Pick<
    ArtworkPlacement,
    'zone' | 'offset_from_anchor_cm' | 'size_cm' | 'lateral_offset_cm' | 'kind'
  >,
  g: PlacementGeometry,
): PlacementRect | null {
  if (placement.kind !== 'placement') return null;
  const view = viewOfZone(placement.zone);
  if (view === 'back' && g.view !== 'back') return null;
  if (view !== 'back' && g.view !== 'front') return null;
  const w = placement.size_cm.width.value * g.pxPerCm;
  const h = placement.size_cm.height.value * g.pxPerCm;
  const lateral = placement.lateral_offset_cm?.value ?? 0;
  if (view === 'sleeve') {
    // Рукав — труба; на плоском рисунке макет ставится на левый по
    // рисунку рукав, отступ идёт вниз от плечевого шва.
    const bw = g.box.x1 - g.box.x0;
    const cx = g.box.x0 + bw * 0.11;
    const top = g.hpsY + placement.offset_from_anchor_cm.value * g.pxPerCm;
    return { x: cx - w / 2, y: top, w, h };
  }
  const sign = view === 'back' ? -1 : 1;
  const cx = g.cfX + sign * lateral * g.pxPerCm;
  const top = g.hpsY + placement.offset_from_anchor_cm.value * g.pxPerCm;
  return { x: cx - w / 2, y: top, w, h };
}

/** Обратно: рамка в пикселях → сантиметры спецификации (с округлением до 0,5). */
export function rectToCm(
  rect: PlacementRect,
  g: PlacementGeometry,
  zone: string,
): { offset_cm: number; lateral_cm: number; width_cm: number; height_cm: number } {
  const half = (v: number): number => Math.round(v * 2) / 2;
  const view = viewOfZone(zone);
  const sign = view === 'back' ? -1 : 1;
  const cx = rect.x + rect.w / 2;
  return {
    offset_cm: Math.max(0, half((rect.y - g.hpsY) / g.pxPerCm)),
    lateral_cm: view === 'sleeve' ? 0 : half((sign * (cx - g.cfX)) / g.pxPerCm),
    width_cm: Math.max(1, half(rect.w / g.pxPerCm)),
    height_cm: Math.max(1, half(rect.h / g.pxPerCm)),
  };
}

/**
 * Габарит изделия по яркости пикселей: всё, что темнее порога, — изделие.
 * Работает и в браузере (ImageData), и в Node (массив яркостей).
 */
export function garmentBoxFromLuma(
  luma: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 235,
): GarmentBox | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (luma[row + x]! < threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || y1 - y0 < height * 0.2) return null;
  // Низ по середине: самый нижний тёмный пиксель в полосе ±4% ширины
  // вокруг середины габарита. Рукава висят по краям и сюда не попадают.
  const cx = (x0 + x1) / 2;
  const band = Math.max(2, Math.round((x1 - x0) * 0.04));
  let hemY = -1;
  for (let y = y1; y >= y0 && hemY < 0; y--) {
    const row = y * width;
    for (let x = Math.max(0, Math.round(cx - band)); x <= Math.min(width - 1, cx + band); x++) {
      if (luma[row + x]! < threshold) {
        hemY = y;
        break;
      }
    }
  }
  return hemY > y0 + (y1 - y0) * 0.3 ? { x0, y0, x1, y1, hemY } : { x0, y0, x1, y1 };
}

/** SVG-оверлей с рамками макетов — тот же в кабинете и в документе. */
export function placementOverlaySvg(
  rects: readonly { letter: string; rect: PlacementRect; active?: boolean }[],
  image: { w: number; h: number },
): string {
  const items = rects
    .map(({ letter, rect, active }) => {
      const stroke = active ? '#0E0E0E' : '#C0392B';
      const r = 11;
      return (
        `<rect x="${f(rect.x)}" y="${f(rect.y)}" width="${f(rect.w)}" height="${f(rect.h)}" ` +
        `fill="rgba(192,57,43,0.06)" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="${f(rect.x)}" cy="${f(rect.y)}" r="${r}" fill="${stroke}"/>` +
        `<text x="${f(rect.x)}" y="${f(rect.y + 4)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="#fff">${letter}</text>`
      );
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.w} ${image.h}" width="100%" height="100%" ` +
    `preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;pointer-events:none">${items}</svg>`
  );
}

const f = (n: number): string => String(Math.round(n * 10) / 10);
