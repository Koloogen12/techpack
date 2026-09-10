import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { renderHtml } from '@seamster/docgen';
import { flatDefaults, renderFlatsFromSpec } from '@seamster/flats';
import { categoryWithGender } from '@seamster/kb';

const input = (category: 'cardigan' | 'sweater'): StyleSpecInput => ({
  id: category,
  name: category === 'cardigan' ? 'Кардиган на пуговицах' : 'Свитер',
  article: 'KN-001',
  category,
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-10T00:00:00.000Z'),
});

const lines = (category: 'cardigan' | 'sweater'): Set<string> => {
  const { spec } = buildStyleSpec(input(category));
  const flats = renderFlatsFromSpec(spec, flatDefaults(spec));
  const svgs = [flats.front.svg, flats.back.svg, ...(flats.side ? [flats.side.svg] : [])];
  const found = new Set<string>();
  for (const svg of svgs) for (const m of svg.matchAll(/data-line="([a-z_]+)"/g)) found.add(m[1]!);
  return found;
};

/**
 * Распашной кардиган и цельный свитер — на ЧЕРТЕЖЕ, а не только в данных.
 *
 * Разница между ними ровно одна, и она видна глазами: у кардигана перед
 * разрезан по центру и собран на планке. Если на чертеже этого нет, две
 * категории приходят на фабрику одинаковыми картинками, и рисунок начинает
 * противоречить спецификации, где у одной вещи пуговицы, а у другой нет.
 */
describe('кардиган и свитер на чертеже', () => {
  it('у кардигана перед разрезан, у свитера — нет', () => {
    const cardigan = lines('cardigan');
    const sweater = lines('sweater');
    // Линия центра переда и отстрочка планки вдоль неё.
    expect([...cardigan]).toContain('zip_line');
    expect([...cardigan]).toContain('zip_stitch');
    expect([...sweater]).not.toContain('zip_line');
    expect([...sweater]).not.toContain('zip_stitch');
  });

  it('всё остальное на чертеже у них общее', () => {
    // Иначе разница читалась бы не как застёжка, а как другой крой.
    const cardigan = lines('cardigan');
    const sweater = lines('sweater');
    for (const line of sweater) expect(cardigan, line).toContain(line);
    for (const line of ['neck_band', 'cuff', 'waistband', 'armhole']) {
      expect([...sweater], line).toContain(line);
    }
  });

  it('в русском техпаке вещь названа по-русски и в нужном роде', () => {
    // Реквизит ярлыка читает живой человек: «свитер женская» — брак печати.
    expect(categoryWithGender('cardigan', 'women')).toBe('Кардиган женский');
    expect(categoryWithGender('sweater', 'men')).toBe('Свитер мужской');
    for (const category of ['cardigan', 'sweater'] as const) {
      const { spec } = buildStyleSpec(input(category));
      const html = renderHtml(spec, { pro: true, locale: 'ru' });
      expect(html, category).toContain(categoryWithGender(category, 'women'));
      expect(html, category).not.toContain(category);
    }
  });

  it('документ кардигана говорит про планку и пуговицы, документ свитера — нет', () => {
    const html = (category: 'cardigan' | 'sweater'): string =>
      renderHtml(buildStyleSpec(input(category)).spec, { pro: true, locale: 'ru' });
    const cardigan = html('cardigan');
    const sweater = html('sweater');
    for (const word of ['планк', 'Пуговиц']) expect(cardigan, word).toContain(word);
    expect(sweater).not.toContain('Пуговиц');
    expect(sweater).not.toContain('петл');
  });
});
