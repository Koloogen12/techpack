import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import {
  garmentBoxFromLuma,
  garmentGeometry,
  imageViewOfZone,
  placementOverlaySvg,
  placementRect,
  rectToCm,
  viewOfZone,
} from '../src/placement.js';

const INPUT: StyleSpecInput = {
  id: 'placement-test',
  name: 'Худи',
  article: 'PL-001',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-23T00:00:00.000Z'),
  artwork: [
    { zone: 'chest_center', width_cm: 28, height_cm: 20, offset_cm: 10 },
    { zone: 'back_full', width_cm: 30, height_cm: 40, offset_cm: 12 },
    { zone: 'chest_left', width_cm: 9, height_cm: 9, offset_cm: 18, lateral_cm: 10 },
  ],
};

const { spec } = buildStyleSpec(INPUT);
/** Картинка 600×800, изделие занимает от y=100 до y=700, по x от 100 до 500. */
const BOX = { x0: 100, y0: 100, x1: 500, y1: 700 };

describe('геометрия макета на рисунке', () => {
  it('зона выбирает вид: спинка — на спинке, рукав рисуется на переде', () => {
    expect(viewOfZone('back_full')).toBe('back');
    expect(viewOfZone('sleeve')).toBe('sleeve');
    expect(viewOfZone('chest_center')).toBe('front');
    expect(imageViewOfZone('sleeve')).toBe('front');
  });

  it('масштаб — по длине изделия из табеля с поправкой на капюшон', () => {
    const g = garmentGeometry(spec, BOX, 'front')!;
    const t01 = spec.measurements.points.find((p) => p.code === 'T01')!.base.value;
    const h01 = spec.measurements.points.find((p) => p.code === 'H01')!.base.value;
    expect(g).not.toBeNull();
    expect(g.pxPerCm).toBeCloseTo(600 / (t01 + 0.6 * h01), 3);
    // Высшая точка плеча стоит ниже верха габарита ровно на капюшон.
    expect(g.hpsY).toBeCloseTo(100 + 0.6 * h01 * g.pxPerCm, 3);
    expect(g.cfX).toBe(300);
    expect(g.note_ru).toContain('капюшон');
  });

  it('рамка: отступ вниз от плеча, размер в сантиметрах, смещение по носке', () => {
    const g = garmentGeometry(spec, BOX, 'front')!;
    const chest = spec.artwork!.placements.find((a) => a.zone === 'chest_center')!;
    const r = placementRect(chest, g)!;
    expect(r.w).toBeCloseTo(28 * g.pxPerCm, 3);
    expect(r.h).toBeCloseTo(20 * g.pxPerCm, 3);
    expect(r.y).toBeCloseTo(g.hpsY + 10 * g.pxPerCm, 3);
    expect(r.x + r.w / 2).toBeCloseTo(g.cfX, 3);
    // Смещение влево по носке — вправо на виде спереди.
    const left = spec.artwork!.placements.find((a) => a.zone === 'chest_left')!;
    const rl = placementRect(left, g)!;
    expect(rl.x + rl.w / 2).toBeCloseTo(g.cfX + 10 * g.pxPerCm, 3);
    // Макет спинки на переде не рисуется.
    const back = spec.artwork!.placements.find((a) => a.zone === 'back_full')!;
    expect(placementRect(back, g)).toBeNull();
    expect(placementRect(back, garmentGeometry(spec, BOX, 'back')!)).not.toBeNull();
  });

  it('обратный ход: рамка в пикселях возвращает те же сантиметры с шагом 0,5', () => {
    const g = garmentGeometry(spec, BOX, 'front')!;
    const chest = spec.artwork!.placements.find((a) => a.zone === 'chest_center')!;
    const r = placementRect(chest, g)!;
    expect(rectToCm(r, g, 'chest_center')).toEqual({
      offset_cm: 10,
      lateral_cm: 0,
      width_cm: 28,
      height_cm: 20,
    });
    const back = spec.artwork!.placements.find((a) => a.zone === 'back_full')!;
    const gb = garmentGeometry(spec, BOX, 'back')!;
    expect(rectToCm(placementRect(back, gb)!, gb, 'back_full').offset_cm).toBe(12);
  });

  it('габарит по яркости: белые поля отбрасываются, узкая полоска — не изделие', () => {
    const w = 20;
    const h = 20;
    const luma = new Uint8Array(w * h).fill(255);
    for (let y = 4; y < 16; y++) for (let x = 6; x < 14; x++) luma[y * w + x] = 40;
    expect(garmentBoxFromLuma(luma, w, h)).toMatchObject({ x0: 6, y0: 4, x1: 13, y1: 15 });
    const thin = new Uint8Array(w * h).fill(255);
    for (let x = 0; x < w; x++) thin[10 * w + x] = 0;
    expect(garmentBoxFromLuma(thin, w, h)).toBeNull();
  });

  it('оверлей — SVG с рамкой и буквой на каждую рамку', () => {
    const svg = placementOverlaySvg([{ letter: '1', rect: { x: 10, y: 20, w: 30, h: 40 } }], {
      w: 600,
      h: 800,
    });
    expect(svg).toContain('viewBox="0 0 600 800"');
    expect(svg).toContain('<rect x="10" y="20" width="30" height="40"');
    expect(svg).toContain('>1</text>');
  });

  it('без длины изделия геометрии нет', () => {
    const noLength = {
      ...spec,
      measurements: {
        ...spec.measurements,
        points: spec.measurements.points.filter((p) => p.code !== 'T01'),
      },
    };
    expect(garmentGeometry(noLength as typeof spec, BOX, 'front')).toBeNull();
  });
});
