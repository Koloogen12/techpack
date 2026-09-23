import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { otsu, simplify, thin, traceStrokes } from '../src/strokes.js';

/**
 * Трассировка по осевым линиям: толстая рамка → контур, тонкая линия →
 * внутренняя, цепочка коротких штрихов → пунктир. Всё на синтетическом PNG.
 */
function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => number | null,
): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const v = paint(x, y);
      if (v !== null) row.fill(v, 1 + x * 3, 4 + x * 3);
    }
    rows.push(row);
  }
  const crc = (buf: Buffer): number => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('трассировка по осевым линиям', () => {
  // 400×300: рамка толщиной 6 px, горизонтальная линия толщиной 2 px,
  // пунктир из штрихов по 8 px через 6 px.
  const image = png(400, 300, (x, y) => {
    const frame =
      (x >= 20 && x < 380 && y >= 20 && y < 280 && (x < 26 || x >= 374 || y < 26 || y >= 274)) ||
      false;
    if (frame) return 0;
    if (y >= 150 && y < 152 && x > 40 && x < 360) return 0;
    if (y >= 220 && y < 222 && x > 40 && x < 360 && (x - 40) % 14 < 8) return 0;
    return null;
  });

  it('слои: толстая рамка — контур, тонкая линия — внутренняя, штрихи — пунктир', async () => {
    const r = await traceStrokes(image);
    expect(r.width).toBe(400);
    expect(r.layers.outline).toBeGreaterThanOrEqual(1);
    expect(r.layers.inner).toBeGreaterThanOrEqual(1);
    expect(r.layers.stitch).toBeGreaterThanOrEqual(1);
    expect(r.svg).toContain('data-layer="outline"');
    expect(r.svg).toContain('stroke-dasharray');
    expect(r.svg).toContain('fill="none"');
    // Штрихи, а не заливка: ни одного fill с цветом.
    expect(r.svg).not.toMatch(/fill="#0E0E0E"/);
  });

  it('утончение оставляет однопиксельную линию, упрощение — две точки на отрезке', () => {
    const w = 40;
    const h = 20;
    const ink = new Uint8Array(w * h);
    for (let y = 8; y < 12; y++) for (let x = 5; x < 35; x++) ink[y * w + x] = 1;
    const skel = thin(ink, w, h);
    let count = 0;
    for (const v of skel) count += v;
    expect(count).toBeLessThanOrEqual(32);
    expect(count).toBeGreaterThanOrEqual(26);
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 10 + (i % 2 ? 0.2 : 0) }));
    expect(simplify(pts, 0.5)).toHaveLength(2);
  });

  it('порог Оцу держится в разумных границах для линейного рисунка', () => {
    const luma = new Uint8Array(1000).fill(250);
    for (let i = 0; i < 40; i++) luma[i] = 10;
    const t = otsu(luma);
    expect(t).toBeGreaterThanOrEqual(90);
    expect(t).toBeLessThanOrEqual(200);
  });

  it('воспроизводимо', async () => {
    const a = await traceStrokes(image);
    const b = await traceStrokes(image);
    expect(a.svg).toBe(b.svg);
  });
});
