import { describe, expect, it } from 'vitest';
import { lineArt, splitViews } from '../src/normalize.js';
import { pathBox, readPaths, splitSubpaths } from '../src/svg.js';
import { matchTemplates, scoreTemplate, type MatchQuery } from '../src/match.js';
import { MAX_PROPORTION_DRIFT, renderLibraryView } from '../src/library.js';
import type { TemplateEntry, TemplateTraits } from '../src/manifest.js';

const traits = (over: Partial<TemplateTraits> = {}): TemplateTraits => ({
  category: 'hoodie',
  category_other: null,
  fit: 'oversize',
  hood: true,
  closure: 'none',
  pocket: 'kangaroo',
  sleeve: 'long',
  ribbed: true,
  features: [],
  confidence: 'high',
  ...over,
});

const entry = (id: string, over: Partial<TemplateEntry> = {}): TemplateEntry => ({
  id,
  group: 'hoodie_family',
  source_file: `Hoodies/SVG/${id}.svg`,
  svg_front: `packages/kb/data/templates/hoodie_family/${id}-front.svg`,
  svg_back: null,
  preview: null,
  aspect: 1.2,
  paths_front: 40,
  paths_back: 0,
  notes: [],
  traits: traits(),
  ...over,
});

const query: MatchQuery = {
  category: 'hoodie',
  fit: 'oversize',
  hood: true,
  closure: 'none',
  pocket: 'kangaroo',
  sleeve: 'long',
  ribbed: true,
};

describe('разбор путей', () => {
  it('относительные команды считает смещениями, а не координатами', () => {
    // Наивный разбор «числа парами» превратил бы −8.6 в координату и
    // растянул бы габарит от начала листа — виды перестали бы делиться.
    const box = pathBox('M 100 100 l -8.6 0 l 0 20 z');
    expect(box).not.toBeNull();
    expect(box!.minX).toBeCloseTo(91.4, 3);
    expect(box!.minY).toBeCloseTo(100, 3);
  });

  it('у дуги координатами считает только последнюю пару', () => {
    // Радиусы и флаги дуги не точки: принять их за координаты значило бы
    // притянуть габарит к нулю.
    const box = pathBox('M 200 200 a 5 5 0 0 1 10 10');
    expect(box!.minX).toBeCloseTo(200, 3);
    expect(box!.maxX).toBeCloseTo(210, 3);
  });

  it('повтор координат после moveto читает как линию', () => {
    const box = pathBox('M 10 10 20 40');
    expect(box!.maxX).toBeCloseTo(20, 3);
    expect(box!.maxY).toBeCloseTo(40, 3);
  });

  it('слитый путь разбирает на подпути с абсолютным началом', () => {
    // Illustrator кладёт перед и спинку в один <path>. Пока он неделим,
    // между видами нет просвета и делить нечем.
    const parts = splitSubpaths('M 10 10 l 10 0 l 0 10 z m 100 0 l 10 0 l 0 10 z');
    expect(parts).toHaveLength(2);
    // z вернул точку в начало подпути (10,10), поэтому относительный
    // moveto отсчитывается оттуда: 110, а не 120 от конца линии.
    expect(parts[1]!.startsWith('M 110 10')).toBe(true);
    expect(pathBox(parts[1]!)!.minX).toBeCloseTo(110, 3);
  });
});

describe('сплит видов', () => {
  const square = (x: number, y: number, w: number): { d: string; style: string } => ({
    d: `M ${x} ${y} l ${w} 0 l 0 ${w} l ${-w} 0 z`,
    style: 'fill:#C6C6C6',
  });

  it('делит лист по просвету между видами, а не пополам', () => {
    // Композиция сдвинута вправо: деление пополам разрезало бы силуэт.
    const svg =
      '<svg viewBox="0 0 1000 1000">' +
      [
        square(100, 100, 60),
        square(170, 100, 60),
        square(240, 100, 60),
        square(700, 100, 60),
        square(770, 100, 60),
        square(840, 100, 60),
      ]
        .map((p) => `<path style="${p.style}" d="${p.d}"/>`)
        .join('') +
      '</svg>';
    const { front, back } = splitViews(readPaths(svg));
    expect(front).toHaveLength(3);
    expect(back).toHaveLength(3);
  });

  it('не делит лист, когда просвета нет', () => {
    const svg =
      '<svg viewBox="0 0 1000 1000">' +
      Array.from({ length: 8 }, (_, i) => square(100 + i * 90, 100, 100))
        .map((p) => `<path style="${p.style}" d="${p.d}"/>`)
        .join('') +
      '</svg>';
    const { back } = splitViews(readPaths(svg));
    expect(back).toHaveLength(0);
  });
});

