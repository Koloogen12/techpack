import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { checkSeam, extractColors, mirrorTile, separateColors } from '@seamsterly/pattern';

/**
 * Паттерн-студия на синтетических тайлах.
 *
 * Настоящий тайл приходит от платной модели, и проверять им метрику
 * значит платить за каждый прогон и зависеть от сети. Синтетический тайл
 * отвечает на тот же вопрос строже: у него ИЗВЕСТЕН правильный ответ.
 * Полосатый тайл бесшовен по построению, двухцветный шов имеет по
 * построению, три плашки — ровно три краски.
 */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Тайл рисуется в браузере — там же, где его потом читают метрики. */
async function tile(draw: string, size = 256): Promise<string> {
  const page = await browser.newPage();
  await page.setContent(
    `<canvas id="c" width="${size}" height="${size}"></canvas><script>
     const x = document.getElementById('c').getContext('2d');
     ${draw}
     </script>`,
    { waitUntil: 'domcontentloaded' },
  );
  const uri = await page.evaluate(() =>
    (document.getElementById('c') as HTMLCanvasElement).toDataURL('image/png'),
  );
  await page.close();
  return uri;
}

/**
 * Бесшовный ПО ПОСТРОЕНИЮ: синусоида с целым числом периодов на сторону.
 *
 * Полосы для этого не годятся, и это поучительно: восемь полос по 32 px
 * дают последнюю полосу одного цвета рядом с первой другого — тайл со
 * швом, хотя выглядит регулярным. Метрика такой тайл честно бракует.
 */
const WAVE = `const img = x.createImageData(256, 256);
for (let yy = 0; yy < 256; yy++) {
  for (let xx = 0; xx < 256; xx++) {
    const v = 128 + 90 * Math.sin((2 * Math.PI * xx) / 256) * Math.cos((2 * Math.PI * yy) / 256);
    const i = (yy * 256 + xx) * 4;
    img.data[i] = v; img.data[i + 1] = v * 0.8; img.data[i + 2] = 200 - v * 0.3; img.data[i + 3] = 255;
  }
}
x.putImageData(img, 0, 0);`;
const SPLIT = `x.fillStyle = '#111'; x.fillRect(0, 0, 128, 256);
x.fillStyle = '#EEE'; x.fillRect(128, 0, 128, 256);`;
const THREE = `x.fillStyle = '#C0392B'; x.fillRect(0, 0, 256, 86);
x.fillStyle = '#2F7C5A'; x.fillRect(0, 86, 256, 85);
x.fillStyle = '#1B4F91'; x.fillRect(0, 171, 256, 85);`;

describe('метрика шва', () => {
  it('бесшовный по построению тайл не бракует', async () => {
    // Синусоида с целым числом периодов сходится сама с собой по обеим осям.
    const report = await checkSeam(await tile(WAVE), browser);
    expect(report.vertical).toBeLessThan(2);
    expect(report.horizontal).toBeLessThan(2);
    expect(report.seamless).toBe(true);
  }, 60_000);

  it('шов посреди тайла находит', async () => {
    // Левая половина чёрная, правая белая: край с краем не сойдётся.
    const report = await checkSeam(await tile(SPLIT), browser);
    expect(report.horizontal).toBeGreaterThan(2);
    expect(report.seamless).toBe(false);
  }, 60_000);

  it('зеркальная укладка стык улучшает, а не портит', async () => {
    // Блок 2×2 из отражений бесшовен ПОСТРОЕНИЕМ — на этом и держится
    // запасной путь, когда модель дважды подряд отдала тайл со швом.
    const seamy = await tile(SPLIT);
    const before = await checkSeam(seamy, browser);
    const after = await checkSeam((await mirrorTile(seamy, browser)).dataUri, browser);
    expect(after.horizontal).toBeLessThanOrEqual(before.horizontal);
  }, 90_000);
});

describe('цветоделение', () => {
  it('три плашки разбирает тремя красками', async () => {
    const report = await extractColors(await tile(THREE), 6, browser);
    expect(report.colors).toHaveLength(3);
    expect(report.flat_graphic).toBe(true);
  }, 60_000);

  it('плашка выходит сплошной, а не крапчатой', async () => {
    // Крапчатая полоса — это кайма сглаживания: площади много, сплошных
    // пикселей почти нет, и сетка под неё печатает грязь.
    const uri = await tile(THREE);
    const report = await extractColors(uri, 6, browser);
    const result = await separateColors(uri, report, { browser });
    expect(result.separations).toHaveLength(report.colors.length);
    for (const s of result.separations) expect(s.solidity, s.hex).toBeGreaterThan(0.9);
  }, 90_000);

  it('для плоской графики вектор собирается', async () => {
    const uri = await tile(THREE);
    const report = await extractColors(uri, 6, browser);
    const result = await separateColors(uri, report, { browser });
    expect(result.svg, result.vector_verdict_ru).toBeTruthy();
    expect(result.vector).toHaveLength(report.colors.length);
  }, 90_000);
});
