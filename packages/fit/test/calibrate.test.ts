import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { calibrateSpec } from '../src/calibrate.js';

/**
 * Масштаб по одному замеру на образце.
 *
 * Табель по фото — пропорции, умноженные на якорь из сетки. Человек меряет
 * одну точку, и все точки от якоря идут за ней одним множителем; точки от
 * роста и составные считаются заново из слагаемых.
 */
const INPUT: StyleSpecInput = {
  id: 'calib-test',
  name: 'Свитер',
  article: 'CAL-001',
  category: 'sweater',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-24T00:00:00.000Z'),
  // Как в живом прогоне: длина, талия, низ и рукав — отношением к груди с фото.
  photo_ratios: {
    T01: { ratio: 1.7, confidence: 'high' },
    T04: { ratio: 0.94, confidence: 'high' },
    T05: { ratio: 0.9, confidence: 'high' },
    T12: { ratio: 0.36, confidence: 'high' },
  },
};

describe('калибровка масштаба по замеру', () => {
  const spec = buildStyleSpec(INPUT).spec;
  const value = (s: typeof spec, code: string) =>
    s.measurements.points.find((p) => p.code === code)!.base;

  it('замер длины пересчитывает грудь и всё от якоря одним множителем', () => {
    const before = value(spec, 'T01').value;
    const r = calibrateSpec(spec, 'T01', before * 0.8);
    expect(r.rejected).toBeUndefined();
    expect(r.factor).toBeCloseTo(0.8, 3);
    expect(value(r.spec, 'T01').value).toBeCloseTo(before * 0.8, 1);
    expect(value(r.spec, 'T01').confidence).toBe('measured_by_scale');
    expect(value(r.spec, 'T03').value).toBeCloseTo(value(spec, 'T03').value * 0.8, 1);
    expect(value(r.spec, 'T03').note).toMatch(/по замеру T01/);
    expect(r.rescaled).toContain('T03');
    // Градация едет вместе с базой.
    const g = r.spec.measurements.points.find((p) => p.code === 'T03')!.graded[0]!;
    const g0 = spec.measurements.points.find((p) => p.code === 'T03')!.graded[0]!;
    expect(g.value.value).toBeCloseTo(g0.value.value * 0.8, 1);
  });

  it('точки от роста не трогаются, составные считаются из слагаемых', () => {
    const r = calibrateSpec(spec, 'T03', value(spec, 'T03').value * 1.25);
    expect(r.rejected).toBeUndefined();
    // T11 (рукав от центра спинки) — составная: половина ширины плеч + рукав.
    const t11 = r.spec.measurements.points.find((p) => p.code === 'T11');
    if (t11) {
      const t06 = value(r.spec, 'T06').value;
      const t10 = value(r.spec, 'T10').value;
      expect(Math.abs(t11.base.value - (t06 / 2 + t10))).toBeLessThan(0.2);
    }
  });

  it('отказывает честно: чужая точка, составная точка, совпадающий замер', () => {
    expect(calibrateSpec(spec, 'X99', 10).rejected).toMatch(/нет/);
    expect(calibrateSpec(spec, 'T11', 90).rejected).toMatch(/не связана|от роста/);
    expect(calibrateSpec(spec, 'T01', value(spec, 'T01').value).rejected).toMatch(/совпадает/);
    expect(calibrateSpec(spec, 'T01', -5).rejected).toMatch(/пределов/);
  });

  it('воспроизводимо и не трогает остальное', () => {
    const a = calibrateSpec(spec, 'T01', 60).spec;
    const b = calibrateSpec(spec, 'T01', 60).spec;
    expect(a).toEqual(b);
    expect(a.construction).toEqual(spec.construction);
    expect(a.bom).toEqual(spec.bom);
  });
});
