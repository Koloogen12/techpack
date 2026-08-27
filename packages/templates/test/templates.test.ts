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
import { landmarksOf, zonesOf } from '../src/zones.js';
import type { NodeZone } from '@seamsterly/kb';
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


/**
 * Силуэт-макет в форме буквы Т: торс, два разведённых рукава, капюшон.
 *
 * Прямоугольник для этих проверок не годится: у него нет ни проймы, ни
 * рукавов, а вся линейка построена на том, что торс отделяется от них по
 * контуру. Числа выбраны круглыми: торс шириной 100 от плеча на 60 до
 * низа на 280 — пропорция 100/220.
 */
/** Что силуэт-макет рисует: у него есть всё, кроме застёжки и кармана. */
const DETAILS = { hood: true, closure: false, pocket: false, sleeves: true, ribbedWaist: true };

const FLAT_HOOD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
  '<path style="fill:none;stroke:#0E0E0E;stroke-width:2" d="M 130 0 L 170 0 L 170 60 ' +
  'L 200 60 L 300 80 L 300 130 L 200 120 L 200 280 L 100 280 L 100 120 L 0 130 L 0 80 ' +
  'L 100 60 L 130 60 Z"/></svg>';

/** Тот же силуэт без капюшона: плечи сразу по верхнему краю. */
const FLAT_PLAIN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
  '<path style="fill:none;stroke:#0E0E0E;stroke-width:2" d="M 100 0 L 200 0 ' +
  'L 300 20 L 300 70 L 200 60 L 200 280 L 100 280 L 100 60 L 0 70 L 0 20 Z"/></svg>';

