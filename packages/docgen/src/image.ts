import type { Browser } from 'playwright';

/**
 * Уменьшение растровых изображений перед вставкой в документ.
 *
 * Снимок с телефона весит пять мегабайт, в base64 — почти семь, и попадает
 * в КАЖДУЮ выгрузку по ролям. Пять ролей превращают техпак в тридцать
 * мегабайт, который фабрике уже не отправить почтой. На листе A4 при 200 dpi
 * картинка всё равно занимает меньше полутора тысяч пикселей по длинной
 * стороне — остальное печатается в мусор.
 *
 * Масштабирование делает тот же Chromium, который печатает PDF: браузер уже
 * поднят, а тянуть в зависимости графическую библиотеку ради одной операции
 * не за чем.
 */

/** Длинная сторона после уменьшения. 1600 px ≈ 200 dpi на половине листа A4. */
export const MAX_IMAGE_PX = 1600;

/** Data-URI длиннее этого пережимается в JPEG даже без уменьшения (≈600 КБ). */
const HEAVY_URI = 800_000;

export async function fitImage(
  browser: Browser,
  dataUri: string,
  maxPx: number = MAX_IMAGE_PX,
): Promise<string> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([uri, limit, HEAVY_URI]: [string, number, number]) => {
        const img = new Image();
        img.src = uri;
        try {
          await img.decode();
        } catch {
          // Не смогли прочитать — отдаём как есть. Документ важнее веса.
          return uri;
        }

        const side = Math.max(img.naturalWidth, img.naturalHeight);
        // Небольшой по пикселям, но тяжёлый по байтам снимок — PNG-24 с
        // фотографией — тоже пережимается: шесть мегабайт на 1000 px
        // печатаются в те же точки, что и триста килобайт JPEG.
        if (side <= limit && uri.length <= HEAVY_URI) return uri;

        const scale = limit / side;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) return uri;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // JPEG, а не PNG: это фотография, и PNG на ней экономит ноль.
        return canvas.toDataURL('image/jpeg', 0.82);
      },
      [dataUri, maxPx, HEAVY_URI] as [string, number, number],
    );
  } catch {
    return dataUri;
  } finally {
    await page.close();
  }
}

/**
 * Яркость пикселей листа эскиза — для разрезки на виды.
 *
 * Уменьшенная копия, только luma: разрезке нужны колонки без линий, а не
 * цвет и не полное разрешение. Сама разрезка — чистая функция в render
 * (`sheetBoxes`); браузер здесь только достаёт пиксели.
 */
export async function sheetLuma(
  browser: Browser,
  dataUri: string,
  maxWidth = 600,
): Promise<{ width: number; height: number; luma: Uint8Array } | null> {
  const page = await browser.newPage();
  try {
    const r = await page.evaluate(
      async ([uri, limit]: [string, number]) => {
        const img = new Image();
        img.src = uri;
        try {
          await img.decode();
        } catch {
          return null;
        }
        const scale = Math.min(1, limit / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const luma: number[] = new Array<number>(w * h);
        for (let i = 0; i < w * h; i++) {
          luma[i] = Math.round(
            0.299 * (d[i * 4] ?? 255) +
              0.587 * (d[i * 4 + 1] ?? 255) +
              0.114 * (d[i * 4 + 2] ?? 255),
          );
        }
        return { width: w, height: h, luma };
      },
      [dataUri, maxWidth] as [string, number],
    );
    return r ? { width: r.width, height: r.height, luma: Uint8Array.from(r.luma) } : null;
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Вырезка прямоугольника из картинки — в долях ширины и высоты.
 *
 * Полное разрешение источника: вид пойдёт на обложку и в лист на просчёт,
 * и терять линии на уменьшении нельзя. JPEG 0.92 держит штрих чёрным и
 * весит втрое меньше PNG на том же рисунке.
 */
export async function cropImage(
  browser: Browser,
  dataUri: string,
  box: { x0: number; y0: number; x1: number; y1: number },
): Promise<string | null> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([uri, b]: [string, { x0: number; y0: number; x1: number; y1: number }]) => {
        const img = new Image();
        img.src = uri;
        try {
          await img.decode();
        } catch {
          return null;
        }
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const sx = Math.round(b.x0 * W);
        const sy = Math.round(b.y0 * H);
        const sw = Math.max(1, Math.round((b.x1 - b.x0) * W));
        const sh = Math.max(1, Math.round((b.y1 - b.y0) * H));
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, sw, sh);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        return canvas.toDataURL('image/jpeg', 0.92);
      },
      [dataUri, box] as [string, { x0: number; y0: number; x1: number; y1: number }],
    );
  } catch {
    return null;
  } finally {
    await page.close();
  }
}
