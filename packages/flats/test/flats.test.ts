import { describe, expect, it } from 'vitest';
import {
  buildGeometry,
  buildPaths,
  buildSideGeometry,
  buildSidePaths,
  DEFAULT_PATH_OPTIONS,
  garmentDepth,
  measuredBicep,
  renderFlat,
  type ArtworkZone,
  type FlatMeasurements,
} from '../src/index.js';

/** Женская футболка RU 46 — те же числа, что выдаёт POM-движок. */
const M: FlatMeasurements = {
  bodyLength: 68.9,
  chestFlat: 51,
  waistFlat: 49,
  hemFlat: 51,
  shoulderWidth: 44.4,
  armhole: 22.4,
  sleeveLength: 20.4,
  bicep: 19.9,
  sleeveOpening: 16.8,
  neckWidth: 17.8,
  frontNeckDrop: 7.7,
  backNeckDrop: 2.6,
  neckRibHeight: 2,
  shoulderSlope: 4.1,
};

const geo = (over: Partial<FlatMeasurements> = {}) => buildGeometry({ ...M, ...over }, 'front');
const svg = (over: Partial<FlatMeasurements> = {}) =>
  renderFlat({ ...M, ...over }, { view: 'front' }).svg;

describe('half-замеры и расстояние от центра', () => {
  it('боковой шов стоит на половине ширины разложенного изделия', () => {
    // Ошибка на этом месте удваивает изделие, а заметна только на фабрике.
    expect(geo().underarm.x).toBeCloseTo(M.chestFlat / 2, 6);
    expect(geo().hem.x).toBeCloseTo(M.hemFlat / 2, 6);
  });

  it('плечевая точка стоит на половине ширины плеч', () => {
    expect(geo().shoulderPoint.x).toBeCloseTo(M.shoulderWidth / 2, 6);
  });

  it('ширина рукава на чертеже равна замеру как есть — рукав в один слой', () => {
    const g = geo();
    const width = Math.hypot(
      g.sleeveBottomEnd.x - g.sleeveTopEnd.x,
      g.sleeveBottomEnd.y - g.sleeveTopEnd.y,
    );
    expect(width).toBeCloseTo(M.sleeveOpening, 6);
  });
});

describe('геометрия выводится из замеров, а не рисуется отдельно', () => {
  it('глубина проймы следует из хорды по теореме Пифагора', () => {
    const g = geo();
    const dx = M.chestFlat / 2 - M.shoulderWidth / 2;
    const dy = g.underarm.y - g.shoulderPoint.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(M.armhole, 6);
  });

  it('угол рукава подобран так, что ширина под проймой совпадает с таблицей', () => {
    expect(measuredBicep(geo())).toBeCloseTo(M.bicep, 3);
  });

  it('длина рукава по верхнему сгибу равна замеру', () => {
    const g = geo();
    expect(
      Math.hypot(g.sleeveTopEnd.x - g.shoulderPoint.x, g.sleeveTopEnd.y - g.shoulderPoint.y),
    ).toBeCloseTo(M.sleeveLength, 6);
  });
});

describe('правка замера меняет чертёж — требования R7 и R10', () => {
  it('шире грудь — дальше боковой шов и глубже пройма', () => {
    const wide = geo({ chestFlat: 57 });
    expect(wide.underarm.x).toBeGreaterThan(geo().underarm.x);
  });

  it('шире рукав — другой угол рукава', () => {
    expect(geo({ bicep: 23 }).sleeveAngle).not.toBeCloseTo(geo().sleeveAngle, 4);
  });

  it('длиннее изделие — ниже низ и талия', () => {
    const long = geo({ bodyLength: 80 });
    expect(long.hem.y).toBeGreaterThan(geo().hem.y);
    expect(long.waist.y).toBeGreaterThan(geo().waist.y);
  });

  it('любая правка меняет разметку — чертёж не может отстать от таблицы', () => {
    for (const change of [
      { chestFlat: 55 },
      { bodyLength: 72 },
      { shoulderWidth: 40 },
      { neckWidth: 20 },
      { sleeveLength: 26 },
      { sleeveOpening: 14 },
      { frontNeckDrop: 11 },
    ] as Partial<FlatMeasurements>[]) {
      expect(svg(change), JSON.stringify(change)).not.toBe(svg());
    }
  });
});

describe('перед и спинка', () => {
  it('различаются глубиной горловины', () => {
    expect(buildGeometry(M, 'front').neckCenter.y).toBe(M.frontNeckDrop);
    expect(buildGeometry(M, 'back').neckCenter.y).toBe(M.backNeckDrop);
  });

  it('спинка не копия переда', () => {
    expect(renderFlat(M, { view: 'back' }).svg).not.toBe(svg());
  });
});

