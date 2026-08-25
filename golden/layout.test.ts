import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@specform/assembly';
import { checkLayout, roleProfile, EXPORT_ROLES } from '@specform/docgen';
import type { StyleSpec } from '@specform/stylespec';
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
