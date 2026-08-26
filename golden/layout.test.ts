import { readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@specform/assembly';
import {
  checkLayout,
  fitImage,
  MAX_IMAGE_PX,
  renderHtml,
  roleProfile,
  EXPORT_ROLES,
} from '@specform/docgen';
import type { StyleSpec } from '@specform/stylespec';
import { diffSpecs } from '@specform/versions';
import { SCENARIOS } from './scenarios.js';

/**
 * Вёрстка документа меряется в браузере, а не на глаз.
 *
 * Разбиение таблиц на страницы задано числом строк на лист — это оценка.
 * Длинный текст в ячейке переносится, и лист перестаёт вмещать то же число
 * записей. Переполнение выглядит как наложение разделов друг на друга,
 * и часть данных исчезает из документа, оставаясь в данных.
 *
 * Именно так был найден первый серьёзный баг вёрстки. Здесь он закрыт
 * измерением, а не догадкой.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

describe('страницы вмещают своё содержимое', () => {
  it.each(SCENARIOS)(
    '$name',
    async ({ input }) => {
      const { spec } = buildStyleSpec(input);
      const report = await checkLayout(spec, { pro: true, browser });
      expect(
        report.overflows.map((o) => `лист ${o.index + 1} (${o.section}): +${o.overflowPx}px`),
      ).toEqual([]);
    },
    60_000,
  );

  it('в обычном режиме тоже', async () => {
    const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
    const report = await checkLayout(spec, { pro: false, browser });
    expect(report.overflows).toEqual([]);
  }, 60_000);

  it.each(EXPORT_ROLES)(
    'выгрузка «%s» не переполняется',
    async (role) => {
      const profile = roleProfile(role);
      const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
      const report = await checkLayout(spec, {
        sections: profile.sections,
        pro: profile.pro,
        browser,
      });
      expect(report.overflows).toEqual([]);
      expect(report.pages).toBeGreaterThan(0);
    },
    60_000,
  );
});

describe('запас прочности вёрстки', () => {
  const heavy = (over: Partial<StyleSpecInput>): StyleSpecInput => ({
    ...SCENARIOS[0]!.input,
    id: 'heavy',
    ...over,
  });

  it('десять размеров в ряду не ломают табель мер', async () => {
    const { spec } = buildStyleSpec(
      heavy({ base_size_ru: 48, size_range: [40, 42, 44, 46, 48, 50, 52, 54, 56, 58] }),
    );
    const report = await checkLayout(spec, { pro: true, browser });
    expect(report.overflows).toEqual([]);
  }, 60_000);

  it('шесть колорвеев не ломают матрицу артикулов', async () => {
    const { spec } = buildStyleSpec(
      heavy({
        colorways: [
          { id: 'c1', name_ru: 'Чёрный' },
          { id: 'c2', name_ru: 'Белый' },
          { id: 'c3', name_ru: 'Тёмно-синий' },
          { id: 'c4', name_ru: 'Экрю' },
          { id: 'c5', name_ru: 'Хаки' },
          { id: 'c6', name_ru: 'Бордовый' },
        ],
      }),
    );
    // Шесть цветов на шесть размеров — тридцать шесть артикулов.
    expect(spec.labels!.sku_matrix).toHaveLength(36);
    const report = await checkLayout(spec, { pro: true, browser });
    expect(report.overflows).toEqual([]);
  }, 60_000);

  it('длинные названия и описания не выталкивают содержимое за лист', async () => {
    const { spec } = buildStyleSpec(
      heavy({
        name: 'Футболка прямого силуэта из плотной кулирки с круглой горловиной и бейкой',
        description:
          'Прямой силуэт без сужения по талии, круглая горловина обработана бейкой из рибаны, ' +
          'низ изделия и низ рукавов подогнуты и прострочены распошивальной машиной в две ' +
          'параллельные строчки, плечевой шов усилен долевиком, размерник вложен в шов горловины.',
        brand: 'Очень Длинное Название Бренда Для Проверки Вёрстки',
        season: 'Весна–лето две тысячи двадцать шестого года',
      }),
    );
    const report = await checkLayout(spec, { pro: true, browser });
    expect(report.overflows).toEqual([]);
  }, 60_000);

  it('спека без части разделов не даёт пустых страниц', async () => {
    const bare = { ...buildStyleSpec(SCENARIOS[0]!.input).spec } as StyleSpec;
    delete (bare as { bom?: unknown }).bom;
    delete (bare as { labels?: unknown }).labels;

    const report = await checkLayout(bare, { pro: true, browser });
    expect(report.overflows).toEqual([]);
    expect(report.sections).not.toContain('bom');
    expect(report.sections).not.toContain('labels');
  }, 60_000);
});

describe('состав документа в браузере совпадает с ожидаемым', () => {
  it('полный документ содержит все разделы по порядку', async () => {
    const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
    const report = await checkLayout(spec, { pro: true, browser });

    expect(report.sections[0]).toBe('cover');
    expect(report.sections.at(-1)).toBe('patterns');
    for (const s of ['flats', 'measurements', 'bom', 'construction', 'labels']) {
      expect(report.sections, s).toContain(s);
    }
  }, 60_000);

  it('разделы идут группами, а не вперемешку', async () => {
    const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
    const { sections } = await checkLayout(spec, { pro: true, browser });

    const seen = new Set<string>();
    let previous = '';
    for (const s of sections) {
      if (s !== previous) {
        expect(seen.has(s), `раздел ${s} прерывается и возобновляется`).toBe(false);
        seen.add(s);
        previous = s;
      }
    }
  }, 60_000);
});

describe('страница внешнего вида вмещает картинки любой пропорции', () => {
  /**
   * Кадр произвольной пропорции. Сервис визуализации не даёт гарантий по
   * сторонам кадра, а снимок заказчика приходит каким угодно: и вертикальным
   * с телефона, и почти квадратным. Рамка обязана выдержать оба, не выдавив
   * подпись и примечание за лист.
   */
  const box = (w: number, h: number): string =>
    'data:image/svg+xml;base64,' +
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#8899aa"/></svg>`,
    ).toString('base64');

  const SHAPES: [string, number, number][] = [
    ['портрет 4:5', 1024, 1280],
    ['альбом 16:9', 1920, 1080],
    ['квадрат', 1024, 1024],
    ['узкая вертикаль 9:16', 1080, 1920],
  ];

  it.each(SHAPES)(
    'визуализация %s не переполняет лист',
    async (_name, w, h) => {
      const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
      const report = await checkLayout(spec, {
        pro: true,
        browser,
        visuals: { render: { dataUri: box(w, h) }, photos: [{ dataUri: box(1024, 768) }] },
      });
      expect(report.overflows).toEqual([]);
      expect(report.sections).toContain('preview');
    },
    60_000,
  );

  it('три снимка заказчика в колонке помещаются', async () => {
    const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
    const report = await checkLayout(spec, {
      pro: true,
      browser,
      visuals: {
        render: { dataUri: box(1024, 1280) },
        photos: [
          { dataUri: box(1080, 1920), label: 'Перед' },
          { dataUri: box(1080, 1920), label: 'Спинка' },
          { dataUri: box(1920, 1080), label: 'Узел горловины крупно' },
        ],
      },
    });
    expect(report.overflows).toEqual([]);
  }, 60_000);

  it('одни снимки без визуализации тоже не ломают лист', async () => {
    const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
    const report = await checkLayout(spec, {
      pro: true,
      browser,
      visuals: { photos: [{ dataUri: box(1080, 1920) }] },
    });
    expect(report.overflows).toEqual([]);
    expect(report.sections).toContain('preview');
  }, 60_000);

  it.each(EXPORT_ROLES)(
    'выгрузка «%s» с картинками не переполняется',
    async (role) => {
      const profile = roleProfile(role);
      const { spec } = buildStyleSpec(SCENARIOS[0]!.input);
      const report = await checkLayout(spec, {
        sections: profile.sections,
        pro: profile.pro,
        browser,
        visuals: { render: { dataUri: box(1024, 1280) }, photos: [{ dataUri: box(1080, 1920) }] },
      });
      expect(report.overflows).toEqual([]);
    },
    60_000,
  );
});

