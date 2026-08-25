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

export async function fitImage(
  browser: Browser,
  dataUri: string,
  maxPx: number = MAX_IMAGE_PX,
): Promise<string> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([uri, limit]: [string, number]) => {
        const img = new Image();
        img.src = uri;
        try {
          await img.decode();
        } catch {
          // Не смогли прочитать — отдаём как есть. Документ важнее веса.
          return uri;
        }

        const side = Math.max(img.naturalWidth, img.naturalHeight);
        if (side <= limit) return uri;

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
      [dataUri, maxPx] as [string, number],
    );
  } catch {
    return dataUri;
  } finally {
    await page.close();
  }
}
