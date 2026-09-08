/**
 * Разрезка листа эскиза на виды.
 *
 * Модель отдаёт три вида одним листом — порознь она рисует три разные вещи.
 * Но человеку нужен и отдельный перед: на обложке, в листе на просчёт,
 * в кабинете по чипу «Перед». Раньше эти места брали библиотечный силуэт —
 * похожую вещь, а не эту, — и рядом с эскизом он читался как другое худи.
 *
 * Границы видов не спрашиваются у модели (она их не знает) и не режутся по
 * третям (виды разной ширины: профиль уже переда втрое). Они читаются с самого
 * листа: чертёж — чёрные линии на белом, и колонка без линий — это промежуток
 * между видами. Чистая функция над яркостью пикселей, без браузера: браузер
 * только достаёт пиксели и режет картинку по найденным границам.
 */

export type SheetView = 'front' | 'side' | 'back';

/** Границы вида в долях ширины и высоты листа, с полем. */
export interface SheetBox {
  view: SheetView;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SheetPixels {
  width: number;
  height: number;
  /** Яркость 0–255, построчно, width × height значений. */
  luma: Uint8Array | readonly number[];
}

/** Яркость ниже — линия чертежа, а не бумага. */
const INK = 160;
/** Доля тёмных пикселей в колонке, чтобы считать её занятой рисунком. */
const MIN_INK_SHARE = 0.004;
/** Просвет уже этого — разрыв линии внутри вида, а не промежуток между видами. */
const GAP_SHARE = 0.015;
/** Полоса уже этого — шум (пылинка, артефакт сжатия), не вид. */
const MIN_RUN_SHARE = 0.06;
/** Поле вокруг вида, чтобы срез не касался линий. */
const PAD = 0.02;

/**
 * Границы видов на листе. Три полосы — перед, профиль, спинка (в порядке,
 * которого просит промпт); две — перед и спинка; иначе лист не разрезается
 * и остаётся целым: угадывать хуже, чем не резать.
 */
export function sheetBoxes(pixels: SheetPixels): SheetBox[] | null {
  const { width, height, luma } = pixels;
  if (width < 3 || height < 3 || luma.length < width * height) return null;

  const dark = (x: number, y: number): boolean => (luma[y * width + x] ?? 255) < INK;

  const cols = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (dark(x, y)) cols[x] = (cols[x] ?? 0) + 1;
  }
  const minInk = Math.max(2, Math.round(height * MIN_INK_SHARE));
  const gap = Math.max(1, Math.round(width * GAP_SHARE));

  const inkCols: number[] = [];
  for (let x = 0; x < width; x++) if ((cols[x] ?? 0) >= minInk) inkCols.push(x);
  if (inkCols.length === 0) return null;

  const runs: { x0: number; x1: number }[] = [{ x0: inkCols[0]!, x1: inkCols[0]! }];
  for (const x of inkCols.slice(1)) {
    const cur = runs[runs.length - 1]!;
    if (x - cur.x1 > gap) runs.push({ x0: x, x1: x });
    else cur.x1 = x;
  }

  const wide = runs.filter((r) => r.x1 - r.x0 + 1 >= width * MIN_RUN_SHARE);
  const views: SheetView[] | null =
    wide.length === 3 ? ['front', 'side', 'back'] : wide.length === 2 ? ['front', 'back'] : null;
  if (!views) return null;

  return wide.map((r, i) => {
    let y0 = height;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (dark(x, y)) {
          if (y < y0) y0 = y;
          y1 = y;
          break;
        }
      }
    }
    if (y1 < 0) {
      y0 = 0;
      y1 = height - 1;
    }
    return {
      view: views[i]!,
      x0: clamp(r.x0 / width - PAD),
      x1: clamp((r.x1 + 1) / width + PAD),
      y0: clamp(y0 / height - PAD),
      y1: clamp((y1 + 1) / height + PAD),
    };
  });
}

const clamp = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));

/** Маска изделия на вырезке вида: 1 — вещь (включая линии), 0 — бумага снаружи. */
export interface GarmentMask {
  mask: Uint8Array;
  /** Габарит маски в пикселях; null — вещи на листе не нашлось. */
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Доля пикселей под маской — сторож от пустых и залитых листов. */
  coverage: number;
}

/** Яркость выше — чистая бумага, по ней растекается «снаружи». */
const PAPER = 235;

/**
 * Где на вырезке вещь, а где бумага вокруг неё.
 *
 * Нужна, чтобы положить на эскиз цвет колорвея или раппорт: заливка идёт
 * под линии только внутри вещи. Снаружи — всё, куда растекается бумага от
 * краёв листа; вещь — остальное, включая замкнутые «окна» вроде внутренней
 * стороны капюшона: они той же ткани. Бумага считается проходимой лишь там,
 * где чиста вся окрестность 3×3 — так разрывы контура до двух пикселей
 * не пускают заливку внутрь. Ореол в один пиксель у линий снимается обратно.
 */
export function garmentMask(pixels: SheetPixels): GarmentMask {
  const { width, height, luma } = pixels;
  const n = width * height;
  const empty: GarmentMask = { mask: new Uint8Array(n), bbox: null, coverage: 0 };
  if (width < 3 || height < 3 || luma.length < n) return empty;

  const paper = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= width || y >= height || (luma[y * width + x] ?? 255) >= PAPER;
  const passable = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!paper(x + dx, y + dy)) {
            ok = false;
            break;
          }
      if (ok) passable[y * width + x] = 1;
    }
  }

  const outside = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (i: number): void => {
    if (outside[i] || !passable[i]) return;
    outside[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  // Ореол: бумага, соседняя с «снаружи», — тоже снаружи, иначе у контура
  // остаётся окрашенная кайма в пиксель.
  const halo: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (outside[i] || !paper(x, y)) continue;
      if (
        (x > 0 && outside[i - 1]) ||
        (x < width - 1 && outside[i + 1]) ||
        (y > 0 && outside[i - width]) ||
        (y < height - 1 && outside[i + width])
      )
        halo.push(i);
    }
  }
  for (const i of halo) outside[i] = 1;

  const mask = new Uint8Array(n);
  let count = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < n; i++) {
    if (outside[i]) continue;
    mask[i] = 1;
    count++;
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { mask, bbox: count ? { x0, y0, x1, y1 } : null, coverage: count / n };
}
