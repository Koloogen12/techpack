import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { garmentGeometry } from '../src/placement.js';
import {
  fromDrawing,
  pomCodesWithPlace,
  pomDrawingDocument,
  pomDrawingSvg,
  pomGrid,
  pomLines,
  toDrawing,
} from '../src/pom-drawing.js';

/**
 * Чертёж замеров: линии точек табеля на рисунке вещи.
 *
 * Вид — картинка 600×800 с изделием в габарите 40..560 × 30..770; масштаб
 * назначается по длине изделия из табеля, как у раскладки нанесения.
 */
const INPUT: StyleSpecInput = {
  id: 'pom-drawing-test',
  name: 'Свитер',
  article: 'PD-001',
  category: 'sweater',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-23T00:00:00.000Z'),
};

const IMAGE = { w: 600, h: 800 };
const BOX = { x0: 40, y0: 30, x1: 560, y1: 770 };

describe('чертёж замеров', () => {
  const spec = buildStyleSpec(INPUT).spec;
  const g = garmentGeometry(spec, BOX, 'front')!;
  const value = (code: string) => spec.measurements.points.find((p) => p.code === code)!.base.value;

  it('линии стоят по типовым местам: длина от плеча до низа, грудь под проймой, низ у края', () => {
    const lines = pomLines(spec, g, 'front');
    const by = new Map(lines.map((l) => [l.code, l]));
    const t01 = by.get('T01')!;
    expect(t01.pts[0]!.y).toBeCloseTo(g.hpsY, 3);
    expect(t01.pts[1]!.y).toBeCloseTo(g.hpsY + value('T01') * g.pxPerCm, 3);
    const t03 = by.get('T03')!;
    expect(t03.pts[1]!.x - t03.pts[0]!.x).toBeCloseTo(value('T03') * g.pxPerCm, 3);
    expect(t03.pts[0]!.y).toBeCloseTo(g.hpsY + (value('T09') + 1) * g.pxPerCm, 3);
    const t05 = by.get('T05')!;
    expect(t05.pts[0]!.y).toBeCloseTo(g.hpsY + (value('T01') - 1) * g.pxPerCm, 3);
    // Рукав по длине табеля: от плечевой точки до низа.
    const t10 = by.get('T10')!;
    const len = Math.hypot(t10.pts[1]!.x - t10.pts[0]!.x, t10.pts[1]!.y - t10.pts[0]!.y);
    expect(len / g.pxPerCm).toBeCloseTo(value('T10'), 3);
    // Ни одной линии с типовым местом не рисуется на спинке, кроме спинковых.
    const back = pomLines(spec, g, 'back').map((l) => l.code);
    expect(back).toEqual(expect.arrayContaining(['T02', 'T08', 'T16', 'T11']));
    expect(back).not.toContain('T03');
    expect(pomCodesWithPlace(spec, g, 'front')).toContain('T14');
  });

  it('заданное человеком место сильнее типового и переживает смену габарита', () => {
    const custom = {
      ...spec,
      measurements: {
        ...spec.measurements,
        points: spec.measurements.points.map((p) =>
          p.code === 'T03'
            ? {
                ...p,
                drawing: {
                  view: 'front' as const,
                  pts: [
                    { u: 0.1, v: 0.4 },
                    { u: 0.9, v: 0.4 },
                  ],
                  confirmed_at: '2026-09-23T10:00:00.000Z',
                },
              }
            : p,
        ),
      },
    };
    const line = pomLines(custom, g, 'front').find((l) => l.code === 'T03')!;
    expect(line.custom).toBe(true);
    expect(line.confirmed).toBe(true);
    expect(line.pts[0]).toEqual({ x: 40 + 0.1 * 520, y: 30 + 0.4 * 740 });
    // Другой габарит (лист перерисован) — те же доли, другие пиксели.
    const g2 = garmentGeometry(custom, { x0: 0, y0: 0, x1: 1000, y1: 1000 }, 'front')!;
    const line2 = pomLines(custom, g2, 'front').find((l) => l.code === 'T03')!;
    expect(line2.pts[1]).toEqual({ x: 900, y: 400 });
    // Туда и обратно.
    const back = toDrawing(fromDrawing([{ u: 0.25, v: 0.75 }], BOX), BOX);
    expect(back[0]).toEqual({ u: 0.25, v: 0.75 });
  });

  it('сетка проходит через середину переда и высшую точку плеча с шагом 5 или 10 см', () => {
    const grid = pomGrid(g, IMAGE);
    expect([5, 10]).toContain(grid.stepCm);
    expect(grid.xs.some((x) => Math.abs(x - g.cfX) < 1e-6)).toBe(true);
    expect(grid.ys.some((y) => Math.abs(y - g.hpsY) < 1e-6)).toBe(true);
    const step = grid.stepCm * g.pxPerCm;
    expect(grid.xs[1]! - grid.xs[0]!).toBeCloseTo(step, 6);
    expect(grid.xs[0]).toBeGreaterThanOrEqual(0);
    expect(grid.ys[grid.ys.length - 1]).toBeLessThanOrEqual(IMAGE.h);
  });

  it('слой SVG: сетка, линия каждой точки с кодом, выделенная — залитой подписью', () => {
    const lines = pomLines(spec, g, 'front');
    const svg = pomDrawingSvg(lines, pomGrid(g, IMAGE), IMAGE, { active: 'T03' });
    expect(svg).toContain(`viewBox="0 0 ${IMAGE.w} ${IMAGE.h}"`);
    expect(svg).toContain('data-grid=');
    for (const l of lines) expect(svg).toContain(`data-pom="${l.code}"`);
    expect(svg).toMatch(/data-pom-label="T03"[^>]*><rect[^>]*fill="#0E0E0E"/);
    expect(svg).toMatch(/data-pom-label="T05"[^>]*><rect[^>]*fill="#fff"/);
    const doc = pomDrawingDocument({ svgInner: '<path d="M0 0"/>' }, lines, null, IMAGE);
    expect(doc.startsWith('<svg')).toBe(true);
    expect(doc).toContain('data-picture="trace"');
    expect(doc).not.toContain('data-grid=');
  });

  it('воспроизводимо: одна спека — один чертёж', () => {
    const a = pomDrawingSvg(pomLines(spec, g, 'front'), pomGrid(g, IMAGE), IMAGE);
    const b = pomDrawingSvg(pomLines(spec, g, 'front'), pomGrid(g, IMAGE), IMAGE);
    expect(a).toBe(b);
  });
});
