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
