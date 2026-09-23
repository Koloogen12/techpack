import { describe, expect, it } from 'vitest';
import type { Observations } from '@seamster/core';
import { buildStyleSpec, planFromObservations, type StyleSpecInput } from '../src/index.js';
import { kb } from '@seamster/kb';

/**
 * Наблюдения по словарям выбирают узлы детерминированно.
 *
 * Свободный текст взгляда («узкая бейка-риб, вырез невысокий») ловился
 * регулярками и промахивался на «невысокий». Словарь не промахивается:
 * одно значение — одно правило — один узел.
 */
const INPUT: StyleSpecInput = {
  id: 'obs-test',
  name: 'Свитер',
  article: 'OBS-001',
  category: 'sweater',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-24T00:00:00.000Z'),
};

const o = <T extends string>(value: T, confidence: 'high' | 'medium' | 'low' = 'high') => ({
  value,
  confidence,
});

/** Типовой свитер: всё как в категории. */
const PLAIN: Observations = {
  neckline: o('crew_rib_band'),
  closure: o('none'),
  cuff: o('rib_band'),
  hem: o('rib_band'),
  pocket: o('none'),
  sleeve: o('set_in'),
  sleeve_length: o('long'),
  hood: o('no'),
};

describe('узлы по словарям наблюдений', () => {
  it('джемпер с диагональной молнией: окантовка вместо бейки, молния добавлена, низ подшит', () => {
    const { spec, notes } = buildStyleSpec({
      ...INPUT,
      observations: {
        ...PLAIN,
        neckline: o('v_notch_zip'),
        closure: o('zip_asymmetric'),
        cuff: o('turned_hem'),
        hem: o('turned_hem'),
      },
    });
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids).toContain('neck_binding');
    expect(ids).not.toContain('neck_rib_band');
    expect(ids).toContain('zip_set_in');
    expect(ids).toContain('sleeve_hem_coverstitch');
    expect(ids).toContain('hem_coverstitch');
    expect(ids).not.toContain('cuff_rib');
    expect(ids).not.toContain('waistband_rib');
    // Молния — как у донора: после плечевых швов, до рукавов; нумерация сплошная.
    const ops = spec.construction!.sequence;
    const zipAt = ops.findIndex((op) => op.node_id === 'zip_set_in');
    const shoulderAt = ops.findIndex((op) => op.node_id === 'shoulder_seam_overlock');
    const sleeveAt = ops.findIndex((op) => op.node_id === 'sleeve_set_in');
    expect(zipAt).toBeGreaterThan(shoulderAt);
    expect(zipAt).toBeLessThan(sleeveAt);
    expect(ops.map((op) => op.step)).toEqual(ops.map((_, i) => i + 1));
    // Фурнитура и табель идут за узлами.
    expect(spec.bom!.lines.map((l) => l.material_id)).toContain('zipper_separating');
    const codes = spec.measurements.points.map((p) => p.code);
    expect(codes).not.toContain('H07');
    expect(codes).not.toContain('H08');
    expect(spec.measurements.points.find((p) => p.code === 'T17')!.base.value).toBeLessThanOrEqual(
      1.5,
    );
    expect(notes.join('\n')).toMatch(/окантовк/);
    expect(notes.join('\n')).toMatch(/молни/);
  });

  it('типовые наблюдения ничего не меняют', () => {
    const a = buildStyleSpec({ ...INPUT, observations: PLAIN }).spec;
    const b = buildStyleSpec(INPUT).spec;
    expect(a.construction!.nodes.map((n) => n.node_id)).toEqual(
      b.construction!.nodes.map((n) => n.node_id),
    );
  });

  it('словарь сильнее свободного текста: «невысокий» больше не ловится как «высокий»', () => {
    const { spec } = buildStyleSpec({
      ...INPUT,
      visible_elements: [{ key: 'neckline_type', value: 'высокая стойка', confidence: 'high' }],
      observations: { ...PLAIN, neckline: o('crew_binding') },
    });
    expect(spec.construction!.nodes.map((n) => n.node_id)).toContain('neck_binding');
  });

  it('неуверенное или невидимое наблюдение оставляет типовой узел', () => {
    for (const neckline of [o('v_neck', 'low'), o('not_visible')]) {
      const { spec } = buildStyleSpec({ ...INPUT, observations: { ...PLAIN, neckline } });
      expect(spec.construction!.nodes.map((n) => n.node_id)).toContain('neck_rib_band');
    }
  });

  it('стойка по словарю поднимает высоту бейки', () => {
    const { spec } = buildStyleSpec({
      ...INPUT,
      observations: { ...PLAIN, neckline: o('mock_neck') },
    });
    expect(spec.measurements.points.find((p) => p.code === 'T17')!.base.value).toBe(5);
  });

  it('худи без капюшона и без кармана: узлы уходят вместе с точками табеля', () => {
    const { spec, notes } = buildStyleSpec({
      ...INPUT,
      category: 'hoodie',
      fit_intent: 'oversize',
      observations: { ...PLAIN, neckline: o('crew_rib_band'), hood: o('no'), pocket: o('none') },
    });
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids.some((id) => id.startsWith('hood_'))).toBe(false);
    expect(ids).not.toContain('kangaroo_pocket');
    expect(ids).not.toContain('pocket_bartack');
    const codes = spec.measurements.points.map((p) => p.code);
    for (const gone of ['H01', 'H02', 'H03', 'H04', 'H05', 'H06'])
      expect(codes).not.toContain(gone);
    expect(spec.bom!.lines.map((l) => l.material_id)).not.toContain('drawcord');
    expect(notes.join('\n')).toMatch(/капюшон/);
  });

  it('свитшот с карманом кенгуру и пуговицами: узлы добавляются на свои места', () => {
    const { spec } = buildStyleSpec({
      ...INPUT,
      category: 'sweatshirt',
      observations: { ...PLAIN, pocket: o('kangaroo'), closure: o('buttons_partial') },
    });
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids).toContain('kangaroo_pocket');
    const ops = spec.construction!.sequence;
    const pocketAt = ops.findIndex((op) => op.node_id === 'kangaroo_pocket');
    const sideAt = ops.findIndex((op) => op.node_id === 'side_sleeve_seam');
    expect(pocketAt).toBeGreaterThan(-1);
    expect(pocketAt).toBeLessThan(sideAt);
    expect(ops.map((op) => op.step)).toEqual(ops.map((_, i) => i + 1));
  });

  it('план без категории-донора честно молчит', () => {
    const plan = planFromObservations(
      { ...PLAIN, pocket: o('welt') },
      'tshirt',
      'knit',
      ['neck_rib_band', 'hem_coverstitch'],
      kb(),
    );
    expect(plan.add).toEqual([]);
    expect(plan.notes.join('\n')).toMatch(/нет/);
  });
});
