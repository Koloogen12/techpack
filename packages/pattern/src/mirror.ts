import { chromium, type Browser } from 'playwright';

/**
 * Зеркальный раппорт — гарантированно бесшовный, построением.
 *
 * Модель теряет бесшовность первой и теряет её несимметрично: на живом
 * прогоне тайл сошёлся по горизонтали (0.61) и разошёлся по вертикали (8.67),
 * причём дважды подряд. Третья попытка вслепую стоила бы ещё одного платного
 * вызова с тем же исходом.
 *
 * Зеркальная укладка решает это арифметикой, а не удачей: из тайла собирается
 * блок 2×2, где правая половина — отражение левой, а нижняя — отражение
 * верхней. Края блока тогда СОВПАДАЮТ с собой по построению, и шва нет
 * ни при какой картинке.
 *
 * Это не хитрость и не подмена: mirror repeat — обычный тип раппорта
 * в текстиле, наравне с прямым и с half-drop. Но он МЕНЯЕТ РИСУНОК: появляется
 * видимая симметрия, а физический шаг удваивается. Поэтому применяется только
 * явно и сообщается пользователю — молча зеркалить чужой дизайн нельзя.
 */

export interface MirroredTile {
  dataUri: string;
  bytes: Uint8Array;
  mediaType: string;
  pixels: { width: number; height: number };
}

export async function mirrorTile(dataUri: string, browser?: Browser): Promise<MirroredTile> {
  const own = browser === undefined;
  const b = browser ?? (await chromium.launch());
  try {
    const page = await b.newPage();
    try {
      // Плоские вызовы без именованных функций: код исполняется в браузере,
      // и сборщик не должен иметь к нему отношения (см. seam.ts).
      const out = await page.evaluate(async (uri: string) => {
        const img = new Image();
        img.src = uri;
        await img.decode();

        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w * 2;
        canvas.height = h * 2;
        const ctx = canvas.getContext('2d')!;

        // Левый верхний — исходный. Остальные три — его отражения.
        ctx.drawImage(img, 0, 0);

        ctx.save();
        ctx.translate(w * 2, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        ctx.restore();

        ctx.save();
        ctx.translate(0, h * 2);
        ctx.scale(1, -1);
        ctx.drawImage(img, 0, 0);
        ctx.restore();

        ctx.save();
        ctx.translate(w * 2, h * 2);
        ctx.scale(-1, -1);
        ctx.drawImage(img, 0, 0);
        ctx.restore();

        return canvas.toDataURL('image/png');
      }, dataUri);

      const bytes = Buffer.from(out.slice(out.indexOf(',') + 1), 'base64');
      return {
        dataUri: out,
        bytes,
        mediaType: 'image/png',
        pixels: { width: 0, height: 0 },
      };
    } finally {
      await page.close();
    }
  } finally {
    if (own) await b.close();
  }
}
