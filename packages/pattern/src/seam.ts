import { chromium, type Browser } from 'playwright';

/**
 * Проверка бесшовности — пикселями, а не на глаз.
 *
 * Конкурент показывает сгенерированный тайл и предлагает поверить, что он
 * стыкуется. Это и есть разница между картинкой и производственным файлом:
 * на изделии несостыковка вылезает полосой через всё полотно, и увидят её
 * на приёмке партии, а не на экране.
 *
 * Как меряем. У бесшовного тайла переход через край ничем не отличается
 * от перехода внутри рисунка: правый столбец продолжается левым так же
 * плавно, как любые два соседних столбца внутри. Поэтому сравниваем
 * НЕ абсолютную разницу краёв (она зависит от контрастности рисунка,
 * и порог пришлось бы подбирать под каждый паттерн), а ОТНОШЕНИЕ разницы
 * на стыке к типичной разнице внутри. У идеального тайла отношение около
 * единицы, у тайла с видимым швом — заметно больше.
 *
 * Такая метрика сама подстраивается под рисунок: у мелкого пёстрого узора
 * внутренние разницы велики, и небольшой скачок на стыке в нём действительно
 * не виден; у крупной спокойной заливки тот же скачок бросается в глаза.
 */

export interface SeamReport {
  /** Отношение разницы на стыке к типичной разнице внутри, по горизонтали. */
  horizontal: number;
  vertical: number;
  /** Худшее из двух — по нему и судим. */
  worst: number;
  seamless: boolean;
  width: number;
  height: number;
}

/**
 * Порог отношения, за которым стык считается видимым.
 *
 * Подобран на реальных тайлах: бесшовные дают 1.0–1.6, тайл с явной границей —
 * от трёх и выше. Полтора между ними взято с запасом в сторону строгости:
 * ложно забракованный тайл стоит одной перегенерации, пропущенный — партии.
 */
export const SEAM_RATIO_LIMIT = 2.2;

export async function checkSeam(dataUri: string, browser?: Browser): Promise<SeamReport> {
  const own = browser === undefined;
  const b = browser ?? (await chromium.launch());
  try {
    const page = await b.newPage();
    try {
      // ВНИМАНИЕ на стиль кода ниже: внутри page.evaluate нет ни одной
      // именованной функции. Сборщик (esbuild через tsx) оборачивает такие
      // функции в хелпер __name, которого в браузере не существует, и код
      // падает с ReferenceError уже в проде. Через vitest тот же код проходит:
      // у него другая настройка сборки. Поэтому здесь только плоские циклы —
      // код, исполняемый в чужом окружении, не имеет права зависеть
      // от того, чем его собрали.
      const raw = await page.evaluate(async (uri: string) => {
        const img = new Image();
        img.src = uri;
        await img.decode();

        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data;

        // Средняя разница между столбцами 0 и w-1 — переход через стык.
        let seamCols = 0;
        for (let y = 0; y < h; y++) {
          const a = y * w * 4;
          const b = (y * w + w - 1) * 4;
          seamCols +=
            Math.abs(data[a]! - data[b]!) +
            Math.abs(data[a + 1]! - data[b + 1]!) +
            Math.abs(data[a + 2]! - data[b + 2]!);
        }
        seamCols /= h * 3;

        let seamRows = 0;
        for (let x = 0; x < w; x++) {
          const a = x * 4;
          const b = ((h - 1) * w + x) * 4;
          seamRows +=
            Math.abs(data[a]! - data[b]!) +
            Math.abs(data[a + 1]! - data[b + 1]!) +
            Math.abs(data[a + 2]! - data[b + 2]!);
        }
        seamRows /= w * 3;

        // Внутренние разницы берём выборкой: полный обход мегапиксельного
        // тайла тратит секунды и ничего не уточняет.
        const step = Math.max(1, Math.floor(w / 64));
        const insideCols: number[] = [];
        for (let x = 1; x < w - 1; x += step) {
          let sum = 0;
          for (let y = 0; y < h; y++) {
            const a = (y * w + x) * 4;
            const b = (y * w + x + 1) * 4;
            sum +=
              Math.abs(data[a]! - data[b]!) +
              Math.abs(data[a + 1]! - data[b + 1]!) +
              Math.abs(data[a + 2]! - data[b + 2]!);
          }
          insideCols.push(sum / (h * 3));
        }

        const insideRows: number[] = [];
        for (let y = 1; y < h - 1; y += step) {
          let sum = 0;
          for (let x = 0; x < w; x++) {
            const a = (y * w + x) * 4;
            const b = ((y + 1) * w + x) * 4;
            sum +=
              Math.abs(data[a]! - data[b]!) +
              Math.abs(data[a + 1]! - data[b + 1]!) +
              Math.abs(data[a + 2]! - data[b + 2]!);
          }
          insideRows.push(sum / (w * 3));
        }

        return { w, h, seamCols, seamRows, insideCols, insideRows };
      }, dataUri);

      // Медиана, а не среднее: одна резкая линия внутри рисунка не должна
      // поднимать «типичную разницу» и тем самым прощать шов на краю.
      const median = (xs: number[]): number => {
        const sorted = [...xs].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? 0;
      };

      // Единица в знаменателе — от деления на ноль на однотонной заливке:
      // у неё внутренние разницы честно нулевые, и любой шов там виден сразу.
      const horizontal = raw.seamCols / (median(raw.insideCols) + 1);
      const vertical = raw.seamRows / (median(raw.insideRows) + 1);
      const worst = Math.max(horizontal, vertical);

      return {
        horizontal: round(horizontal),
        vertical: round(vertical),
        worst: round(worst),
        seamless: worst <= SEAM_RATIO_LIMIT,
        width: raw.w,
        height: raw.h,
      };
    } finally {
      await page.close();
    }
  } finally {
    if (own) await b.close();
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
