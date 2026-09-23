import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { TRACE_MODES, traceSketch } from '../src/index.js';

/** PNG с чёрной рамкой и одной серой линией на белом — без внешних файлов. */
function png(width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const edge = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;
      const grey = y === Math.floor(height / 2) && x > 10 && x < width - 10;
      if (edge) row.fill(0, 1 + x * 3, 4 + x * 3);
      else if (grey) row.fill(150, 1 + x * 3, 4 + x * 3);
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

describe('трассировка эскиза в SVG', () => {
  const image = png(120, 80);

  it('даёт SVG с viewBox по размеру растра и путём заливки', async () => {
    const r = await traceSketch(image, 'smart');
    expect(r.svg).toContain('viewBox="0 0 120 80"');
    expect(r.svg).toMatch(/<path[^>]*d="M/);
    expect(r.svg).toContain('fill="#0E0E0E"');
    expect(r.svg).toContain('data-trace="smart"');
  });

  it('режимы отличаются: «чистая» отбрасывает светлую линию, «детальная» её держит', async () => {
    const clean = await traceSketch(image, 'clean');
    const detailed = await traceSketch(image, 'detailed');
    expect(detailed.svg.length).toBeGreaterThan(clean.svg.length);
  });

  it('воспроизводимо: один растр — один и тот же SVG', async () => {
    const a = await traceSketch(image, 'smart');
    const b = await traceSketch(image, 'smart');
    expect(a.svg).toBe(b.svg);
    expect(TRACE_MODES).toHaveLength(3);
  });
});
