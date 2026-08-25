import { describe, expect, it } from 'vitest';
import {
  buildGeometry,
  buildPaths,
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
