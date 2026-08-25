import { chromium, type Browser } from 'playwright';
import { FLAT_GRAPHIC_FIDELITY, type ColorReport } from './colors.js';

/**
 * Цветоделение в слои: маски под сетки и вектор по цветам.
 *
 * Печатник шелкографии жжёт по сетке на цвет. Ему нужны не «слои в файле»,
 * а разделённые формы — по одной на краску. Их мы отдаём двумя видами
 * сразу, и оба честные:
 *
 * 1. МАСКА на цвет — чёрно-белый растр в разрешении тайла. Точен
 *    по построению: это ровно те пиксели, что отнесены к этой краске.
 *    Ровно с такого файла и выводят плёнку.
 *
 * 2. ВЕКТОР по цветам — контуры тех же масок, слой на краску. Пригоден
 *    только для ПЛОСКОЙ графики, и это проверяется, а не предполагается.
 *
 * Про вектор из фотографии. Трассировать фотореалистичный тайл технически
 * можно, и соседи это делают, добавляя крутилки «сгладить» и «убрать шум».
 * Результат выглядит как вектор и им не является: у фотографии нет границ
 * между красками, есть непрерывный переход, и любой контур на нём —
 * выдумка алгоритма. Мы такой файл не отдаём и говорим почему.
 */

export interface Separation {
  /** Цвет краски. */
  hex: string;
  /** Доля площади — от неё зависит расход краски. */
  share: number;
  /** Чёрно-белая маска этой краски, PNG data-URI. */
  maskDataUri: string;
}

export interface VectorLayer {
  hex: string;
  /** Путь SVG в координатах пикселей тайла. */
  path: string;
}

export interface SeparationResult {
  separations: Separation[];
  /** Слои вектора. Пусто — вектор невозможен без вранья. */
  vector: VectorLayer[];
  /** SVG целиком, слой на краску. null по той же причине. */
  svg: string | null;
  /** Почему вектор есть или почему его нет. Показывается человеку. */
  vector_verdict_ru: string;
  /**
   * Размер пиксельной ступеньки контура при заданном шаге раппорта, мм.
   *
   * Контур идёт по границе пикселей, и это не приближение, а точная граница
   * растра. Но ступенька имеет физический размер, и печатник вправе знать
   * какой: на 24 см и тайле 2048 px она около десятой доли миллиметра,
   * на 60 см — уже треть.
   */
  step_mm: number | null;
}

/**
 * Наименьшая деталь, которую держит сетка шелкографии, мм.
 *
 * Это ФИЗИКА процесса, а не настройка вкуса: эмульсия на сетке не держит
 * точку мельче примерно трёх десятых миллиметра, она либо не пропечатается,
 * либо забьётся. Поэтому детали мельче убираются ДО вывода плёнки —
 * и мы говорим, что убрали и почему.
 *
 * Это не то же самое, что «шумодав» у соседей. Там крутилкой сглаживают
 * фотографию, чтобы она стала похожа на вектор; здесь убирается то, что
 * заведомо не напечатается, с названным размером в миллиметрах.
 */
export const MIN_FEATURE_MM = 0.3;