describe('слои', () => {
  const full = svg();

  it('чертёж послойный: контур, швы, строчки, фурнитура', () => {
    for (const layer of ['outline', 'seams', 'stitches']) {
      expect(full).toContain(`data-layer="${layer}"`);
    }
  });

  it('слои отключаются по одному', () => {
    const outlineOnly = renderFlat(M, { view: 'front', layers: ['outline'] }).svg;
    expect(outlineOnly).toContain('data-layer="outline"');
    expect(outlineOnly).not.toContain('data-layer="stitches"');
  });

  it('выноски появляются только когда их передали и несут ссылку на узел', () => {
    expect(full).not.toContain('data-layer="callouts"');
    const withCallouts = renderFlat(M, {
      view: 'front',
      layers: ['outline', 'callouts'],
      callouts: [{ number: 1, at: { x: 20, y: 60 }, node_id: 'hem_coverstitch' }],
    }).svg;
    expect(withCallouts).toContain('data-node="hem_coverstitch"');
  });
});

describe('конвенции линий', () => {
  it('контур толще внутренних швов, швы толще отстрочек', () => {
    const widths = [...svg().matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 2);
  });

  it('отстрочки идут пунктиром — по нему фабрика читает тип шва', () => {
    expect(svg()).toContain('stroke-dasharray');
  });

  it('число пунктирных линий низа равно числу реальных строчек', () => {
    const rows = (n: number) =>
      buildPaths(M, 'front', {
        hemAllowance: 2,
        hemStitchRows: n,
        sleeveHemAllowance: 2,
        sleeveStitchRows: n,
        minSleeveAngleDeg: 0,
      }).paths.stitches.length;
    expect(rows(3)).toBeGreaterThan(rows(2));
  });
});

describe('устойчивость к крайним значениям', () => {
  it('oversize не ломает построение', () => {
    const g = geo({ chestFlat: 74, hemFlat: 74, waistFlat: 72, sleeveLength: 28, bicep: 28 });
    expect(Number.isFinite(g.sleeveAngle)).toBe(true);
    expect(g.bounds.width).toBeGreaterThan(0);
  });

  it('несовместимые замеры дают чертёж, а не падение', () => {
    // Ширина рукава больше расстояния до проймы геометрически невозможна.
    const g = geo({ bicep: 90 });
    expect(Number.isFinite(g.sleeveAngle)).toBe(true);
    expect(svg({ bicep: 90 })).toContain('<svg');
  });

  it('пройма короче своей проекции не даёт NaN', () => {
    const g = geo({ armhole: 1, chestFlat: 70, shoulderWidth: 30 });
    expect(Number.isNaN(g.underarm.y)).toBe(false);
  });

  it('в SVG никогда не попадает NaN', () => {
    for (const change of [
      {},
      { bicep: 90 },
      { armhole: 1 },
      { neckWidth: 0.2 },
      { shoulderSlope: 0 },
      { chestFlat: 74, hemFlat: 74 },
    ] as Partial<FlatMeasurements>[]) {
      expect(svg(change), JSON.stringify(change)).not.toContain('NaN');
    }
  });
});

describe('воспроизводимость', () => {
  it('одинаковые замеры дают побайтово одинаковый SVG', () => {
    expect(svg()).toBe(svg());
  });

  it('SVG не содержит растровых подложек — техническая геометрия только вектор', () => {
    expect(svg()).not.toContain('<image');
    expect(svg()).not.toContain('base64');
  });
});

