import { describe, expect, it } from 'vitest';
import {
  EDIT_PRESETS,
  editsDataUri,
  editsToSvg,
  flattenStroke,
  parseSketchEdits,
  presetSwatchSvg,
  strokeSvg,
  type EditStroke,
  type SketchEdits,
} from '../src/index.js';

const SHEET = { w: 1000, h: 500 };
const line = (over: Partial<EditStroke> = {}): EditStroke => ({
  id: 's1',
  kind: 'line',
  preset: 'seam',
  width: 4,
  points: [
    { x: 0.1, y: 0.5 },
    { x: 0.9, y: 0.5 },
  ],
  ...over,
});
const edits = (...strokes: EditStroke[]): SketchEdits => ({ version: 1, sheet: SHEET, strokes });
const paths = (svg: string): number => (svg.match(/<path /g) ?? []).length;

describe('слой правок — разбор', () => {
  it('принимает свой же формат и округляет координаты', () => {
    const e = parseSketchEdits(
      edits(
        line({
          points: [
            { x: 0.123456, y: 0.5 },
            { x: 0.9, y: 0.5 },
          ],
        }),
      ),
    );
    expect(e.strokes[0]!.points[0]!.x).toBe(0.1235);
  });

  it('отказывает словами: неизвестный тип строчки, толщина вне диапазона, точка вне листа', () => {
    expect(() => parseSketchEdits(edits(line({ preset: 'satin' as never })))).toThrow(
      /неизвестный тип строчки/,
    );
    expect(() => parseSketchEdits(edits(line({ width: 80 })))).toThrow(/толщина/);
    expect(() =>
      parseSketchEdits(
        edits(
          line({
            points: [
              { x: 3, y: 0.5 },
              { x: 0.9, y: 0.5 },
            ],
          }),
        ),
      ),
    ).toThrow(/вне листа/);
    expect(() => parseSketchEdits({ version: 2 })).toThrow(/версия/);
  });

  it('повтор идентификатора штриха — отказ: по идентификатору правки ищут и удаляют', () => {
    expect(() => parseSketchEdits(edits(line(), line()))).toThrow(/повтор/);
  });
});

describe('слой правок — отрисовка', () => {
  it('сплошная линия — один путь чернилами, ластик — белый путь', () => {
    expect(paths(strokeSvg(line(), SHEET))).toBe(1);
    expect(strokeSvg(line(), SHEET)).toContain('stroke="#0E0E0E"');
    expect(strokeSvg(line({ kind: 'erase' }), SHEET)).toContain('stroke="#FFFFFF"');
  });

  it('отстрочка — пунктир, двухигольная и распошив — параллельные рельсы', () => {
    expect(strokeSvg(line({ preset: 'lockstitch' }), SHEET)).toContain('stroke-dasharray="12 8"');
    expect(paths(strokeSvg(line({ preset: 'twin' }), SHEET))).toBe(2);
    expect(paths(strokeSvg(line({ preset: 'coverstitch' }), SHEET))).toBe(3);
  });

  it('зигзаг ломается поперёк хода, а не тянется прямой', () => {
    const svg = strokeSvg(line({ preset: 'zigzag' }), SHEET);
    const ys = [...svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
  });

  it('кривая — настоящая Q в пути, а не ломаная', () => {
    const curved = line({
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5, cx: 0.5, cy: 0.1 },
      ],
    });
    expect(strokeSvg(curved, SHEET)).toContain('Q500 50 900 250');
    expect(flattenStroke(curved, SHEET).length).toBe(17);
  });

  it('вырезка вида — тот же слой с окном по границам вида, координаты не пересчитываются', () => {
    const svg = editsToSvg(edits(line()), { box: { x0: 0.25, y0: 0, x1: 0.5, y1: 1 } });
    expect(svg).toContain('viewBox="250 0 250 500"');
    expect(svg).toContain('M100 250L900 250');
  });

  it('ластик рисуется под линиями: проведённое поверх стёртого остаётся видно', () => {
    const svg = editsToSvg(edits(line({ id: 'a' }), line({ id: 'b', kind: 'erase' })));
    expect(svg.indexOf('#FFFFFF')).toBeLessThan(svg.indexOf('#0E0E0E'));
  });

  it('data-URI годится в CSS-фон, у каждого пресета есть образец', () => {
    // Без «;»: рантайм кабинета режет инлайн-стиль по точке с запятой.
    const uri = editsDataUri(edits(line()));
    expect(uri).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    expect(uri).not.toContain(';');
    for (const p of EDIT_PRESETS) expect(presetSwatchSvg(p.id)).toContain('<path ');
  });
});