describe('line-art', () => {
  it('заливку мокапа превращает в контур', () => {
    // Серая заливка означала бы цвет изделия, которого мы не знаем.
    const style = lineArt('fill:#C6C6C6', 2);
    expect(style).toContain('fill:none');
    expect(style).toContain('stroke:#0E0E0E');
  });

  it('путь без заливки и без обводки выбрасывает', () => {
    expect(lineArt('fill:none', 2)).toBe('');
  });
});

describe('подбор силуэта', () => {
  it('чужую категорию не предлагает вовсе', () => {
    // Брюки масштабируются под худи технически безупречно — и именно
    // поэтому отказ должен быть явным.
    expect(scoreTemplate(entry('pants', { traits: traits({ category: null }) }), query)).toBeNull();
  });

  it('неразобранный шаблон в подбор не идёт', () => {
    expect(scoreTemplate(entry('raw', { traits: null }), query)).toBeNull();
  });

  it('точное совпадение ставит выше родственной категории', () => {
    const exact = scoreTemplate(entry('a'), query)!;
    const kin = scoreTemplate(entry('b', { traits: traits({ category: 'sweatshirt', hood: false }) }), query)!;
    expect(exact.score).toBeGreaterThan(kin.score);
  });

  it('пуловер и молнию не путает', () => {
    const zip = scoreTemplate(
      entry('zip', { traits: traits({ category: 'zip_hoodie', closure: 'full_zip' }) }),
      query,
    )!;
    const pullover = scoreTemplate(entry('pullover'), query)!;
    expect(pullover.score).toBeGreaterThan(zip.score);
  });

  it('шаблон со спинкой выигрывает у одностороннего', () => {
    const withBack = scoreTemplate(entry('two', { svg_back: 'x-back.svg' }), query)!;
    const oneSided = scoreTemplate(entry('one'), query)!;
    expect(withBack.score).toBeGreaterThan(oneSided.score);
  });

  it('возвращает топ и отрыв лидера', () => {
    const result = matchTemplates(
      [
        entry('best', { svg_back: 'b.svg' }),
        entry('worse', { traits: traits({ fit: 'fitted', pocket: 'none' }) }),
        entry('alien', { traits: traits({ category: 'tank_top' }) }),
      ],
      query,
    );
    expect(result.best!.entry.id).toBe('best');
    expect(result.margin).toBeGreaterThan(0);
    // Майка — не родня худи, в кандидаты не попадает.
    expect(result.candidates.map((c) => c.entry.id)).not.toContain('alien');
  });
});

describe('силуэт в масштабе изделия', () => {
  const template =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">' +
    '<path style="fill:none;stroke:#0E0E0E;stroke-width:2" d="M 0 0 L 100 0 L 100 140 L 0 140 Z"/></svg>';

  it('масштаб задаёт ширина груди', () => {
    const r = renderLibraryView(template, {
      chestFlatCm: 60,
      lengthCm: 84,
      viewLabel: 'Перед',
      disclaimer: 'Иллюстративный силуэт',
    });
    // 100 единиц шаблона на 60 см изделия.
    expect(r.scale).toBeCloseTo(0.6, 5);
    // 140 × 0.6 = 84 см — ровно табельная длина, расхождения нет.
    expect(r.proportionDrift).toBeCloseTo(0, 3);
  });

  it('расхождение пропорций считает и не прячет', () => {
    const r = renderLibraryView(template, {
      chestFlatCm: 60,
      lengthCm: 60,
      viewLabel: 'Перед',
      disclaimer: 'Иллюстративный силуэт',
    });
    // Нарисованные 84 см против табельных 60 — сорок процентов мимо.
    expect(r.proportionDrift).toBeGreaterThan(MAX_PROPORTION_DRIFT);
  });

  it('несёт плашку и подпись вида', () => {
    const r = renderLibraryView(template, {
      chestFlatCm: 60,
      lengthCm: 84,
      viewLabel: 'Перед',
      disclaimer: 'Иллюстративный силуэт — размеры в табеле мер',
    });
    expect(r.svg).toContain('Иллюстративный силуэт — размеры в табеле мер');
    expect(r.svg).toContain('Перед');
    expect(r.viewBox.width).toBeGreaterThan(60);
  });

  it('толщину линии возвращает в единицы шаблона', () => {
    // Без этого крупный силуэт пришёл бы волосяным контуром, а мелкий жирным.
    const r = renderLibraryView(template, {
      chestFlatCm: 60,
      lengthCm: 84,
      viewLabel: 'Перед',
      disclaimer: 'п',
    });
    expect(r.svg).toContain(`stroke-width="${Math.round((1 / 0.6) * 1e6) / 1e6}"`);
  });
});
