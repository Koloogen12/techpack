import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { measurementsFrom, renderFlatsFromSpec, zipPathOf } from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'zip-path',
  name: 'Джемпер',
  article: 'ZP-001',
  category: 'sweater',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-23T00:00:00.000Z'),
  visible_elements: [
    { key: 'closure_type', value: 'диагональная молния от горловины к боку', confidence: 'high' },
  ],
};

/**
 * Схема по табелю знает только «молния втачана»; куда она идёт, видно на
 * снимке. Признак «asymmetric» переводит линию молнии в диагональ от горловины
 * к боковому шву; без признака молния идёт по центру переда.
 */
describe('ход молнии на схеме по табелю', () => {
  const asym = buildStyleSpec({
    ...INPUT,
    design_features: [
      {
        zone: 'closure',
        ru: 'асимметричная молния',
        en: 'asymmetric exposed zipper from left neckline diagonally to right side seam',
        confidence: 'high',
      },
    ],
  }).spec;
  const centered = buildStyleSpec(INPUT).spec;

  it('признак читается из дизайн-признаков', () => {
    expect(zipPathOf(asym)).toBe('asymmetric');
    expect(zipPathOf(centered)).toBe('center');
  });

  it('свитер с молнией без ширины планки в табеле всё равно рисует молнию', () => {
    const m = measurementsFrom(centered);
    expect(m.zipPlacketWidth).toBe(2.5);
    const front = renderFlatsFromSpec(centered).front.svg;
    expect(front).toContain('data-line="zip_line"');
  });

  it('асимметричная молния идёт по диагонали, а не по центру', () => {
    const zipLine = (svg: string): [number, number, number, number] => {
      const at = svg.indexOf('data-line="zip_line"');
      expect(at).toBeGreaterThan(0);
      const d = /d="M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)"/.exec(svg.slice(at));
      expect(d).not.toBeNull();
      return [Number(d![1]), Number(d![2]), Number(d![3]), Number(d![4])];
    };
    // Координаты в системе листа: центр переда там, где стоит молния по центру.
    const [cf, , cf2] = zipLine(renderFlatsFromSpec(centered).front.svg);
    expect(cf).toBeCloseTo(cf2, 3);
    const [ax0, , ax1] = zipLine(renderFlatsFromSpec(asym).front.svg);
    expect(ax0).toBeLessThan(cf);
    expect(ax1).toBeGreaterThan(cf + 10);
    // Диагональ рисуется один раз: зеркало дало бы крест.
    const asymSvg = renderFlatsFromSpec(asym).front.svg;
    expect(asymSvg.split('data-line="zip_line"').length - 1).toBe(1);
    expect(renderFlatsFromSpec(centered).front.svg.split('data-line="zip_line"').length - 1).toBe(
      2,
    );
  });
});