export async function separateColors(
  dataUri: string,
  report: ColorReport,
  options: {
    repeatCm?: number | undefined;
    browser?: Browser;
    /** Наименьшая деталь, мм. Меньше сетка не держит. */
    minFeatureMm?: number | undefined;
  } = {},
): Promise<SeparationResult> {
  const own = options.browser === undefined;
  const b = options.browser ?? (await chromium.launch());

  try {
    const palette = report.colors.map((c) => c.rgb);
    const page = await b.newPage();

    // Минимальная деталь в пикселях тайла. Без заданного шага раппорта
    // физического размера нет, и чистить нечего — тогда фильтр не работает.
    const minFeatureMm = options.minFeatureMm ?? MIN_FEATURE_MM;
    const pxPerMm =
      options.repeatCm !== undefined && options.repeatCm > 0
        ? report.width / (options.repeatCm * 10)
        : 0;
    const cleanRadius = pxPerMm > 0 ? Math.max(0, Math.round((minFeatureMm * pxPerMm) / 2)) : 0;

    let raw: { masks: string[]; paths: string[] };
    try {
      // Плоские циклы без именованных функций — код идёт в браузер.
      raw = await page.evaluate(
        async ([uri, colors, wantVector, radius]: [string, number[][], boolean, number]) => {
          const img = new Image();
          img.src = uri;
          await img.decode();
          const w = img.naturalWidth;
          const h = img.naturalHeight;

          const src = document.createElement('canvas');
          src.width = w;
          src.height = h;
          const sctx = src.getContext('2d', { willReadFrequently: true })!;
          sctx.drawImage(img, 0, 0);
          const data = sctx.getImageData(0, 0, w, h).data;

          // Каждому пикселю — ближайшая краска. Это и есть постеризация.
          const owner = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) {
            const o = i * 4;
            let best = 0;
            let bestD = Infinity;
            for (let c = 0; c < colors.length; c++) {
              const p = colors[c]!;
              const d =
                (data[o]! - p[0]!) ** 2 + (data[o + 1]! - p[1]!) ** 2 + (data[o + 2]! - p[2]!) ** 2;
              if (d < bestD) {
                bestD = d;
                best = c;
              }
            }
            owner[i] = best;
          }

          // Фильтр большинства: пиксель принимает цвет, преобладающий
          // в окрестности. Убирает кайму сглаживания и одиночные точки,
          // сохраняя границы — в отличие от размытия, которое границы
          // как раз и съедает.
          if (radius > 0) {
            const src2 = new Uint8Array(owner);
            const votes = new Int32Array(colors.length);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                votes.fill(0);
                const y0 = Math.max(0, y - radius);
                const y1 = Math.min(h - 1, y + radius);
                const x0 = Math.max(0, x - radius);
                const x1 = Math.min(w - 1, x + radius);
                for (let yy = y0; yy <= y1; yy++) {
                  for (let xx = x0; xx <= x1; xx++) votes[src2[yy * w + xx]!]!++;
                }
                let win = 0;
                let winV = -1;
                for (let c = 0; c < colors.length; c++) {
                  if (votes[c]! > winV) {
                    winV = votes[c]!;
                    win = c;
                  }
                }
                owner[y * w + x] = win;
              }
            }
          }

          const masks: string[] = [];
          const paths: string[] = [];

          for (let c = 0; c < colors.length; c++) {
            const mask = document.createElement('canvas');
            mask.width = w;
            mask.height = h;
            const mctx = mask.getContext('2d')!;
            const out = mctx.createImageData(w, h);
            for (let i = 0; i < w * h; i++) {
              const v = owner[i] === c ? 0 : 255;
              out.data[i * 4] = v;
              out.data[i * 4 + 1] = v;
              out.data[i * 4 + 2] = v;
              out.data[i * 4 + 3] = 255;
            }
            mctx.putImageData(out, 0, 0);
            masks.push(mask.toDataURL('image/png'));

            if (!wantVector) continue;

            // Контур строится прямоугольниками по горизонтальным пробегам:
            // граница пикселя — ТОЧНАЯ граница постеризованного растра,
            // а не сглаженное приближение к ней. Соседние строки с теми же
            // границами объединяются, поэтому плоская заливка даёт один
            // прямоугольник, а не тысячу.
            const parts: string[] = [];
            let y = 0;
            while (y < h) {
              let x = 0;
              while (x < w) {
                if (owner[y * w + x] !== c) {
                  x++;
                  continue;
                }
                let x2 = x;
                while (x2 + 1 < w && owner[y * w + x2 + 1] === c) x2++;

                let y2 = y;
                for (;;) {
                  if (y2 + 1 >= h) break;
                  let same = true;
                  if (x > 0 && owner[(y2 + 1) * w + x - 1] === c) same = false;
                  if (same && x2 + 1 < w && owner[(y2 + 1) * w + x2 + 1] === c) same = false;
                  if (same) {
                    for (let k = x; k <= x2; k++) {
                      if (owner[(y2 + 1) * w + k] !== c) {
                        same = false;
                        break;
                      }
                    }
                  }
                  if (!same) break;
                  y2++;
                }

                for (let yy = y; yy <= y2; yy++) {
                  for (let k = x; k <= x2; k++) owner[yy * w + k] = 255;
                }
                parts.push(`M${x} ${y}h${x2 - x + 1}v${y2 - y + 1}h${-(x2 - x + 1)}Z`);
                x = x2 + 1;
              }
              y++;
            }
            paths.push(parts.join(''));

            // owner испорчен разметкой — восстанавливаем для следующей краски.
            for (let i = 0; i < w * h; i++) {
              if (owner[i] === 255) owner[i] = c;
            }
          }

          return { masks, paths };
        },
        [dataUri, palette.map((p) => [...p]), report.flat_graphic, cleanRadius] as [
          string,
          number[][],
          boolean,
          number,
        ],
      );
    } finally {
      await page.close();
    }

    const separations: Separation[] = report.colors.map((c, i) => ({
      hex: c.hex,
      share: c.share,
      maskDataUri: raw.masks[i] ?? '',
    }));

    const stepMm =
      options.repeatCm !== undefined && report.width > 0
        ? Math.round(((options.repeatCm * 10) / report.width) * 1000) / 1000
        : null;

    if (!report.flat_graphic) {
      return {
        separations,
        vector: [],
        svg: null,
        step_mm: stepMm,
        vector_verdict_ru:
          `Вектор не построен, и это не сбой. Рисунок фотографичен: доля пикселей, ` +
          `попадающих в свою краску, ${Math.round(report.fidelity * 100)}% при пороге ` +
          `${Math.round(FLAT_GRAPHIC_FIDELITY * 100)}%. У фотографии нет границ между красками — ` +
          `есть непрерывный переход, и любой контур на нём выдуман алгоритмом. ` +
          `Растр остаётся мастер-файлом; для плашечной печати нужен рисунок ` +
          `с ограниченной палитрой. Маски по краскам приложены — по ним видно, ` +
          `во что превратится рисунок, если его всё же разложить на ${separations.length} красок.`,
      };
    }

    const vector: VectorLayer[] = report.colors.map((c, i) => ({
      hex: c.hex,
      path: raw.paths[i] ?? '',
    }));

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${report.width} ${report.height}" ` +
      `width="${report.width}" height="${report.height}">` +
      vector
        .map(
          (l, i) =>
            `<g id="color-${i + 1}" data-hex="${l.hex}" fill="${l.hex}">` +
            `<path d="${l.path}"/></g>`,
        )
        .join('') +
      `</svg>`;

    const sizeMb = Math.round((svg.length / 1024 / 1024) * 100) / 100;

    return {
      separations,
      vector,
      svg,
      step_mm: stepMm,
      vector_verdict_ru:
        `Вектор построен: ${vector.length} ${vector.length === 1 ? 'слой' : 'слоёв'}, ` +
        `по одному на краску — столько же сеток. Контуры идут по границе пикселей ` +
        `постеризованного растра, то есть это точная граница, а не сглаженное ` +
        `приближение к ней.` +
        (stepMm !== null
          ? ` При шаге раппорта ${options.repeatCm} см ступенька контура — ${stepMm} мм.`
          : '') +
        (cleanRadius > 0
          ? ` Детали мельче ${minFeatureMm} мм убраны: сетка шелкографии их не держит — ` +
            `точка такого размера либо не пропечатается, либо забьётся. Это физика ` +
            `процесса, а не сглаживание рисунка.`
          : '') +
        // Размер называем сами: несколько мегабайт для цветоделения раппорта
        // это норма (контур идёт по каждому изгибу мотива), но человек,
        // который этого не ждёт, решит, что файл битый.
        ` Файл ${sizeMb} МБ — обычный размер для цветоделения раппорта такого ` +
        `разрешения: контур обходит каждый изгиб мотива.`,
    };
  } finally {
    if (own) await b.close();
  }
}
