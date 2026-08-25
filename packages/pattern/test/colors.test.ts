import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  deltaE,
  extractColors,
  matchColors,
  rgbToLab,
  separateColors,
  toHex,
  FLAT_GRAPHIC_FIDELITY,
  MATCH_LIMIT_DELTA_E,
} from '../src/index.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const svg = (body: string, size = 256): string =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`,
  ).toString('base64');

/** Три плашки известной площади: 50% / 25% / 25%. */
const flatThree = (): string =>
  svg(
    `<rect width="256" height="128" fill="#CC2222"/>` +
      `<rect y="128" width="128" height="128" fill="#2255CC"/>` +
      `<rect x="128" y="128" width="128" height="128" fill="#22AA55"/>`,
  );

/** Непрерывный переход: красок в нём нет вовсе. */
const gradient = (): string =>
  svg(
    `<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/>` +
      `<stop offset="1" stop-color="#fff"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>`,
  );

describe('перевод цвета', () => {
  it('чёрный и белый дают крайние значения светлоты', () => {
    expect(rgbToLab([0, 0, 0])[0]).toBe(0);
    expect(rgbToLab([255, 255, 255])[0]).toBe(100);
  });

  it('ΔE между одинаковыми цветами нулевое', () => {
    expect(deltaE(rgbToLab([120, 40, 200]), rgbToLab([120, 40, 200]))).toBe(0);
  });

  it('в Lab одинаковая арифметическая разница RGB весит по-разному', () => {
    // Ради этого Lab и нужен: в RGB обе пары различаются на 30 по одному
    // каналу, а глаз видит разницу совершенно по-разному.
    const dark = deltaE(rgbToLab([10, 10, 10]), rgbToLab([40, 10, 10]));
    const light = deltaE(rgbToLab([210, 210, 210]), rgbToLab([240, 210, 210]));
    expect(dark).not.toBeCloseTo(light, 0);
  });

  it('hex собирается с ведущими нулями', () => {
    expect(toHex([0, 8, 255])).toBe('#0008FF');
  });
});

describe('разбор красок тайла', () => {
  it('находит плашки и их доли площади', async () => {
    const r = await extractColors(flatThree(), 3, browser);
    expect(r.colors).toHaveLength(3);
    expect(r.colors[0]!.share).toBeCloseTo(0.5, 1);
    expect(r.colors[1]!.share).toBeCloseTo(0.25, 1);
  }, 60_000);

  it('плоская графика опознаётся плоской', async () => {
    const r = await extractColors(flatThree(), 3, browser);
    expect(r.fidelity).toBeGreaterThanOrEqual(FLAT_GRAPHIC_FIDELITY);
    expect(r.flat_graphic).toBe(true);
  }, 60_000);

  it('непрерывный переход плоским НЕ считается', async () => {
    // Пообещать печатнику вектор из градиента значит отдать файл,
    // который развалится на плёнке.
    const r = await extractColors(gradient(), 4, browser);
    expect(r.flat_graphic).toBe(false);
  }, 60_000);

  it('не выдаёт четыре сетки под один цвет', async () => {
    // Первый прогон на живом тайле дал из шести красок четыре почти
    // одинаковых белых: медианное сечение дробило фон. Ни одна пара
    // в итоговом списке не должна быть неразличимой.
    const r = await extractColors(flatThree(), 6, browser);
    for (let i = 0; i < r.colors.length; i++) {
      for (let j = i + 1; j < r.colors.length; j++) {
        expect(deltaE(r.colors[i]!.lab, r.colors[j]!.lab)).toBeGreaterThan(3);
      }
    }
  }, 60_000);

  it('результат детерминирован — повторный заказ получит те же сетки', async () => {
    const a = await extractColors(flatThree(), 3, browser);
    const b = await extractColors(flatThree(), 3, browser);
    expect(a.colors.map((c) => c.hex)).toEqual(b.colors.map((c) => c.hex));
  }, 60_000);
});

describe('каталог красок', () => {
  const measured = [
    {
      hex: '#CC2222',
      rgb: [204, 34, 34] as [number, number, number],
      lab: rgbToLab([204, 34, 34]),
      share: 0.5,
    },
  ];

  it('без каталога номера не выдумываются, и это объясняется', () => {
    const { matches, notes } = matchColors(measured);
    expect(matches[0]!.book).toBeNull();
    expect(notes.join(' ')).toContain('лицензируемые');
  });

  it('с каталогом подбирает ближайшую краску', () => {
    const { matches } = matchColors(measured, {
      id: 'test',
      label_ru: 'Тестовый',
      license_note_ru: 'демо',
      entries: [
        { code: 'A-1', rgb: [200, 30, 30] },
        { code: 'B-2', rgb: [30, 30, 200] },
      ],
    });
    expect(matches[0]!.book?.code).toBe('A-1');
  });

  it('далёкое попадание не выдаётся за точное', () => {
    const { matches, notes } = matchColors(measured, {
      id: 'test',
      label_ru: 'Скудный',
      license_note_ru: 'демо',
      entries: [{ code: 'ONLY', rgb: [30, 200, 30] }],
    });
    expect(matches[0]!.book!.delta_e).toBeGreaterThan(MATCH_LIMIT_DELTA_E);
    expect(notes.join(' ')).toContain('отличается заметно');
  });
});

describe('цветоделение в слои', () => {
  it('маска на каждую краску', async () => {
    const uri = flatThree();
    const report = await extractColors(uri, 3, browser);
    const sep = await separateColors(uri, report, { repeatCm: 20, browser });
    expect(sep.separations).toHaveLength(3);
    for (const s of sep.separations) expect(s.maskDataUri.startsWith('data:image/png')).toBe(true);
  }, 60_000);

  it('вектор строится для плоской графики, слой на краску', async () => {
    const uri = flatThree();
    const report = await extractColors(uri, 3, browser);
    const sep = await separateColors(uri, report, { repeatCm: 20, browser });
    expect(sep.vector).toHaveLength(3);
    expect(sep.svg).toContain('data-hex');
    expect(sep.vector_verdict_ru).toContain('Вектор построен');
  }, 60_000);

  it('для фотографичного рисунка вектора НЕТ, и сказано почему', async () => {
    const uri = gradient();
    const report = await extractColors(uri, 4, browser);
    const sep = await separateColors(uri, report, { repeatCm: 20, browser });
    expect(sep.svg).toBeNull();
    expect(sep.vector).toEqual([]);
    expect(sep.vector_verdict_ru).toContain('не построен');
    // Маски при этом есть: по ним видно, во что превратится рисунок.
    expect(sep.separations.length).toBeGreaterThan(0);
  }, 60_000);

  it('называет физический размер ступеньки контура', async () => {
    const uri = flatThree();
    const report = await extractColors(uri, 3, browser);
    const sep = await separateColors(uri, report, { repeatCm: 25.6, browser });
    // 256 px на 25.6 см — ровно миллиметр на пиксель.
    expect(sep.step_mm).toBe(1);
  }, 60_000);

  it('без шага раппорта физического размера нет и чистка не работает', async () => {
    const uri = flatThree();
    const report = await extractColors(uri, 3, browser);
    const sep = await separateColors(uri, report, { browser });
    expect(sep.step_mm).toBeNull();
    expect(sep.vector_verdict_ru).not.toContain('мм убраны');
  }, 60_000);
});