describe('снимок заказчика ужимается до размера листа', () => {
  /**
   * Найдено при первом включении снимков в документ: фотография с телефона
   * весит мегабайты и попадает в КАЖДУЮ выгрузку по ролям. Пять ролей —
   * и техпак перестаёт отправляться почтой. На листе A4 картинка всё равно
   * печатается меньше полутора тысяч пикселей по длинной стороне.
   *
   * Проверяется на НАСТОЯЩЕЙ фотографии: у вектора вес не зависит от числа
   * пикселей, и на SVG эта проверка ничего бы не значила.
   */
  const REAL = (() => {
    const bytes = readFileSync(new URL('./photos/hoodie-front.png', import.meta.url));
    return `data:image/png;base64,${bytes.toString('base64')}`;
  })();

  const sideOf = async (dataUri: string): Promise<[number, number]> => {
    const page = await browser.newPage();
    try {
      return await page.evaluate(async (uri: string) => {
        const img = new Image();
        img.src = uri;
        await img.decode();
        return [img.naturalWidth, img.naturalHeight] as [number, number];
      }, dataUri);
    } finally {
      await page.close();
    }
  };

  it('исходник действительно крупнее предела — иначе проверка пустая', async () => {
    const [w, h] = await sideOf(REAL);
    expect(Math.max(w, h)).toBeGreaterThan(MAX_IMAGE_PX);
  }, 60_000);

  it('длинная сторона после ужатия не превышает предел', async () => {
    const [w, h] = await sideOf(await fitImage(browser, REAL));
    expect(Math.max(w, h)).toBeLessThanOrEqual(MAX_IMAGE_PX);
  }, 60_000);

  it('пропорции не искажаются', async () => {
    const [ow, oh] = await sideOf(REAL);
    const [w, h] = await sideOf(await fitImage(browser, REAL));
    expect(w / h).toBeCloseTo(ow / oh, 2);
  }, 60_000);

  it('вес падает в разы — ради этого всё и делается', async () => {
    const fitted = await fitImage(browser, REAL);
    expect(fitted.length).toBeLessThan(REAL.length / 2);
  }, 60_000);

  it('картинка мельче предела не трогается вовсе', async () => {
    const small = await fitImage(browser, REAL, 400);
    expect(await fitImage(browser, small, MAX_IMAGE_PX)).toBe(small);
  }, 60_000);

  it('нечитаемое изображение возвращается как есть, а не роняет сборку', async () => {
    const broken = `data:image/png;base64,${Buffer.from('это не png').toString('base64')}`;
    expect(await fitImage(browser, broken)).toBe(broken);
  }, 60_000);
});