describe('силуэт в масштабе изделия', () => {
  const render = (over: Partial<Parameters<typeof renderLibraryView>[1]> = {}) =>
    renderLibraryView(FLAT_PLAIN, {
      targetWidthCm: 600,
      targetHeightCm: 600,
      bodyWidthCm: 50,
      bodyRatio: 100 / 280,
      disclaimer: 'п',
      ...over,
    });

  it('масштаб задаёт ширина торса, а не габарит листа', () => {
    // Габарит листа — это в первую очередь угол отведения рукава: по нему
    // мерили бы манеру рисования, а не изделие.
    expect(render().scale).toBeCloseTo(0.5, 3);
  });

  it('в отведённое место вписывается, даже если по торсу вышло бы шире', () => {
    // Лучше нарисовать мельче, чем залезть на соседний вид.
    expect(render({ targetWidthCm: 30 }).scale).toBeCloseTo(0.1, 3);
  });

  it('совпадение пропорции корпуса даёт нулевое расхождение', () => {
    const r = render();
    expect(r.proportionMeasured).toBe(true);
    expect(r.proportionDrift).toBeLessThan(0.1);
  });

  it('подмену изделия ловит: кроп вместо обычного', () => {
    // Табель говорит вдвое длиннее, чем нарисовано, — это другое изделие.
    expect(render({ bodyRatio: 100 / 560 }).proportionDrift).toBeGreaterThan(MAX_PROPORTION_DRIFT);
  });

  it('несёт плашку по ширине своей подписи', () => {
    const width = (svg: string): number => Number(/<rect[^>]*width="([\d.]+)"/.exec(svg)![1]);
    // Оговорка переводится, и на другом языке она другой длины.
    expect(width(render({ disclaimer: 'Иллюстративный силуэт — выноска на зону' }).svg))
      .toBeGreaterThan(width(render({ disclaimer: 'Коротко' }).svg));
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

describe('зоны изделия', () => {
  it('находит линию плеча под капюшоном, а не по верхнему краю', () => {
    const L = landmarksOf(FLAT_HOOD)!;
    expect(L.shoulderY).toBeGreaterThan(40);
    expect(L.shoulderY).toBeLessThan(90);
    expect(L.aboveShoulders).toBe(true);
  });

  it('меряет торс, игнорируя раскинутые рукава', () => {
    // Размах с рукавами — 300, торс — 100. Взяв размах, мы намеряли бы
    // манеру рисования, а не изделие.
    const L = landmarksOf(FLAT_HOOD)!;
    expect(L.torsoMeasured).toBe(true);
    expect(L.torsoWidth).toBeCloseTo(100, 0);
  });

  it('низ корпуса берёт по торсу, а не по краю габарита', () => {
    const L = landmarksOf(FLAT_HOOD)!;
    expect(L.bodyBottomY).toBeGreaterThan(250);
    expect(L.bodyBottomY).toBeLessThanOrEqual(300);
  });

  it('капюшон рисует по разметке шаблона, а не по геометрии', () => {
    // Над плечами бывает и воротник, и просто поле; принять их за капюшон
    // значило бы поставить выноску на пустое место.
    expect(zonesOf(FLAT_HOOD, DETAILS).has('hood')).toBe(true);
    expect(zonesOf(FLAT_HOOD, { ...DETAILS, hood: false }).has('hood')).toBe(false);
    // А у силуэта без капюшона его нет и при включённой разметке.
    expect(zonesOf(FLAT_PLAIN, DETAILS).has('hood')).toBe(false);
  });

  it('горловину ставит под плечами, а не на макушке', () => {
    const z = zonesOf(FLAT_HOOD, DETAILS);
    const L = landmarksOf(FLAT_HOOD)!;
    expect(z.get('neckline')!.y).toBeGreaterThan(L.shoulderY);
    expect(z.get('hood')!.y).toBeLessThan(L.shoulderY);
  });

  it('ось ведёт по торсу, а не по середине листа', () => {
    const z = zonesOf(FLAT_HOOD, DETAILS);
    expect(z.get('hem')!.x).toBeCloseTo(150, 0);
  });
});

describe('выноски на зоны', () => {
  const render = (zones: NodeZone[]) =>
    renderLibraryView(FLAT_PLAIN, {
      targetWidthCm: 300,
      targetHeightCm: 300,
      bodyWidthCm: 100,
      bodyRatio: 100 / 280,
      disclaimer: 'Иллюстративный силуэт',
      callouts: { zones, label: (z) => `зона:${z}`, details: { ...DETAILS, hood: false } },
    });

  it('помечает каждую зону, на которую встала выноска', () => {
    // По этим пометкам проверяется связь «узел ↔ чертёж»: у библиотечного
    // силуэта её держит зона, а не линия шва.
    const r = render(['neckline', 'sleeves', 'hem']);
    expect(r.zones.sort()).toEqual(['hem', 'neckline', 'sleeves']);
    for (const z of ['neckline', 'sleeves', 'hem']) {
      expect(r.svg).toContain(`data-zone="${z}"`);
    }
  });

  it('зону, которой на силуэте нет, молча пропускает', () => {
    // Выноска в пустоту хуже отсутствующей.
    const r = render(['hood']);
    expect(r.zones).toEqual([]);
  });

  it('под выноски отдаёт поля по бокам, без них — весь габарит', () => {
    // Широкий силуэт упирается в ширину рамки, и поля под подписи забирают
    // её у рисунка. Подписи поверх изделия читать нельзя.
    const at = (callouts: boolean) =>
      renderLibraryView(FLAT_PLAIN, {
        targetWidthCm: 120,
        targetHeightCm: 400,
        bodyWidthCm: 900,
        bodyRatio: 100 / 280,
        disclaimer: 'п',
        ...(callouts
          ? { callouts: { zones: ['hem' as NodeZone], label: () => 'низ', details: DETAILS } }
          : {}),
      });
    expect(at(false).scale).toBeGreaterThan(at(true).scale);
    expect(at(false).zones).toEqual([]);
  });

  it('подписи не наезжают друг на друга', () => {
    // Шесть зон в двух полях — по три в каждом; между строками обязан
    // остаться зазор, иначе подписи слипнутся в кашу.
    const r = render(['hood', 'neckline', 'shoulders', 'sleeves', 'sides', 'hem']);
    const ys = [...r.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    for (const side of [true, false]) {
      const rows = ys.filter((p) => (p.x < 60) === side).map((p) => p.y).sort((a, b) => a - b);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]! - rows[i - 1]!).toBeGreaterThan(1);
      }
    }
  });
});

describe('деталь, которой на силуэте нет', () => {
  const flat = FLAT_PLAIN;

  it('выноску в пустоту не рисует и называет пропущенное', () => {
    // Изделие требует карман и застёжку, силуэт их не рисует. Указывать
    // выноской не на что — но и молчать нельзя.
    const r = renderLibraryView(flat, {
      targetWidthCm: 300,
      targetHeightCm: 300,
      bodyWidthCm: 100,
      bodyRatio: 100 / 280,
      disclaimer: 'п',
      callouts: {
        zones: ['neckline', 'pockets', 'closure', 'hem'],
        label: (z) => `зона:${z}`,
        details: { hood: false, closure: false, pocket: false, sleeves: true, ribbedWaist: false },
      },
    });
    expect(r.zones.sort()).toEqual(['hem', 'neckline']);
    expect(r.missing.sort()).toEqual(['closure', 'pockets']);
    expect(r.svg).not.toContain('data-zone="pockets"');
    expect(r.svg).not.toContain('зона:pockets');
  });

  it('деталь, которая на силуэте есть, подписывает как обычно', () => {
    const r = renderLibraryView(flat, {
      targetWidthCm: 300,
      targetHeightCm: 300,
      bodyWidthCm: 100,
      bodyRatio: 100 / 280,
      disclaimer: 'п',
      callouts: {
        zones: ['pockets'],
        label: (z) => `зона:${z}`,
        details: { hood: false, closure: false, pocket: true, sleeves: true, ribbedWaist: false },
      },
    });
    expect(r.zones).toEqual(['pockets']);
    expect(r.missing).toEqual([]);
  });
});

describe('штраф за отсутствующую деталь', () => {
  it('силуэт без требуемого кармана уходит ниже порога автоподбора', () => {
    // Карман другого кроя — неточность: выноска всё равно на карман.
    // Кармана НЕТ — дыра: указывать нечем, и лист приходится оговаривать.
    const other = scoreTemplate(entry('patch', { traits: traits({ pocket: 'patch' }) }), query)!;
    const none = scoreTemplate(entry('none', { traits: traits({ pocket: 'none' }) }), query)!;
    expect(none.score).toBeLessThan(other.score);
    expect(none.fit_fraction).toBeLessThan(AUTO_FIT_FRACTION);
    expect(none.reasons).toContain('кармана на силуэте нет');
  });

  it('силуэт без капюшона у худи проигрывает разгромно', () => {
    const full = scoreTemplate(entry('ok'), query)!;
    const bald = scoreTemplate(entry('bald', { traits: traits({ hood: false }) }), query)!;
    expect(full.score - bald.score).toBeGreaterThan(30);
  });

  it('доля совпадения не уходит ниже нуля', () => {
    // Штрафы могут увести счёт в минус, но «минус тридцать процентов
    // совпадения» — не величина, а бессмыслица.
    const bad = scoreTemplate(
      entry('bad', {
        traits: traits({ hood: false, pocket: 'none', sleeve: 'none', ribbed: false, fit: 'fitted' }),
      }),
      query,
    );
    if (bad) expect(bad.fit_fraction).toBeGreaterThanOrEqual(0);
  });
});

describe('очередь на повышение в мастера', () => {
  it('частота выбора влияет на счёт последним разрядом', () => {
    // При прочих равных выигрывает силуэт, который люди уже выбирали,
    // а не первый по алфавиту. Но перебить признак им нельзя.
    const chosen = scoreTemplate(entry('chosen', { promotion_score: 20 }), query)!;
    const fresh = scoreTemplate(entry('fresh'), query)!;
    expect(chosen.score).toBeGreaterThan(fresh.score);
    expect(chosen.score - fresh.score).toBeLessThan(3);
  });

  it('частота не перебивает совпадение признаков', () => {
    // Иначе однажды выбранный силуэт без капюшона начал бы побеждать
    // силуэт с капюшоном у худи — просто потому, что его уже брали.
    const popular = scoreTemplate(
      entry('popular', { promotion_score: 9999, traits: traits({ hood: false }) }),
      query,
    )!;
    const right = scoreTemplate(entry('right'), query)!;
    expect(right.score).toBeGreaterThan(popular.score);
  });
});