describe('зона нанесения на чертеже', () => {
  const zone = (over: Partial<ArtworkZone> = {}): ArtworkZone => ({
    id: 'A1',
    offsetFromTop: 9,
    widthCm: 26,
    heightCm: 32,
    view: 'front',
    ...over,
  });

  const svg = (zones: ArtworkZone[], view: 'front' | 'back' = 'front') =>
    renderFlat(M, { view, artwork: zones }).svg;

  it('рисуется прямоугольником с размерами, а не картинкой', () => {
    const s = svg([zone()]);
    expect(s).toContain('data-artwork="A1"');
    expect(s).toContain('26×32');
    expect(s).toContain('<rect');
    // Макет — отдельный файл. Изображение на чертеже подменило бы и место,
    // и размер картинкой, потеряв оба.
    expect(s).not.toContain('<image');
  });

  it('отсчитывается от высшей точки плеча, а не от верха габарита', () => {
    // На худи верх габарита — макушка капюшона: считать оттуда значило бы
    // увести зону вниз на всю его высоту и разойтись с таблицей.
    const s = svg([zone({ offsetFromTop: 0 })]);
    expect(s).toMatch(/<rect x="-13" y="0"/);
  });

  it('зона одного вида на другом не появляется', () => {
    expect(svg([zone({ view: 'back' })], 'front')).not.toContain('data-artwork');
    expect(svg([zone({ view: 'back' })], 'back')).toContain('data-artwork');
  });

  it('подпись не налезает на изделие сверху — она под зоной', () => {
    const s = svg([zone({ offsetFromTop: 9, heightCm: 32 })]);
    const y = /<text x="0" y="([\d.]+)"/.exec(s)?.[1];
    expect(Number(y)).toBeGreaterThan(9 + 32);
  });

  it('без зон слоя нет вовсе', () => {
    expect(renderFlat(M, { view: 'front' }).svg).not.toContain('data-layer="artwork"');
  });
});

describe('заливка раппортом', () => {
  const fill = { dataUri: 'data:image/png;base64,AAAA', repeatCm: 24 };
  // Слой включается ЯВНО: технический чертёж по умолчанию остаётся чертежом,
  // а заливка живёт на странице нанесения с пометкой «не для замеров».
  const LAYERS = ['pattern', 'outline', 'seams'] as const;

  it('шаг раппорта задан в сантиметрах изделия — превью размерно точно', () => {
    // Чертёж рисуется в сантиметрах, поэтому 24 см раппорта дают 24 единицы
    // SVG. У декоративного превью «×4 повтора» такой связи нет вовсе.
    const s = renderFlat(M, { view: 'front', patternFill: fill, layers: [...LAYERS] }).svg;
    expect(s).toContain('patternUnits="userSpaceOnUse"');
    expect(s).toContain('width="24" height="24"');
  });

  it('заливка идёт под линиями, а не поверх', () => {
    const s = renderFlat(M, { view: 'front', patternFill: fill, layers: [...LAYERS] }).svg;
    expect(s.indexOf('data-layer="pattern"')).toBeLessThan(s.indexOf('data-layer="outline"'));
  });

  it('слой выключен по умолчанию — чертёж остаётся чертежом', () => {
    const s = renderFlat(M, { view: 'front', patternFill: fill }).svg;
    expect(s).not.toContain('data-layer="pattern"');
    expect(s).not.toContain('<pattern');
  });

  it('обе половины изделия залиты — заливка внутри зеркала', () => {
    // Капюшон однажды залился только справа: он оказался снаружи half().
    const s = renderFlat(M, { view: 'front', patternFill: fill, layers: [...LAYERS] }).svg;
    const layer = s.slice(s.indexOf('data-layer="pattern"'));
    const upTo = layer.slice(0, layer.indexOf('data-layer="outline"'));
    expect(upTo).toContain('scale(-1,1)');
  });
});

// ---------------------------------------------------------------- боковой вид

/** Худи RU 46 — единственная категория ядра, которой бок положен. */
const HOODIE: FlatMeasurements = {
  bodyLength: 66.6,
  chestFlat: 52.5,
  waistFlat: 50.4,
  hemFlat: 46.2,
  shoulderWidth: 45.7,
  armhole: 23.1,
  sleeveLength: 58,
  bicep: 20.5,
  sleeveOpening: 8.9,
  neckWidth: 21.6,
  frontNeckDrop: 8,
  backNeckDrop: 2.8,
  // Бейки нет намеренно: у худи горловину закрывает капюшон, и в шаблоне
  // точек T17 отсутствует.
  shoulderSlope: 4.1,
  cuffRibHeight: 6,
  waistRibHeight: 6,
  hoodHeight: 35.9,
  hoodWidth: 26.2,
  hoodOpening: 41.9,
  pocketWidth: 33.6,
  pocketHeight: 17.9,
};

const BODY_CHEST = 92;
const RATIO = 1.25;

