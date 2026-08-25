import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { checkSeam, SEAM_RATIO_LIMIT } from '../src/index.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

/**
 * Бесшовность проверяется пикселями, а не на глаз. Тайлы здесь строятся
 * формулой, поэтому про каждый ЗАРАНЕЕ известно, стыкуется он или нет, —
 * и проверяется не «похоже на правду», а то, что метрика различает эти два
 * случая на любом рисунке.
 */
const svg = (body: string, size = 256): string =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`,
  ).toString('base64');

/** Синус по обеим осям с целым числом периодов — стыкуется точно. */
const seamlessWaves = (periods = 4, size = 256): string => {
  const rects: string[] = [];
  for (let x = 0; x < size; x += 2) {
    for (let y = 0; y < size; y += 2) {
      const v = Math.round(
        127 +
          126 *
            Math.sin((2 * Math.PI * periods * x) / size) *
            Math.sin((2 * Math.PI * periods * y) / size),
      );
      rects.push(`<rect x="${x}" y="${y}" width="2" height="2" fill="rgb(${v},${v},${v})"/>`);
    }
  }
  return svg(rects.join(''), size);
};

/**
 * Градиент слева направо — классический нестыкующийся тайл: левый край
 * тёмный, правый светлый, и при укладке рядом получается резкий скачок.
 *
 * Рамка по всем четырём сторонам, наоборот, стыкуется прекрасно: она даёт
 * клетку, а не шов. Первая версия теста этого не различала — метрика оказалась
 * права, а пример неверен.
 */
const gradient = (): string =>
  svg(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>` +
      `</linearGradient></defs><rect width="256" height="256" fill="url(#g)"/>`,
  );

describe('проверка стыка раппорта', () => {
  it('точно стыкующийся тайл признаётся бесшовным', async () => {
    const r = await checkSeam(seamlessWaves(), browser);
    expect(r.seamless).toBe(true);
    expect(r.worst).toBeLessThanOrEqual(SEAM_RATIO_LIMIT);
  }, 60_000);

  it('тайл с разрывом на краю бракуется', async () => {
    const r = await checkSeam(gradient(), browser);
    expect(r.seamless).toBe(false);
    expect(r.worst).toBeGreaterThan(SEAM_RATIO_LIMIT);
  }, 60_000);

  it('метрика относительная — пёстрый рисунок не бракуется за пестроту', async () => {
    // Восемь периодов вместо четырёх: внутренние разницы выросли вчетверо,
    // а вердикт обязан остаться прежним. Абсолютный порог здесь бы поплыл.
    const fine = await checkSeam(seamlessWaves(8), browser);
    expect(fine.seamless).toBe(true);
  }, 60_000);

  it('сообщает размер тайла — от него считается разрешение на шаг', async () => {
    const r = await checkSeam(seamlessWaves(4, 128), browser);
    expect(r.width).toBe(128);
    expect(r.height).toBe(128);
  }, 60_000);

  it('симметричная рамка по краю — это клетка, а не шов', async () => {
    // Ловушка, на которой первая версия теста ошиблась: у такого тайла оба
    // края одинаковые, он укладывается идеально и бракованию не подлежит.
    const r = await checkSeam(
      svg(
        `<rect width="256" height="256" fill="#888"/>` +
          `<rect width="256" height="256" fill="none" stroke="#000" stroke-width="24"/>`,
      ),
      browser,
    );
    expect(r.seamless).toBe(true);
  }, 60_000);

  it('обе оси проверяются отдельно', async () => {
    // Разрыв только по горизонтали: вертикаль обязана остаться чистой.
    const halfBroken = svg(
      `<rect width="256" height="256" fill="#777"/>` +
        `<rect x="240" y="0" width="16" height="256" fill="#000"/>`,
    );
    const r = await checkSeam(halfBroken, browser);
    expect(r.horizontal).toBeGreaterThan(r.vertical);
  }, 60_000);
});
