import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'woven-dress',
  name: 'Платье из ткани',
  article: 'WD-001',
  category: 'dress',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'woven',
  size_range: [42, 44, 46, 48],
  generated_at: new Date('2026-09-09T00:00:00.000Z'),
};

const woven = buildStyleSpec(INPUT);
const knit = buildStyleSpec({ ...INPUT, fabric_kind: 'knit' });

describe('тканое платье собирается своей технологией', () => {
  it('узлы взяты тканые, а не трикотажные', () => {
    const ids = woven.spec.construction?.nodes.map((n) => n.node_id) ?? [];
    expect(ids).toContain('dart_waist');
    expect(ids).toContain('invisible_zip_back');
    expect(ids).toContain('neck_facing');
    expect(ids).not.toContain('neck_rib_band');
    expect(knit.spec.construction?.nodes.map((n) => n.node_id)).toContain('neck_rib_band');
  });

  it('в спецификации потайная молния и клеевая прокладка, рибаны нет', () => {
    const materials = woven.spec.bom?.lines.map((l) => l.material_id) ?? [];
    expect(materials).toContain('zipper_invisible');
    expect(materials).toContain('fusible_nonwoven');
    expect(materials.some((m) => m.startsWith('rib_'))).toBe(false);
  });

  it('потайная подгибка получает замену под базовый цех и говорит об этом вслух', () => {
    const hem = woven.spec.construction?.nodes.find((n) => n.node_id === 'hem_blind');
    expect(hem?.requires_special_equipment).toBe(true);
    expect(hem?.alternative?.node_id).toBe('hem_topstitch_lockstitch');
    expect(woven.notes.join(' ')).toContain('Потайная подгибка низа');
  });

  it('табель мер тканого платья без бейки и с длиной застёжки', () => {
    const codes = woven.spec.measurements.points.map((p) => p.code);
    expect(codes).not.toContain('T17');
    expect(codes).toContain('Z01');
    // Длина застёжки следует за ростом, а не за шириной груди.
    const zip = woven.spec.measurements.points.find((p) => p.code === 'Z01');
    expect(zip?.base.value).toBeGreaterThan(40);
    expect(zip?.base.value).toBeLessThan(70);
  });

  it('ширина по груди у ткани больше: прибавка не может уходить в минус', () => {
    const chest = (s: typeof woven) =>
      s.spec.measurements.points.find((p) => p.code === 'T03')!.base.value;
    expect(chest(woven)).toBeGreaterThan(0);
    expect(chest(woven)).not.toBe(chest(knit));
  });

  it('в происхождении спеки записан именно тканый справочник', () => {
    expect(Object.keys(woven.spec.meta.kb_versions)).toContain('category_defaults/dress.woven');
    expect(Object.keys(knit.spec.meta.kb_versions)).toContain('category_defaults/dress');
  });

  it('расход считается по тканой норме', () => {
    const m = (s: typeof woven) => s.spec.bom?.fabric_consumption_m.value ?? 0;
    expect(m(woven)).toBeGreaterThan(m(knit));
  });
});
