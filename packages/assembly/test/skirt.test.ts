import { describe, expect, it } from 'vitest';
import { CATEGORY_CLASS, kb } from '@seamster/kb';
import { buildStyleSpec, type StyleSpecInput } from '../src/index.js';

const base = kb();
const INPUT: StyleSpecInput = {
  id: 'skirt',
  name: 'Юбка прямая',
  article: 'SK-001',
  category: 'skirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'woven',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-10T00:00:00.000Z'),
};

/**
 * Юбка — первое изделие низа, и первое, у которого сменилась опорная
 * величина: юбку держат бёдра, а не грудь. Пока якорь считался от груди,
 * низ нельзя было завести вовсе — вещь вышла бы не того размера.
 */
describe('юбка: первый низ', () => {
  it('это низ, и построитель чертежа его не берёт', () => {
    expect(CATEGORY_CLASS.skirt).toBe('bottom');
  });

  it('якорь масштаба — ширина по бёдрам, а не по груди', () => {
    const template = base.pomTemplate('skirt', 'woven');
    const anchor = template.points.find((p) => p.derivation === 'anchor')!;
    expect(anchor.code).toBe('B05');
    expect(anchor.name_ru).toContain('бёдрам');
  });

  it('масштаб считается от обхвата бёдер размерной сетки плюс прибавка', () => {
    // RU 46: бёдра 98 см, прибавка полуприлегающей юбки 4 см → (98+4)/2 = 51.
    const { spec } = buildStyleSpec(INPUT);
    const hip = spec.measurements.points.find((p) => p.code === 'B05')!;
    expect(hip.base.value).toBe(51);
  });

  it('талия уже бёдер — иначе юбка не сядет', () => {
    const { spec } = buildStyleSpec(INPUT);
    const v = (c: string) => spec.measurements.points.find((p) => p.code === c)!.base.value;
    expect(v('B01')).toBeLessThan(v('B05'));
    expect(v('B04')).toBeLessThan(v('B05'));
  });

  it('длина следует за ростом, а не за размером', () => {
    const short = buildStyleSpec({ ...INPUT, base_height_cm: 158 }).spec;
    const tall = buildStyleSpec({ ...INPUT, base_height_cm: 182 }).spec;
    const len = (s: typeof short) =>
      s.measurements.points.find((p) => p.code === 'J01')!.base.value;
    expect(len(tall)).toBeGreaterThan(len(short));
  });

  it('ширина растёт с размером, длина от размера не зависит', () => {
    const s44 = buildStyleSpec({ ...INPUT, base_size_ru: 44 }).spec;
    const s48 = buildStyleSpec({ ...INPUT, base_size_ru: 48 }).spec;
    const at = (s: typeof s44, c: string) =>
      s.measurements.points.find((p) => p.code === c)!.base.value;
    expect(at(s48, 'B05')).toBeGreaterThan(at(s44, 'B05'));
    expect(at(s48, 'J01')).toBe(at(s44, 'J01'));
  });

  it('собирается на поясе, вытачках, потайной молнии и шлице', () => {
    const nodes = base.categoryDefaultsFor('skirt', 'woven').default_nodes;
    for (const id of ['waistband_set_in', 'dart_skirt', 'invisible_zip_back', 'vent_back'])
      expect(nodes, id).toContain(id);
    // Ничего от верха: ни проймы, ни горловины, ни рукава.
    for (const id of ['sleeve_set_in_woven', 'neck_facing', 'shoulder_seam_plain'])
      expect(nodes, id).not.toContain(id);
  });

  it('каждый узел применим к юбке', () => {
    for (const id of base.categoryDefaultsFor('skirt', 'woven').default_nodes)
      expect(base.node(id).applies_to, id).toContain('skirt');
  });

  it('закрепка шлицы требует машины вне базового цеха и знает замену', () => {
    const node = base.node('vent_bartack');
    expect(node.requires_special_equipment).toBe(true);
    expect(base.checkMachinePark(node, 'base_shop').alternative).not.toBeNull();
  });

  it('прибавка задана к бёдрам и не уходит в минус', () => {
    expect(base.easeFor('skirt', 'fitted', 'woven').entry.min).toBeGreaterThanOrEqual(0);
    expect(base.easeFor('skirt', 'oversize', 'woven').entry.default).toBeGreaterThan(
      base.easeFor('skirt', 'fitted', 'woven').entry.default,
    );
  });

  it('расход меньше платьевого: деталей мало и они прямые', () => {
    expect(base.consumptionFor('skirt', 'woven').consumption_m.default).toBeLessThan(
      base.consumptionFor('dress', 'woven').consumption_m.default,
    );
  });
});
