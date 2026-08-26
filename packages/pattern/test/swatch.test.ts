import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readSwatch, SWATCH_SPREAD_LIMIT } from '../src/swatch.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const svg = (body: string, size = 400): string =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`,
  ).toString('base64');

describe('чтение образца полотна', () => {
  it('ровный выкрас принимается', async () => {
    const r = await readSwatch(svg(`<rect width="400" height="400" fill="#2A3550"/>`), browser);
    expect(r.uniform).toBe(true);
    expect(r.hex).toBe('#2A3550');
    expect(r.off_cells).toBe(0);
  }, 60_000);

  it('ФАКТУРА ПЕРЕПЛЕТЕНИЯ — не складка', async () => {
    // Ловушка, поймавшая нас саму. Трикотаж даёт блик на петле и тень между
    // петлями: на уровне пикселей это законные 6 ΔE, и первая версия метрики
    // браковала ровный выкрас. Различие не в амплитуде, а в МАСШТАБЕ —
    // фактура меняется от петли к петле и усредняется внутри области.
    const lines: string[] = [];
    for (let y = 0; y < 400; y += 4) {
      lines.push(`<rect y="${y}" width="400" height="2" fill="#3A4460"/>`);
    }
    const r = await readSwatch(
      svg(`<rect width="400" height="400" fill="#222C46"/>${lines.join('')}`),
      browser,
    );
    expect(r.uniform).toBe(true);
  }, 60_000);

  it('складка через кадр бракуется, а цвет всё равно берётся верный', async () => {
    const r = await readSwatch(
      svg(
        `<rect width="400" height="400" fill="#2A3550"/>` +
          `<rect x="230" width="170" height="400" fill="#141B2C"/>`,
      ),
      browser,
    );
    expect(r.uniform).toBe(false);
    expect(r.spread_delta_e).toBeGreaterThan(SWATCH_SPREAD_LIMIT);
    // Медианная область лежит на освещённой части: цвет ткани, а не тени
    // и не среднего между ними, которого на ткани нет вовсе.
    expect(r.hex).toBe('#2A3550');
    expect(r.verdict_ru).toContain('переснять');
  }, 60_000);

  it('фон по краям кадра в расчёт не идёт', async () => {
    // Снимок образца почти всегда захватывает стол или пальцы. Берётся центр —
    // то, ради чего кадр сделан.
    const r = await readSwatch(
      svg(
        `<rect width="400" height="400" fill="#FFFFFF"/>` +
          `<rect x="40" y="40" width="320" height="320" fill="#8C2F39"/>`,
      ),
      browser,
    );
    expect(r.uniform).toBe(true);
    expect(r.hex).toBe('#8C2F39');
  }, 60_000);
});