describe('глубина изделия', () => {
  it('прибавка делает сечение КРУГЛЕЕ, а не просто больше', () => {
    // Прилегающее и оверсайз из одной сетки. Отношение ширины к глубине
    // у свободного изделия обязано быть МЕНЬШЕ: прибавка ложится
    // равномерным отступом, а он круглит контур.
    const fitted = garmentDepth(48, { bodyChest: BODY_CHEST, widthToDepth: RATIO });
    const oversize = garmentDepth(66, { bodyChest: BODY_CHEST, widthToDepth: RATIO });

    // Ширина сечения — из того же эллипса: полупериметр равен замеру в плоском виде.
    const shape = (flat: number, depth: number): number => {
      // a находится из периметра 2·flat при известном b = depth/2.
      const b = depth / 2;
      let lo = b;
      let hi = flat;
      for (let i = 0; i < 60; i++) {
        const a = (lo + hi) / 2;
        const p = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
        if (p < 2 * flat) lo = a;
        else hi = a;
      }
      return (2 * lo) / depth;
    };

    expect(shape(66, oversize)).toBeLessThan(shape(48, fitted));
  });

  it('отрицательная прибавка не сплющивает изделие в ноль', () => {
    // На трикотаже прилегающее изделие законно уже тела. Но сжать грудную
    // клетку вдвое оно не может, и чертёж обязан остаться чертежом.
    const depth = garmentDepth(38, { bodyChest: BODY_CHEST, widthToDepth: RATIO });
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeGreaterThan(
      garmentDepth(30, { bodyChest: BODY_CHEST, widthToDepth: RATIO }) * 0.99,
    );
  });

  it('полупериметр эллипса совпадает с замером в плоском виде', () => {
    // Проверка самой модели: изделие в плоском виде — это ровно половина
    // обхвата, и вывод глубины обязан это сохранять.
    const depth = garmentDepth(52.5, { bodyChest: BODY_CHEST, widthToDepth: RATIO });
    const b = depth / 2;
    // Ширина, дающая тот же периметр.
    let lo = b;
    let hi = 52.5;
    for (let i = 0; i < 60; i++) {
      const a = (lo + hi) / 2;
      const p = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      if (p < 2 * 52.5) lo = a;
      else hi = a;
    }
    expect(2 * lo).toBeGreaterThan(depth); // изделие шире, чем толще
  });
});

describe('боковой вид', () => {
  const depth = garmentDepth(HOODIE.chestFlat, {
    bodyChest: BODY_CHEST,
    widthToDepth: RATIO,
  });

  it('уровни совпадают с передом по построению', () => {
    // Линия груди и линия низа обязаны стоять на одной высоте на всех видах.
    // Иначе три вида читаются как три разных изделия.
    const front = buildGeometry(HOODIE, 'front');
    const side = buildSideGeometry(HOODIE, depth);
    expect(side.chestFront.y).toBe(front.underarm.y);
    expect(side.hemFront.y).toBe(front.hem.y);
  });

  it('все детали помещаются в габарит', () => {
    // Карман настрочной и выступает наружу; капюшон в верхней части шире
    // изделия. Деталь, не вошедшая в габарит, рисуется за краем видимой
    // области: она есть в файле, и её не видно.
    const { paths, geometry } = buildSidePaths(HOODIE, depth);
    const all = [
      paths.outline,
      ...paths.seams,
      ...paths.hood,
      ...paths.parts,
      ...paths.pocket,
      ...paths.ribs,
      ...paths.stitches,
    ].join(' ');
    const xs = [...all.matchAll(/[ML]\s(-?\d+\.?\d*)\s/g)].map((mm) => Number(mm[1]));
    const cs = [
      ...all.matchAll(/C\s(-?\d+\.?\d*)\s\S+\s(-?\d+\.?\d*)\s\S+\s(-?\d+\.?\d*)\s/g),
    ].flatMap((mm) => [Number(mm[1]), Number(mm[2]), Number(mm[3])]);
    for (const x of [...xs, ...cs]) {
      expect(x).toBeGreaterThanOrEqual(geometry.bounds.left - 0.01);
      expect(x).toBeLessThanOrEqual(geometry.bounds.right + 0.01);
    }
  });

  it('боковой шов виден ниже рукава и скрыт под ним', () => {
    // То, ради чего вид существует. Рукав висит поверх шва, и закрытый
    // участок обязан быть точечным, а не отсутствовать.
    const { paths } = buildSidePaths(HOODIE, depth);
    expect(paths.hidden.length).toBeGreaterThan(0);
    expect(paths.hidden[0]).toMatch(/^M 0 /);
  });

  it('не зеркалится', () => {
    // У бока перед спереди, спинка сзади. Зеркало стёрло бы единственное,
    // что он показывает.
    const { svg } = renderFlat(HOODIE, { view: 'side', depthCm: depth });
    expect(svg).not.toContain('scale(-1,1)');
    expect(svg).toContain('data-view="side"');
  });

  it('без глубины не строится', () => {
    // Глубину не задаёт ни один замер. Молча подставить её значило бы
    // выдать выдуманное число за выведенное.
    expect(() => renderFlat(HOODIE, { view: 'side' })).toThrow(/глубин/);
  });

  it('свободное изделие сбоку глубже прилегающего', () => {
    const loose = garmentDepth(66, { bodyChest: BODY_CHEST, widthToDepth: RATIO });
    const tight = garmentDepth(48, { bodyChest: BODY_CHEST, widthToDepth: RATIO });
    expect(buildSideGeometry(HOODIE, loose).bounds.right).toBeGreaterThan(
      buildSideGeometry(HOODIE, tight).bounds.right,
    );
  });
});

