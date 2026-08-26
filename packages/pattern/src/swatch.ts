import { chromium, type Browser } from 'playwright';
import { deltaE, rgbToLab, toHex } from './colors.js';

/**
 * Чтение цвета с образца полотна.
 *
 * Бренд присылает снимок выкраса или лоскут ткани — и это САМЫЙ ТОЧНЫЙ вход
 * по цвету, который у нас бывает. Написанный руками hex говорит о замысле;
 * снимок образца говорит о том, что бренд держал в руках.
 *
 * ЧЕСТНО О ГРАНИЦЕ. Снимок под неизвестным светом не является цветопробой
 * и не может ею быть: та же ткань под лампой накаливания и под дневным светом
 * даёт разные числа, и по одному кадру отличить цвет ткани от цвета света
 * нельзя. Поэтому результат называется референсом, а не измерением, и в
 * документе рядом с ним стоит прямая оговорка. Точный цвет фиксируется
 * координатами Lab и подтверждается лабдипом — выкрасом фабрики на этом
 * самом полотне.
 *
 * Что мы всё-таки проверяем: РОВНО ЛИ СНЯТ образец. Складка, тень и блик дают
 * на кадре разные цвета, и тогда «цвет образца» — это выбор одного из них,
 * а не факт.
 *
 * И вот здесь была ловушка, в которую мы сначала попали. Первая версия
 * раскладывала кадр на краски тем же цветоделением, что и рисунок, — и ровный
 * выкрас забраковался: переплетение трикотажа даёт блик на петле и тень между
 * петлями, а это законные 6 ΔE. Метрика ловила ФАКТУРУ, обещая ловить складку.
 * Поднимать порог было бы починкой правильной метрики под неверный пример.
 *
 * Правильное различие не в амплитуде, а в МАСШТАБЕ: фактура меняется от петли
 * к петле, складка — на четверть кадра. Поэтому кадр сначала усредняется
 * в сетку крупных ячеек. Внутри ячейки фактура усредняется сама собой,
 * а складка остаётся: она больше ячейки.
 */

/**
 * Предел разброса между ячейками, ΔE.
 *
 * Не подобран под примеры, а взят из того же правила, что и цветоделение:
 * две краски сливаются в одну при ΔE < 4, а различие в 5 колорист видит
 * уверенно. Если две крупные области кадра расходятся сильнее — на кадре
 * не один цвет.
 */
export const SWATCH_SPREAD_LIMIT = 5;

/** Сторона сетки усреднения. 12×12 = 144 ячейки — складка крупнее любой из них. */
const GRID = 12;

/**
 * Какую долю кадра брать. Края снимка почти всегда содержат фон: стол,
 * пальцы, вторую ткань. Центр — это то, ради чего кадр сделан.
 */
const CENTER_CROP = 0.7;

export interface SwatchReading {
  hex: string;
  lab: [number, number, number];
  /** Наибольшее расхождение крупных областей кадра с основным цветом, ΔE. */
  spread_delta_e: number;
  /** Сколько ячеек сетки разошлись с основным цветом сильнее предела. */
  off_cells: number;
  uniform: boolean;
  verdict_ru: string;
}

export async function readSwatch(dataUri: string, browser?: Browser): Promise<SwatchReading> {
  const own = browser === undefined;
  const b = browser ?? (await chromium.launch());
  try {
    const page = await b.newPage();
    let cells: [number, number, number][];
    try {
      // Плоские циклы без именованных функций: код исполняется в браузере,
      // а сборщик tsx подставляет в именованные функции __name, которого
      // в браузере нет (см. seam.ts).
      cells = await page.evaluate(
        async ([uri, grid, crop]: [string, number, number]) => {
          const img = new Image();
          img.src = uri;
          await img.decode();

          const cw = img.naturalWidth * crop;
          const ch = img.naturalHeight * crop;
          const cx = (img.naturalWidth - cw) / 2;
          const cy = (img.naturalHeight - ch) / 2;

          const canvas = document.createElement('canvas');
          canvas.width = grid;
          canvas.height = grid;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          // Сжатие в сетку и есть усреднение: браузер считает средний цвет
          // области сам, и делает это быстрее и точнее ручного цикла.
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, cx, cy, cw, ch, 0, 0, grid, grid);

          const data = ctx.getImageData(0, 0, grid, grid).data;
          const out: [number, number, number][] = [];
          for (let i = 0; i < data.length; i += 4) {
            out.push([data[i]!, data[i + 1]!, data[i + 2]!]);
          }
          return out;
        },
        [dataUri, GRID, CENTER_CROP] as [string, number, number],
      );
    } finally {
      await page.close();
    }

    return summarise(
      cells.map((rgb) => rgbToLab(rgb)),
      cells,
    );
  } finally {
    if (own) await b.close();
  }
}

function summarise(
  labs: [number, number, number][],
  rgbs: [number, number, number][],
): SwatchReading {
  // Основной цвет — медианная ячейка, а не среднее по кадру. Среднее двух
  // половин складки даёт цвет, которого на ткани нет вовсе; медиана всегда
  // указывает на реально снятую область.
  const median = (i: 0 | 1 | 2): number => {
    const sorted = labs.map((l) => l[i]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  const center: [number, number, number] = [median(0), median(1), median(2)];

  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < labs.length; i++) {
    const d = deltaE(labs[i]!, center);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }

  const main = labs[best]!;
  const distances = labs.map((l) => deltaE(l, main));
  const spread = Math.max(...distances);
  const offCells = distances.filter((d) => d > SWATCH_SPREAD_LIMIT).length;
  const uniform = offCells === 0;

  return {
    hex: toHex(rgbs[best]!),
    lab: main,
    spread_delta_e: Math.round(spread * 10) / 10,
    off_cells: offCells,
    uniform,
    verdict_ru: verdict(toHex(rgbs[best]!), spread, offCells, labs.length, uniform),
  };
}

function verdict(
  hex: string,
  spread: number,
  offCells: number,
  total: number,
  uniform: boolean,
): string {
  if (uniform) {
    return (
      `Снимок ровный: центр кадра разбит на ${total} областей, и ни одна ` +
      `не расходится с основным цветом сильнее ${SWATCH_SPREAD_LIMIT} ΔE ` +
      `(наибольшее расхождение ${spread.toFixed(1)}). Фактура переплетения ` +
      `на это не влияет — она усредняется внутри области. Взят ${hex}.`
    );
  }
  return (
    `Кадр снят неровно: ${offCells} областей из ${total} расходятся с основным ` +
    `цветом, наибольшее расхождение ${spread.toFixed(1)} ΔE. На таком масштабе ` +
    `это складка, тень или край второго предмета, а не фактура полотна. ` +
    `Взят ${hex} по медианной области, но снимок лучше переснять: разложите ` +
    `образец ровно и во весь кадр, при равномерном рассеянном свете, без ` +
    `вспышки и без падающей тени.`
  );
}
