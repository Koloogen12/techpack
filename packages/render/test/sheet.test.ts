import { describe, expect, it } from 'vitest';
import { sheetBoxes } from '../src/index.js';

/** Белый лист с чёрными прямоугольниками: [x0, x1] × [y0, y1] в пикселях. */
function sheet(width: number, height: number, blocks: [number, number, number, number][]) {
  const luma = new Uint8Array(width * height).fill(255);
  for (const [x0, x1, y0, y1] of blocks)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) luma[y * width + x] = 0;
  return { width, height, luma };
}

describe('разрезка листа эскиза на виды', () => {
  it('три полосы линий — перед, профиль и спинка слева направо', () => {
    const boxes = sheetBoxes(
      sheet(300, 100, [
        [20, 100, 10, 90],
        [130, 160, 20, 80],
        [190, 280, 10, 90],
      ]),
    );
    expect(boxes?.map((b) => b.view)).toEqual(['front', 'side', 'back']);
    // Границы — доли листа с полем 2 %: срез не касается линий.
    expect(boxes![0]!.x0).toBeCloseTo(20 / 300 - 0.02, 3);
    expect(boxes![0]!.x1).toBeCloseTo(101 / 300 + 0.02, 3);
    expect(boxes![1]!.y0).toBeCloseTo(20 / 100 - 0.02, 3);
    expect(boxes![2]!.x1).toBeLessThanOrEqual(1);
  });

  it('две полосы — перед и спинка: профиля модель могла не нарисовать', () => {
    const boxes = sheetBoxes(
      sheet(300, 100, [
        [20, 120, 10, 90],
        [180, 280, 10, 90],
      ]),
    );
    expect(boxes?.map((b) => b.view)).toEqual(['front', 'back']);
  });

  it('одна полоса или пустой лист — не режется: угадывать хуже, чем не резать', () => {
    expect(sheetBoxes(sheet(300, 100, [[20, 280, 10, 90]]))).toBeNull();
    expect(sheetBoxes(sheet(300, 100, []))).toBeNull();
  });

  it('разрыв линии внутри вида не делит его, а пылинка между видами не становится видом', () => {
    const boxes = sheetBoxes(
      sheet(300, 100, [
        [20, 60, 10, 90],
        [63, 100, 10, 90], // просвет 2 px — разрыв линии, тот же вид
        [115, 115, 40, 60], // одиночная колонка — шум
        [130, 160, 20, 80],
        [190, 280, 10, 90],
      ]),
    );
    expect(boxes?.map((b) => b.view)).toEqual(['front', 'side', 'back']);
    expect(boxes![0]!.x1).toBeCloseTo(101 / 300 + 0.02, 3);
  });

  it('поля не выходят за лист', () => {
    const boxes = sheetBoxes(
      sheet(300, 100, [
        [0, 90, 0, 99],
        [120, 160, 0, 99],
        [200, 299, 0, 99],
      ]),
    );
    for (const b of boxes!) {
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(1);
      expect(b.y1).toBeLessThanOrEqual(1);
    }
  });
});

import { garmentMask } from '../src/index.js';

/** Белый лист с чёрными прямоугольными контурами толщиной 2 px. */
function outlined(width: number, height: number, rects: [number, number, number, number][]) {
  const luma = new Uint8Array(width * height).fill(255);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) luma[y * width + x] = 0;
  };
  for (const [x0, y0, x1, y1] of rects) {
    for (let x = x0; x <= x1; x++) for (const y of [y0, y0 + 1, y1 - 1, y1]) set(x, y);
    for (let y = y0; y <= y1; y++) for (const x of [x0, x0 + 1, x1 - 1, x1]) set(x, y);
  }
  return { width, height, luma };
}

describe('маска изделия на вырезке', () => {
  const at = (m: Uint8Array, w: number, x: number, y: number): number => m[y * w + x]!;

  it('внутри контура — вещь, снаружи — бумага, линии — вещь', () => {
    const px = outlined(100, 100, [[20, 20, 80, 80]]);
    const { mask, bbox, coverage } = garmentMask(px);
    expect(at(mask, 100, 50, 50)).toBe(1);
    expect(at(mask, 100, 5, 5)).toBe(0);
    expect(at(mask, 100, 20, 50)).toBe(1);
    expect(bbox).toEqual({ x0: 20, y0: 20, x1: 80, y1: 80 });
    expect(coverage).toBeCloseTo((61 * 61) / 10000, 2);
  });

  it('замкнутое окно внутри вещи — тоже вещь: внутренняя сторона капюшона той же ткани', () => {
    const px = outlined(100, 100, [
      [10, 10, 90, 90],
      [40, 40, 60, 60],
    ]);
    expect(at(garmentMask(px).mask, 100, 50, 50)).toBe(1);
  });

  it('разрыв контура до двух пикселей заливку внутрь не пускает', () => {
    const px = outlined(100, 100, [[20, 20, 80, 80]]);
    for (const y of [20, 21]) for (const x of [49, 50]) px.luma[y * 100 + x] = 255;
    expect(at(garmentMask(px).mask, 100, 50, 50)).toBe(1);
  });

  it('у контура нет окрашенной каймы снаружи', () => {
    const px = outlined(100, 100, [[20, 20, 80, 80]]);
    const { mask } = garmentMask(px);
    expect(at(mask, 100, 19, 50)).toBe(0);
    expect(at(mask, 100, 50, 19)).toBe(0);
  });

  it('пустой лист — маски нет', () => {
    const px = { width: 50, height: 50, luma: new Uint8Array(2500).fill(255) };
    expect(garmentMask(px).bbox).toBeNull();
  });
});
