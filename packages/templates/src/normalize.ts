import { boxHeight, boxWidth, readPaths, unionBox, type Box, type RawPath } from './svg.js';

/**
 * Приведение покупного силуэта к виду, пригодному для техпака.
 *
 * Датасет нарисован как мокап: перед и спинка на одном листе, детали залиты
 * серым, подкладка капюшона — чёрным. Для документа нужно ровно обратное:
 * два отдельных вида, контур без заливки, единая толщина линии. Три шага
 * ниже — это и есть разница между картинкой для маркетплейса и чертежом,
 * по которому кроят.
 */

export interface NormalizedView {
  /** Готовый SVG одного вида. */
  svg: string;
  /** Габарит содержимого в координатах исходного листа. */
  box: Box;
  paths: number;
}

export interface NormalizeResult {
  front: NormalizedView;
  back: NormalizedView | null;
  notes: string[];
}

export interface NormalizeOptions {
  /**
   * Поле вокруг силуэта, доля от большей стороны.
   *
   * Не ноль: обводка рисуется по центру линии, и при нулевом поле половина
   * её толщины срезается краем вида.
   */
  margin?: number;
  /** Толщина линии в единицах итогового viewBox. */
  strokeWidth?: number;
}

const DEFAULTS = { margin: 0.02, strokeWidth: 2 } as const;

/**
 * Разделение листа на перед и спинку.
 *
 * По кластерам путей, а не по середине листа: середина — свойство холста,
 * а не изделия, и достаточно художнику сдвинуть композицию, чтобы деление
 * пополам разрезало силуэт. Ищем самый широкий вертикальный просвет между
 * габаритами путей: там, где между двумя видами пусто, и проходит граница.
 */
export function splitViews(paths: readonly RawPath[]): { front: RawPath[]; back: RawPath[] } {
  const total = unionBox(paths.map((p) => p.box));
  if (!total || paths.length < 6) return { front: [...paths], back: [] };

  // Просвет ищется по ГИСТОГРАММЕ ПОКРЫТИЯ, а не по одному разрыву между
  // соседями: на листе попадаются подложки и тени во всю ширину, и любая
  // из них склеивает виды, хотя между самими изделиями пусто. Гистограмма
  // такой путь не прячет — она показывает, что покрытие в середине не
  // падает до нуля, и тогда мы честно отказываемся делить.
  const BINS = 400;
  const width = boxWidth(total);
  if (width <= 0) return { front: [...paths], back: [] };
  const cover = new Array<number>(BINS).fill(0);
  for (const p of paths) {
    const from = Math.max(0, Math.floor(((p.box.minX - total.minX) / width) * BINS));
    const to = Math.min(BINS - 1, Math.ceil(((p.box.maxX - total.minX) / width) * BINS));
    for (let i = from; i <= to; i++) cover[i]! += 1;
  }

  // Ищем самую широкую пустую полосу в средней трети: у листа с двумя видами
  // граница проходит там, а пустота у самого края — это просто поле.
  const lo = Math.floor(BINS * 0.3);
  const hi = Math.ceil(BINS * 0.7);
  let bestLen = 0;
  let bestMid = 0;
  let run = 0;
  for (let i = lo; i <= hi; i++) {
    if (cover[i] === 0) {
      run++;
      if (run > bestLen) {
        bestLen = run;
        bestMid = i - run / 2;
      }
    } else {
      run = 0;
    }
  }

  // Полоса шириной меньше процента листа — не граница между видами,
  // а зазор между деталями одного изделия.
  if (bestLen < BINS * 0.01) return { front: [...paths], back: [] };

  const boundary = total.minX + (bestMid / BINS) * width;
  const front = paths.filter((p) => (p.box.minX + p.box.maxX) / 2 < boundary);
  const back = paths.filter((p) => (p.box.minX + p.box.maxX) / 2 >= boundary);
  // Вид из пары путей — не вид: скорее подпись или мелкая деталь,
  // отбившаяся от своей половины.
  if (front.length < 3 || back.length < 3) return { front: [...paths], back: [] };
  return { front, back };
}

/**
 * Заливки убираются, обводка остаётся.
 *
 * Серая заливка мокапа в техпаке означала бы цвет изделия, которого мы не
 * знаем; чёрная подкладка капюшона — и вовсе деталь картинки, а не кроя.
 * Технический рисунок — это контур: цвет на нём появляется только слоем
 * колорвея, и решает его наша заливка по BOM, а не художник датасета.
 */
export function lineArt(style: string, strokeWidth: number): string {
  const parts = new Map<string, string>();
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    parts.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }

  const hadStroke = parts.has('stroke') && parts.get('stroke') !== 'none';
  const fill = parts.get('fill');
  // Путь без обводки, но с заливкой — это плашка: молния, рибана, тень.
  // Она несёт форму, поэтому превращается в контур той же линией.
  const keep = hadStroke || (fill !== undefined && fill !== 'none');
  if (!keep) return '';

  return (
    `fill:none;stroke:#0E0E0E;stroke-width:${strokeWidth};` +
    `stroke-linejoin:${parts.get('stroke-linejoin') ?? 'round'};` +
    `stroke-linecap:${parts.get('stroke-linecap') ?? 'round'};` +
    'stroke-miterlimit:10'
  );
}

function viewOf(paths: readonly RawPath[], options: Required<NormalizeOptions>): NormalizedView | null {
  const box = unionBox(paths.map((p) => p.box));
  if (!box) return null;

  const pad = Math.max(boxWidth(box), boxHeight(box)) * options.margin;
  const minX = box.minX - pad;
  const minY = box.minY - pad;
  const width = boxWidth(box) + pad * 2;
  const height = boxHeight(box) + pad * 2;

  const body = paths
    .map((p) => {
      const style = lineArt(p.style, options.strokeWidth);
      return style ? `<path style="${style}" d="${p.d}"/>` : '';
    })
    .filter(Boolean)
    .join('');

  return {
    // viewBox переносится на содержимое, а сами координаты путей не трогаются:
    // пересчитывать тысячи чисел значило бы копить ошибку округления там,
    // где та же задача решается системой координат.
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX)} ${round(minY)} ` +
      `${round(width)} ${round(height)}" role="img">${body}</svg>`,
    box,
    paths: paths.length,
  };
}

const round = (n: number): string => (Math.round(n * 100) / 100).toString();

export function normalizeTemplate(svg: string, options: NormalizeOptions = {}): NormalizeResult {
  const opts = { ...DEFAULTS, ...options };
  const notes: string[] = [];
  const paths = readPaths(svg);
  if (paths.length === 0) throw new Error('в файле нет путей');

  const { front, back } = splitViews(paths);
  if (back.length === 0) {
    notes.push('вид один: разделить перед и спинку по просвету не удалось');
  }

  const frontView = viewOf(front, opts);
  if (!frontView) throw new Error('передний вид пуст после нормализации');
  const backView = back.length ? viewOf(back, opts) : null;

  return { front: frontView, back: backView, notes };
}
