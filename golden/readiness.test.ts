import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { readiness } from '@seamster/docgen';

/**
 * Гейт отправки. Проверяется не «функция вернула объект», а граница: что
 * именно держит документ внутри и что держать не должно.
 */
const base = {
  id: 'gate',
  name: 'Худи',
  article: 'GATE-1',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-03T00:00:00.000Z'),
} as unknown as StyleSpecInput;

describe('готовность к отправке', () => {
  it('без профиля бренда документ наружу не выпускается', () => {
    const { spec } = buildStyleSpec(base);
    const state = readiness(spec);
    expect(state.ready).toBe(false);
    expect(state.gaps.map((g) => g.id).sort()).toEqual(['country', 'manufacturer', 'trademark']);
  });

  it('дату изготовления гейт не требует — её ставит фабрика', () => {
    const { spec } = buildStyleSpec(base);
    expect(readiness(spec).gaps.map((g) => g.id)).not.toContain('production_date');
  });

  it('с заполненным профилем бренда документ готов', () => {
    const { spec } = buildStyleSpec({
      ...base,
      brand_profile: {
        company_name: 'ИП Кочнев Д. А.',
        inn: '662345678901',
        address: 'Екатеринбург, ул. Мира 32',
        country: 'Россия',
        trademark: 'SEAMSTER',
      },
    } as unknown as StyleSpecInput);
    const state = readiness(spec);
    expect(state.gaps).toEqual([]);
    expect(state.ready).toBe(true);
  });

  it('у каждого пробела есть действие, которое можно выполнить', () => {
    const { spec } = buildStyleSpec(base);
    for (const gap of readiness(spec).gaps) {
      expect(gap.action_ru.length).toBeGreaterThan(10);
      expect(gap.label_ru.length).toBeGreaterThan(3);
    }
  });
});