// ------------------------------------------------- отведение рукава и бейка

describe('отведение рукава', () => {
  /**
   * Точная укладка задана парой замеров однозначно: ширина рукава под проймой
   * относится к хорде проймы как синус угла между ними. Для трикотажа это
   * даёт почти горизонтальный рукав — верно физически и негодно как чертёж.
   */
  it('без условности рукав ложится почти горизонтально', () => {
    const g = buildGeometry(HOODIE, 'front', 0);
    expect((g.sleeveAngle * 180) / Math.PI).toBeLessThan(22);
    expect(g.sleeveAngle).toBe(g.solvedSleeveAngle);
  });

  it('условность отводит рукав вниз и сохраняет точный угол отдельно', () => {
    const g = buildGeometry(HOODIE, 'front', 32);
    expect((g.sleeveAngle * 180) / Math.PI).toBeCloseTo(32, 5);
    // Точный угол не теряется: документ обязан сказать, что отличается.
    expect(g.solvedSleeveAngle).toBeLessThan(g.sleeveAngle);
  });

  it('условность — это МИНИМУМ, а не замена', () => {
    // Узкий рукав при глубокой пройме сам даёт крутой угол. Подменять его
    // условностью значило бы потерять точность там, где она достижима.
    const narrow: FlatMeasurements = { ...HOODIE, bicep: 12 };
    const g = buildGeometry(narrow, 'front', 32);
    expect(g.sleeveAngle).toBe(g.solvedSleeveAngle);
    expect((g.sleeveAngle * 180) / Math.PI).toBeGreaterThan(32);
  });

  it('отведение сужает лист', () => {
    const flat = buildGeometry(HOODIE, 'front', 0);
    const drawn = buildGeometry(HOODIE, 'front', 32);
    expect(drawn.sleeveTopEnd.x).toBeLessThan(flat.sleeveTopEnd.x);
  });
});

describe('деталь, которой у изделия нет, не рисуется', () => {
  it('у худи нет бейки горловины', () => {
    // Раньше здесь стоял фолбэк в 2 см, и чертёж показывал фабрике деталь,
    // которой в табеле мер нет вовсе.
    const { paths } = buildPaths(HOODIE, 'front');
    expect(paths.seams.some((s) => s.id === 'neck_band')).toBe(false);
    expect(paths.panels.some((p) => p.id === 'neckband')).toBe(false);
  });

  it('у изделия с поясом-риб нет отстрочки низа', () => {
    // Низ не подшит, он закрыт рибаной: отстрочка обещала бы операцию,
    // которой в спецификации не будет.
    const { paths } = buildPaths(HOODIE, 'front');
    expect(paths.stitches.some((s) => s.id === 'hem_stitch')).toBe(false);
  });

  it('у футболки бейка есть', () => {
    const { paths } = buildPaths(M, 'front');
    expect(paths.seams.some((s) => s.id === 'neck_band')).toBe(true);
    expect(paths.panels.some((p) => p.id === 'neckband' && p.material === 'rib')).toBe(true);
  });
});

describe('детали кроя', () => {
  it('рукав повёрнут по своей долевой, корпус — нет', () => {
    const { paths } = buildPaths(HOODIE, 'front', {
      ...DEFAULT_PATH_OPTIONS,
      minSleeveAngleDeg: 32,
    });
    const body = paths.panels.find((p) => p.id === 'body')!;
    const sleeve = paths.panels.find((p) => p.id === 'sleeve')!;
    expect(body.grain_deg).toBe(0);
    // Долевая рукава идёт вдоль его длины: 32° к горизонтали = −58° к вертикали.
    expect(sleeve.grain_deg).toBeCloseTo(-58, 5);
  });

  it('рибаны помечены отдельным материалом — они не печатаются', () => {
    const { paths } = buildPaths(HOODIE, 'front');
    const ribs = paths.panels.filter((p) => p.material === 'rib').map((p) => p.id);
    expect(ribs.sort()).toEqual(['cuff', 'waistband']);
  });
});
