import { describe, expect, it } from 'vitest';
import { lineArt, splitViews } from '../src/normalize.js';
import { pathBox, readPaths, splitSubpaths } from '../src/svg.js';
import {
  AUTO_FIT_FRACTION,
  isConfident,
  matchTemplates,
  scoreTemplate,
  type MatchQuery,
} from '../src/match.js';
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
  svg_back: `packages/kb/data/templates/hoodie_family/${id}-back.svg`,
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
  /** Изделие — связная клякса из перекрывающихся деталей. */
  const garment = (x: number, y: number, size: number): string =>
    Array.from({ length: 5 }, (_, i) => {
      const px = x + i * size * 0.18;
      const py = y + i * size * 0.12;
      return `<path style="fill:#C6C6C6" d="M ${px} ${py} l ${size} 0 l 0 ${size} l ${-size} 0 z"/>`;
    }).join('');

  it('делит лист на два вида, где бы они ни стояли', () => {
    // Композиция сдвинута вправо: деление пополам разрезало бы силуэт.
    const svg = `<svg viewBox="0 0 2000 1200">${garment(100, 100, 300)}${garment(1200, 100, 300)}</svg>`;
    const { front, back } = splitViews(readPaths(svg));
    expect(front).toHaveLength(5);
    expect(back).toHaveLength(5);
    // Перед — слева: отраслевая условность подачи.
    expect(Math.min(...front.map((p) => p.box.minX))).toBeLessThan(
      Math.min(...back.map((p) => p.box.minX)),
    );
  });

  it('делит и вертикальную раскладку', () => {
    // Половина датасета кладёт виды друг под друга: проекция на одну ось
    // такие листы путала, кластеры — нет.
    const svg = `<svg viewBox="0 0 1200 2000">${garment(100, 100, 300)}${garment(100, 1200, 300)}</svg>`;
    const { front, back } = splitViews(readPaths(svg));
    expect(front).toHaveLength(5);
    expect(back).toHaveLength(5);
    // Перед — сверху.
    expect(Math.min(...front.map((p) => p.box.minY))).toBeLessThan(
      Math.min(...back.map((p) => p.box.minY)),
    );
  });

  it('одно изделие на листе не делит', () => {
    const svg = `<svg viewBox="0 0 1200 1200">${garment(100, 100, 400)}</svg>`;
    expect(splitViews(readPaths(svg)).back).toHaveLength(0);
  });

  it('мелкую деталь рядом с изделием за второй вид не принимает', () => {
    // Бирка или увеличенный узел втрое мельче изделия — это не вид.
    const svg =
      `<svg viewBox="0 0 2000 1200">${garment(100, 100, 400)}${garment(1500, 100, 60)}</svg>`;
    expect(splitViews(readPaths(svg)).back).toHaveLength(0);
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

  it('фигуру тоньше линии рисует заливкой, а не контуром', () => {
    // Зубец молнии шириной полторы единицы при линии в две: обведённый
    // зубец шире зубца, и девяносто шесть таких сливались в чёрную полосу.
    const style = lineArt('fill:#333333', 2, 0.6, 1.38);
    expect(style).toContain('fill:#0E0E0E');
    expect(style).toContain('stroke:none');
  });

  it('крупную заливку по-прежнему обводит', () => {
    const style = lineArt('fill:#333333', 2, 0.6, 40);
    expect(style).toContain('fill:none');
  });

  it('сохраняет иерархию толщин относительно опорной линии', () => {
    // Отделочная строчка вдвое тоньше контура — это не оформление:
    // по числу и виду параллельных линий определяют тип машины.
    const outline = lineArt('fill:none;stroke:#000;stroke-width:0.6124', 2, 0.6124);
    const stitch = lineArt('fill:none;stroke:#000;stroke-width:0.3062', 2, 0.6124);
    expect(outline).toContain('stroke-width:2');
    expect(stitch).toContain('stroke-width:1');
  });

  it('пунктир растягивает во столько же раз, во сколько потолстела линия', () => {
    // Штрих короче собственной толщины сливается в сплошную линию.
    const style = lineArt(
      'fill:none;stroke:#000;stroke-width:0.3062;stroke-dasharray:0.9187',
      2,
      0.6124,
    );
    expect(style).toContain('stroke-dasharray:3');
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

  it('шаблон без вида спинки не предлагает', () => {
    // Техпак с одним видом неполон, а датасет почти всегда даёт оба.
    expect(scoreTemplate(entry('one-sided', { svg_back: null }), query)).toBeNull();
  });

  it('возвращает топ и отрыв лидера', () => {
    const result = matchTemplates(
      [
        entry('best'),
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
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">' +
    '<path style="fill:none;stroke:#0E0E0E;stroke-width:2" d="M 0 0 L 120 0 L 120 100 L 0 100 Z"/></svg>';

  it('вписывает силуэт в габарит нашего чертежа', () => {
    const r = renderLibraryView(template, {
      targetWidthCm: 120,
      targetHeightCm: 100,
      disclaimer: 'Иллюстративный силуэт',
    });
    // Форма листа совпала — расхождения нет, масштаб один к одному.
    expect(r.proportionDrift).toBeCloseTo(0, 3);
    expect(r.scale).toBeCloseTo(1, 5);
  });

  it('расхождение формы листа считает и не прячет', () => {
    // Лист шаблона вдвое шире своей высоты против нашего почти квадратного:
    // это не разница условности рисунка, это другое изделие.
    const r = renderLibraryView(template, {
      targetWidthCm: 100,
      targetHeightCm: 140,
      disclaimer: 'Иллюстративный силуэт',
    });
    expect(r.proportionDrift).toBeGreaterThan(MAX_PROPORTION_DRIFT);
  });

  it('масштабирует равномерно, вписывая в габарит', () => {
    const r = renderLibraryView(template, {
      targetWidthCm: 60,
      targetHeightCm: 100,
      disclaimer: 'п',
    });
    // Ширина упирается первой: 60/120 против 100/100.
    expect(r.scale).toBeCloseTo(0.5, 5);
  });

  it('несёт плашку и подпись вида', () => {
    const r = renderLibraryView(template, {
      targetWidthCm: 120,
      targetHeightCm: 100,
      disclaimer: 'Иллюстративный силуэт — размеры в табеле мер',
    });
    expect(r.svg).toContain('Иллюстративный силуэт — размеры в табеле мер');
    // Подпись вида рисует документ своей типографикой — в картинке её нет.
    expect(r.svg).not.toContain('Перед');
  });

  it('толщину линии не переопределяет', () => {
    // Она задана при приёме долей от размера рисунка и едет вместе с ним.
    // Атрибут на группе всё равно проигрывает инлайн-стилю каждого пути.
    const r = renderLibraryView(template, {
      targetWidthCm: 60,
      targetHeightCm: 100,
      disclaimer: 'п',
    });
    expect(r.svg).not.toContain('<g transform="translate(0 0) scale(0.5) translate(0 0)" stroke-width');
  });
});

describe('уверенность подбора', () => {
  it('меряется долей совпавших признаков, а не отрывом от второго', () => {
    // В библиотеке из сотни худи полсотни совпадают по всем признакам:
    // отрыв лидера от соседа там всегда близок к нулю и ничего не значит.
    const twins = Array.from({ length: 5 }, (_, i) => entry(`twin-${i}`));
    const result = matchTemplates(twins, query);
    expect(result.margin).toBeLessThan(1);
    expect(result.best!.fit_fraction).toBeCloseTo(1, 3);
    expect(isConfident(result)).toBe(true);
  });

  it('промах по крупному признаку уводит долю ниже порога', () => {
    const wrong = entry('no-hood', { traits: traits({ hood: false, pocket: 'none' }) });
    const result = matchTemplates([wrong], query);
    expect(result.best!.fit_fraction).toBeLessThan(AUTO_FIT_FRACTION);
    expect(isConfident(result)).toBe(false);
  });
});