describe('чертёж: три вида в одном масштабе', () => {
  /**
   * На листе чертежа напечатано «виды в одном масштабе между собой».
   * Это обещание, и его нельзя проверять на глаз: колонки задаются
   * пропорцией flex, а высота ограничена сверху — если ограничение
   * сработает, один вид ужмётся, и обещание станет ложью.
   *
   * Меряем то, что напечатано: сантиметр изделия в пикселях листа.
   */
  it('сантиметр изделия одинаков на всех видах', async () => {
    const hoodie = SCENARIOS.find((s) => s.input.category === 'hoodie')!;
    const { spec } = buildStyleSpec(hoodie.input);
    const page = await browser.newPage();
    try {
      await page.setContent(renderHtml(spec, { sections: ['flats'] }), {
        waitUntil: 'domcontentloaded',
      });
      // Никаких именованных функций внутри evaluate: сборка tsx подставляет
      // __name, которого в браузере нет.
      const scales = await page.evaluate(() => {
        const out: { label: string; scale: number }[] = [];
        const figures = [...document.querySelectorAll<HTMLElement>('.canvas figure')];
        for (const fig of figures) {
          const svg = fig.querySelector('svg');
          if (!svg) continue;
          const box = svg.getBoundingClientRect();
          const vb = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
          out.push({
            label: fig.querySelector('figcaption')?.textContent ?? '?',
            scale: box.width / (vb[2] ?? 1),
          });
        }
        return out;
      });

      expect(scales.map((s) => s.label)).toEqual(['Перед', 'Спинка', 'Бок']);
      const values = scales.map((s) => s.scale);
      expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.02);
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe('страницы с картинками тоже вмещаются', () => {
  /**
   * Раздел нанесения с раппортом и раздел «Раппорт на изделии» не попадали
   * ни в один замер вёрстки: без визуалов их тело пустое, а сценарии
   * вёрстки визуалов не передают. Так и вышло, что у ряда чертежей
   * на странице раппорта вовсе не было правил — браузер верстал его
   * умолчаниями, во всю ширину листа один рисунок под другим.
   */
  const TILE =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVQIW2P8z8DwnwEJMDIwMDCiCwIAWkoEAJ4gWmYAAAAASUVORK5CYII=';

  it('нанесение и раппорт на изделии', async () => {
    const hoodie = SCENARIOS.find((s) => s.input.category === 'hoodie')!;
    const { spec } = buildStyleSpec({
      ...hoodie.input,
      colorways: [
        {
          id: 'navy',
          name_ru: 'Тёмно-синий',
          swatch: {
            file_name: 'navy.png',
            key: 'c'.repeat(64),
            hex: '#2A3550',
            lab: { l: 22.4, a: 4, b: -17.8 },
            spread_delta_e: 13.7,
            // Неровный образец берётся намеренно: у карточки появляется
            // длинное предупреждение, и лист обязан его вместить.
            uniform: false,
            verdict_ru:
              'Кадр снят неровно: 60 областей из 144 расходятся с основным цветом, ' +
              'наибольшее расхождение 13.7 ΔE. На таком масштабе это складка, тень ' +
              'или край второго предмета, а не фактура полотна. Взят #2A3550 ' +
              'по медианной области, но снимок лучше переснять: разложите образец ' +
              'ровно и во весь кадр, при равномерном рассеянном свете, без вспышки ' +
              'и без падающей тени.',
          },
          book_code: '19-4023 TCX',
          book_source: 'brand',
        },
        { id: 'sand', name_ru: 'Песочный', hex_approx: '#D8C7A6' },
        { id: 'olive', name_ru: 'Оливковый', hex_approx: '#6B6B3A' },
      ],
      patterns: [
        {
          tile: {
            file_name: 'tile.png',
            pixels: { width: 2048, height: 2048 },
            key: 'a'.repeat(64),
            seam_ratio: 1,
            seamless: true,
            mirrored: true,
          },
          repeat_cm: 24,
        },
      ],
    });
    const report = await checkLayout(spec, {
      browser,
      visuals: { patternTile: { dataUri: TILE, repeatCm: 24 } },
    });
    expect(
      report.overflows.map((o) => `лист ${o.index + 1} (${o.section}): +${o.overflowPx}px`),
    ).toEqual([]);
    expect(report.sections).toContain('artwork');
    expect(report.sections).toContain('colorways');
  }, 60_000);
});

describe('лист изменений вмещается', () => {
  /**
   * Изменений между версиями бывает много: смена посадки трогает почти весь
   * табель. Лист с обрезанным хвостом читается как полный — и человек уходит
   * работать, не увидев половины правок.
   */
  it('смена посадки меняет почти весь табель и всё равно помещается', async () => {
    const hoodie = SCENARIOS.find((s) => s.input.category === 'hoodie')!;
    const prev = buildStyleSpec(hoodie.input).spec;
    const next = buildStyleSpec({ ...hoodie.input, fit_intent: 'semi_fitted' }).spec;
    const report = await checkLayout(next, {
      browser,
      pro: true,
      changes: { from_version: 1, to_version: 2, diff: diffSpecs(prev, next) },
    });
    expect(
      report.overflows.map((o) => `лист ${o.index + 1} (${o.section}): +${o.overflowPx}px`),
    ).toEqual([]);
    expect(report.sections).toContain('changes');
  }, 60_000);
});
