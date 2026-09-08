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
