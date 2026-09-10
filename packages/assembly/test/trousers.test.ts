import { describe, expect, it } from 'vitest';
import { kb } from '@seamster/kb';
import { buildStyleSpec, type StyleSpecInput } from '../src/index.js';

const base = kb();
const INPUT: StyleSpecInput = {
  id: 'trousers',
  name: 'Брюки прямые',
  article: 'TR-001',
  category: 'trousers',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'woven',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-10T00:00:00.000Z'),
};

/**
 * Брюки — первое изделие с шаговым швом и гульфиком. Опорная величина та же,
 * что у юбки: низ держат бёдра. Отличие в том, что у мужчин обхвата бёдер
 * в стандарте нет вовсе, и там масштаб честно считается от талии.
 */
describe('брюки', () => {
  it('масштаб от бёдер: RU 46 женский — 98 см плюс прибавка', () => {
    const { spec } = buildStyleSpec(INPUT);
    // (98 + 5) / 2 = 51.5
    expect(spec.measurements.points.find((p) => p.code === 'B05')!.base.value).toBe(51.5);
  });

  it('у мужчин бёдер в сетке нет — масштаб от талии, и об этом сказано', () => {
    const { spec, notes } = buildStyleSpec({
      ...INPUT,
      gender: 'men',
      base_size_ru: 48,
      base_height_cm: 176,
      size_range: [46, 48, 50],
    });
    expect(notes.join(' ')).toContain('Обхвата бёдер');
    expect(spec.measurements.points.find((p) => p.code === 'B05')!.base.value).toBeGreaterThan(0);
  });

  it('брючина сужается от бедра к колену и низу', () => {
    const { spec } = buildStyleSpec(INPUT);
    const v = (c: string) => spec.measurements.points.find((p) => p.code === c)!.base.value;
    expect(v('B08')).toBeGreaterThan(v('B09'));
    expect(v('B09')).toBeGreaterThan(v('B10'));
  });

  it('задняя посадка глубже передней — так сидит человек', () => {
    const { spec } = buildStyleSpec(INPUT);
    const v = (c: string) => spec.measurements.points.find((p) => p.code === c)!.base.value;
    expect(v('B07')).toBeGreaterThan(v('B06'));
  });

  it('длины следуют за ростом, ширины — за размером', () => {
    const at = (over: Partial<StyleSpecInput>, c: string) =>
      buildStyleSpec({ ...INPUT, ...over }).spec.measurements.points.find((p) => p.code === c)!.base
        .value;
    expect(at({ base_height_cm: 182 }, 'B11')).toBeGreaterThan(at({ base_height_cm: 158 }, 'B11'));
    expect(at({ base_size_ru: 48 }, 'B11')).toBe(at({ base_size_ru: 44 }, 'B11'));
    expect(at({ base_size_ru: 48 }, 'B08')).toBeGreaterThan(at({ base_size_ru: 44 }, 'B08'));
  });

  it('собираются на поясе со шлёвками, гульфике и карманах в шве', () => {
    const nodes = base.categoryDefaultsFor('trousers', 'woven').default_nodes;
    for (const id of ['waistband_set_in', 'belt_loops', 'fly_zip', 'inseam_seam', 'crotch_seam'])
      expect(nodes, id).toContain(id);
  });

  it('закрепка гульфика требует машины вне базового цеха и знает замену', () => {
    const node = base.node('fly_bartack');
    expect(node.requires_special_equipment).toBe(true);
    expect(base.checkMachinePark(node, 'base_shop').alternative).not.toBeNull();
  });

  it('в спецификации брючная молния и пуговица пояса', () => {
    const { spec } = buildStyleSpec(INPUT);
    const ids = spec.bom!.lines.map((l) => l.material_id);
    expect(ids).toContain('zipper_trouser');
    expect(ids).toContain('button_trouser');
  });

  it('расход больше юбочного, а выпады меньше платьевых', () => {
    const tr = base.consumptionFor('trousers', 'woven');
    expect(tr.consumption_m.default).toBeGreaterThan(
      base.consumptionFor('skirt', 'woven').consumption_m.default,
    );
    // Детали брюк длинные и прямые: в раскладке они ложатся плотнее.
    expect(tr.marker_waste_percent.default).toBeLessThan(
      base.consumptionFor('dress', 'woven').marker_waste_percent.default,
    );
  });
});
