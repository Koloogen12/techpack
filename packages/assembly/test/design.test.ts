import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'design',
  name: 'Платье',
  article: 'DSG-001',
  category: 'dress',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48],
  generated_at: new Date('2026-09-09T00:00:00.000Z'),
};

/**
 * Дизайн-признаки — единственный раздел без справочника: окат буф и пояс
 * есть только у ЭТОЙ вещи и берутся только со снимка. Поэтому источник
 * у них один и статус один — «оценка по фото».
 */
describe('дизайн-признаки с фото', () => {
  it('без наблюдений раздела нет — типовая вещь так и выглядит', () => {
    expect(buildStyleSpec(INPUT).spec.design).toBeUndefined();
    expect(buildStyleSpec({ ...INPUT, design_features: [] }).spec.design).toBeUndefined();
  });

  it('наблюдение уходит в спеку оценкой по фото с адресом источника', () => {
    const { spec } = buildStyleSpec({
      ...INPUT,
      design_features: [
        { zone: 'sleeve', en: 'gathered puff sleeve head', ru: 'окат буф', confidence: 'high' },
        {
          zone: 'waist',
          en: 'wide belt with round buckle',
          ru: 'широкий пояс',
          confidence: 'medium',
        },
      ],
    });
    const features = spec.design?.features ?? [];
    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({
      zone: 'sleeve',
      en: 'gathered puff sleeve head',
      ru: 'окат буф',
      certainty: 'high',
      confidence: 'estimated_from_photo',
      source: 'vision:design#sleeve',
    });
    expect(features[1]?.certainty).toBe('medium');
  });

  it('пустые формулировки и повторы не считаются признаками', () => {
    const { spec } = buildStyleSpec({
      ...INPUT,
      design_features: [
        { zone: 'sleeve', en: 'gathered puff sleeve head', ru: 'окат буф', confidence: 'high' },
        { zone: 'sleeve', en: 'Gathered puff sleeve head ', ru: 'окат буф', confidence: 'low' },
        { zone: 'hem', en: '', ru: 'подгиб', confidence: 'high' },
      ],
    });
    expect(spec.design?.features.map((f) => f.en)).toEqual(['gathered puff sleeve head']);
  });

  it('сомнительное наблюдение остаётся в спеке — решает конструктор, а не мы', () => {
    const { spec } = buildStyleSpec({
      ...INPUT,
      design_features: [{ zone: 'skirt', en: 'gored panels', ru: 'клинья', confidence: 'low' }],
    });
    expect(spec.design?.features[0]?.certainty).toBe('low');
  });

  it('дизайн-признаки не считаются предположениями: это наблюдение, а не догадка', () => {
    const plain = buildStyleSpec(INPUT).spec.meta.assumptions_count;
    const withDesign = buildStyleSpec({
      ...INPUT,
      design_features: [{ zone: 'sleeve', en: 'puff', ru: 'буф', confidence: 'high' }],
    }).spec.meta.assumptions_count;
    expect(withDesign).toBe(plain);
  });
});
