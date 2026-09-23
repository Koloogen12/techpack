import { describe, expect, it } from 'vitest';
import { RIB_RELAXED_SHARE, buildStyleSpec, type StyleSpecInput } from '../src/index.js';

/**
 * Рубчик меряется в свободном состоянии: якорь из сетки для него уже.
 */
const INPUT: StyleSpecInput = {
  id: 'rib-test',
  name: 'Джемпер в рубчик',
  article: 'RIB-ANCHOR',
  category: 'sweater',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-24T00:00:00.000Z'),
};

describe('рубчик и масштаб', () => {
  it('ширина по груди для рубчика уже сетки на долю растяжения, и документ об этом говорит', () => {
    const plain = buildStyleSpec(INPUT);
    const rib = buildStyleSpec({ ...INPUT, fabric_class: 'rib_2x2', fabric_confidence: 'high' });
    const chest = (r: typeof plain) =>
      r.spec.measurements.points.find((p) => p.code === 'T03')!.base.value;
    expect(chest(rib)).toBeCloseTo(chest(plain) * (1 - RIB_RELAXED_SHARE), 0);
    expect(rib.notes.join('\n')).toMatch(/ГОСТ 4103/);
    expect(plain.notes.join('\n')).not.toMatch(/ГОСТ 4103/);
  });

  it('кулирка якорь не меняет', () => {
    const plain = buildStyleSpec(INPUT);
    const jersey = buildStyleSpec({
      ...INPUT,
      fabric_class: 'single_jersey',
      fabric_confidence: 'high',
    });
    const chest = (r: typeof plain) =>
      r.spec.measurements.points.find((p) => p.code === 'T03')!.base.value;
    expect(chest(jersey)).toBe(chest(plain));
  });
});
