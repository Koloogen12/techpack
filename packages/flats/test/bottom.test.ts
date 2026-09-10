import { describe, expect, it } from 'vitest';
import {
  buildBottomGeometry,
  buildBottomPaths,
  DEFAULT_BOTTOM_OPTIONS,
  renderFlat,
  type BottomPathOptions,
  type SkirtMeasurements,
  type TrousersMeasurements,
} from '../src/index.js';

/**
 * Чертёж НИЗА против табеля мер.
 *
 * Проверяется то же, что у верха, и по той же причине: чертёж обязан быть
 * ВЫВЕДЕН из замеров, а не нарисован рядом с ними. Разница в том, от чего
 * ведётся отсчёт — у низа это верхний край пояса, а не плечо, — и в том, что
 * низ рисуется целиком: у брюк застёжка лежит на одной стороне, и зеркала,
 * которое у верха бесплатно даёт симметрию, здесь нет.
 */

/** Женская юбка RU 46 — те же числа, что выдаёт POM-движок. */
const SKIRT: SkirtMeasurements = {
  kind: 'skirt',
  waistFlat: 38.2,
  waistbandHeight: 3.4,
  highHipFlat: 44.1,
  hipFlat: 56,
  length: 59.5,
  sweepFlat: 64.4,
  dartLength: 4.4,
  ventLength: 4.4,
  zipLength: 4.9,
};

/** Женские брюки RU 46 — оттуда же. */
const TROUSERS: TrousersMeasurements = {
  kind: 'trousers',
  waistFlat: 38.2,
  waistbandHeight: 3.7,
  highHipFlat: 44.1,
  hipFlat: 57,
  frontRise: 7.1,
  backRise: 9.8,
  thighFlat: 35.3,
  kneeFlat: 25.1,
  legOpening: 22.8,
  inseamLength: 78.2,
  outseamLength: 103.7,
  flyLength: 4.4,
  hemAllowance: 1.1,
};

const skirt = (over: Partial<SkirtMeasurements> = {}) => buildBottomGeometry({ ...SKIRT, ...over });
const trousers = (over: Partial<TrousersMeasurements> = {}) =>
  buildBottomGeometry({ ...TROUSERS, ...over });

const svg = (
  m: SkirtMeasurements | TrousersMeasurements,
  view: 'front' | 'back' = 'front',
): string => renderFlat(m, { view }).svg;

describe('half-замеры низа и расстояние от центра', () => {
  it('боковой шов стоит на половине ширины разложенного изделия', () => {
    // Та же ошибка, что у верха, и с теми же последствиями: спутать полуобхват
    // с расстоянием от центра значит удвоить изделие.
    expect(skirt().waistTop.x).toBeCloseTo(SKIRT.waistFlat / 2, 6);
    expect(skirt().hip.x).toBeCloseTo(SKIRT.hipFlat / 2, 6);
    expect(skirt().hem.x).toBeCloseTo(SKIRT.sweepFlat / 2, 6);
    expect(skirt().highHip.x).toBeCloseTo(SKIRT.highHipFlat / 2, 6);
  });

  it('брючина лежит в один слой — её ширина на чертеже равна замеру как есть', () => {
    const g = trousers();
    expect(g.knee!.outer.x - g.knee!.inner.x).toBeCloseTo(TROUSERS.kneeFlat, 6);
    expect(g.legHem!.outer.x - g.legHem!.inner.x).toBeCloseTo(TROUSERS.legOpening, 6);
  });
});

describe('уровни низа отсчитаны от верхнего края пояса', () => {
  it('линия высокого бедра и линия бёдер стоят там, где их меряют', () => {
    // B04 меряется на 10 см ниже верха пояса, B05 — на 18–20. Уровень задан
    // замером, а не долей длины: у длинной и короткой юбки бедро на одном месте.
    expect(skirt().highHip.y).toBeCloseTo(10, 6);
    expect(skirt().hip.y).toBeCloseTo(19, 6);
    expect(trousers().hip.y).toBeCloseTo(19, 6);
  });

  it('шов притачивания пояса стоит на высоте пояса', () => {
    expect(skirt().waistSeam.y).toBeCloseTo(SKIRT.waistbandHeight, 6);
  });

  it('у короткого изделия уровни поджимаются, а не уходят за подол', () => {
    // Линия бедра ниже подола — это шов за пределами изделия. У мини-юбки
    // бедро есть, просто оно близко к краю.
    const mini = skirt({ length: 18 });
    expect(mini.hip.y).toBeLessThan(mini.hem.y);
    expect(mini.highHip.y).toBeLessThan(mini.hip.y);
    expect(mini.waistSeam.y).toBeLessThan(mini.highHip.y);
  });

  it('талия уже бёдер — чертёж повторяет табель', () => {
    expect(skirt().waistTop.x).toBeLessThan(skirt().hip.x);
    expect(trousers().waistTop.x).toBeLessThan(trousers().hip.x);
  });
});

describe('брючины', () => {
  it('точка схождения — разность длин по боковому и шаговому шву', () => {
    // Обе длины на чертеже нарисованы: бок идёт до подола, шаговый — от
    // схождения до него же. Их разность и есть глубина сиденья.
    expect(trousers().crotch!.y).toBeCloseTo(TROUSERS.outseamLength - TROUSERS.inseamLength, 6);
  });

  it('брючина сужается от бедра к колену и к низу', () => {
    const g = trousers();
    expect(g.hip.x).toBeGreaterThan(g.knee!.outer.x);
    expect(g.knee!.outer.x).toBeGreaterThan(g.legHem!.outer.x);
    expect(TROUSERS.kneeFlat).toBeGreaterThan(TROUSERS.legOpening);
  });

  it('длиннее шаговый шов — выше сиденье и длиннее брючина', () => {
    expect(trousers({ inseamLength: 88 }).crotch!.y).toBeLessThan(trousers().crotch!.y);
  });

  it('брючины не перекрываются: внутренний край не заходит за центр', () => {
    // У широких брюк ширина брючины законно больше половины изделия. Поджимается
    // ВНУТРЕННИЙ край, а замер сохраняется: силуэт расходится книзу, как и должен.
    const wide = trousers({ legOpening: 44, kneeFlat: 40 });
    expect(wide.legHem!.inner.x).toBeGreaterThan(0);
    expect(wide.legHem!.outer.x - wide.legHem!.inner.x).toBeCloseTo(44, 6);
    expect(wide.legHem!.outer.x).toBeGreaterThan(wide.hip.x);
  });

  it('точка схождения остаётся ниже линии бёдер даже на несогласованном табеле', () => {
    // Табель мер низа не откалиброван ни одним отшивом, и разность длин может
    // выйти какой угодно. Сиденье выше бёдер — это не брюки, а два отдельных
    // предмета: чертёж обязан остаться изделием.
    const odd = trousers({ inseamLength: 100, outseamLength: 103.7 });
    expect(odd.crotch!.y).toBeGreaterThan(odd.hip.y);
    expect(odd.crotch!.y).toBeLessThan(odd.hem.y);
  });
});

describe('правка замера меняет чертёж — требования R7 и R10', () => {
  it('юбка: любой замер двигает разметку', () => {
    for (const change of [
      { waistFlat: 42 },
      { waistbandHeight: 5 },
      { highHipFlat: 47 },
      { hipFlat: 60 },
      { length: 70 },
      { sweepFlat: 80 },
      { dartLength: 8 },
      { hemAllowance: 5 },
    ] as Partial<SkirtMeasurements>[]) {
      const before = svg(SKIRT) + svg(SKIRT, 'back');
      const after = svg({ ...SKIRT, ...change }) + svg({ ...SKIRT, ...change }, 'back');
      expect(after, JSON.stringify(change)).not.toBe(before);
    }
  });

  it('юбка: молния и шлица живут на спинке и двигаются своими замерами', () => {
    // Спереди их не видно вовсе, поэтому сравнение идёт по виду спинки:
    // на переде разницы не было бы, и тест бы молчал о настоящей ошибке.
    expect(svg({ ...SKIRT, zipLength: 20 }, 'back')).not.toBe(svg(SKIRT, 'back'));
    expect(svg({ ...SKIRT, ventLength: 12 }, 'back')).not.toBe(svg(SKIRT, 'back'));
    expect(svg({ ...SKIRT, zipLength: 20 })).toBe(svg(SKIRT));
  });

  it('брюки: любой замер двигает разметку', () => {
    for (const change of [
      { waistFlat: 42 },
      { waistbandHeight: 5 },
      { highHipFlat: 47 },
      { hipFlat: 62 },
      { frontRise: 12 },
      { backRise: 16 },
      { thighFlat: 40 },
      { kneeFlat: 28 },
      { legOpening: 26 },
      { inseamLength: 84 },
      { outseamLength: 110 },
      { flyLength: 14 },
      { hemAllowance: 4 },
    ] as Partial<TrousersMeasurements>[]) {
      const before = svg(TROUSERS) + svg(TROUSERS, 'back');
      const after = svg({ ...TROUSERS, ...change }) + svg({ ...TROUSERS, ...change }, 'back');
      expect(after, JSON.stringify(change)).not.toBe(before);
    }
  });

  it('посадка зада делает вырез сиденья глубже переднего', () => {
    // Задняя посадка длиннее передней, и лишняя длина живёт в кривой сиденья.
    // Проверяется по нарисованному контуру: у спинки он шире у схождения.
    const reach = (view: 'front' | 'back'): number => {
      const g = trousers();
      const d = buildBottomPaths(TROUSERS, view).paths.outline;
      // Берётся только внутренняя половина: снаружи на этих же уровнях идёт
      // боковой шов, и он на обоих видах один — по нему разницы не увидеть.
      return Math.max(
        ...points(d)
          .filter(
            (p) =>
              p.y > g.crotch!.y &&
              p.y < g.crotch!.y + 10 &&
              Math.abs(p.x) < g.hip.x * 0.5 &&
              Math.abs(p.x) > 0,
          )
          .map((p) => Math.abs(p.x)),
      );
    };
    expect(reach('back')).toBeGreaterThan(reach('front'));
  });
});

describe('деталь появляется от узла, а не сама по себе', () => {
  const without = (part: keyof BottomPathOptions['parts']): BottomPathOptions => ({
    ...DEFAULT_BOTTOM_OPTIONS,
    parts: { ...DEFAULT_BOTTOM_OPTIONS.parts, [part]: false },
  });

  const ids = (m: SkirtMeasurements | TrousersMeasurements, options?: BottomPathOptions) => {
    const built = ['front', 'back'].map((v) =>
      buildBottomPaths(m, v as 'front' | 'back', options ?? DEFAULT_BOTTOM_OPTIONS),
    );
    return built.flatMap((b) => [
      ...b.paths.seams.map((s) => s.id),
      ...b.paths.stitches.map((s) => s.id),
      ...b.paths.pocket.map((s) => s.id),
    ]);
  };

  it('шлёвок и кармана не задаёт ни один замер — их запрашивает узел', () => {
    // Спросить про них табель мер нечего: их там нет. Если бы они рисовались
    // «всегда, раз это брюки», чертёж обещал бы фабрике работу, которой
    // в спецификации не описано.
    expect(ids(TROUSERS)).toContain('belt_loop');
    expect(ids(TROUSERS, without('beltLoops'))).not.toContain('belt_loop');
    expect(ids(TROUSERS, without('sidePocket'))).not.toContain('pocket_opening');
    expect(ids(SKIRT, without('vent'))).not.toContain('vent');
    expect(ids(SKIRT, without('zipBack'))).not.toContain('zip_invisible');
    expect(ids(SKIRT, without('darts'))).not.toContain('dart');
  });

  it('вытачки брюк только на задних половинках — так их и стачивают', () => {
    const front = buildBottomPaths(TROUSERS, 'front').paths.seams.map((s) => s.id);
    const back = buildBottomPaths(TROUSERS, 'back').paths.seams.map((s) => s.id);
    expect(front).not.toContain('dart');
    expect(back).toContain('dart');
  });

  it('гульфик только на переде, а вытачки юбки на обоих видах', () => {
    expect(buildBottomPaths(TROUSERS, 'back').paths.seams.map((s) => s.id)).not.toContain('fly');
    expect(buildBottomPaths(SKIRT, 'front').paths.seams.map((s) => s.id)).toContain('dart');
    expect(buildBottomPaths(SKIRT, 'back').paths.seams.map((s) => s.id)).toContain('dart');
  });

  it('потайная подгибка показана линией сгиба, а не пунктиром отстрочки', () => {
    // С лица строчки нет — так сказано в самом справочнике узлов. Пунктир
    // обещал бы отстрочку, которой не будет.
    const blind = buildBottomPaths(SKIRT, 'front', {
      ...DEFAULT_BOTTOM_OPTIONS,
      hemStitchRows: 0,
    }).paths;
    expect(blind.stitches.map((s) => s.id)).not.toContain('hem');
    expect(blind.seams.map((s) => s.id)).toContain('hem');
  });

  it('число пунктирных линий низа равно числу реальных строчек', () => {
    const rows = (n: number): number =>
      buildBottomPaths(SKIRT, 'front', { ...DEFAULT_BOTTOM_OPTIONS, hemStitchRows: n }).paths
        .stitches.length;
    expect(rows(2)).toBeGreaterThan(rows(1));
  });
});

/** Все опорные точки пути: команды M/L/C состоят из пар координат. */
function points(d: string): { x: number; y: number }[] {
  const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i]!, y: nums[i + 1]! });
  return out;
}

describe('линии не выходят за контур', () => {
  /**
   * Граница изделия на уровне y — по тем же опорным точкам, что и контур.
   *
   * Ломаная лежит ВНУТРИ настоящей линии: кривая между узлами выгнута наружу.
   * Значит проверка строже рисунка, а не слабее — линия, прошедшая её,
   * заведомо внутри.
   */
  const between = (a: { x: number; y: number }, b: { x: number; y: number }, y: number): number =>
    b.y === a.y ? b.x : a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);

  const check = (m: SkirtMeasurements | TrousersMeasurements, view: 'front' | 'back'): string[] => {
    const g = buildBottomGeometry(m);
    const built = buildBottomPaths(m, view);
    const nodes =
      g.kind === 'skirt'
        ? [g.waistTop, g.waistSeam, g.highHip, g.hip, g.hem]
        : [g.waistTop, g.waistSeam, g.highHip, g.hip, g.knee!.outer, g.legHem!.outer];

    const outer = (y: number): number => {
      for (let i = 1; i < nodes.length; i++) {
        if (y <= nodes[i]!.y) return between(nodes[i - 1]!, nodes[i]!, y);
      }
      return nodes[nodes.length - 1]!.x;
    };
    const inner = (y: number): number => {
      if (g.kind === 'skirt' || y <= g.crotch!.y) return 0;
      return y <= g.knee!.inner.y
        ? between(g.crotch!, g.knee!.inner, y)
        : between(g.knee!.inner, g.legHem!.inner, y);
    };

    const bad: string[] = [];
    const named = [
      ...built.paths.seams,
      ...built.paths.stitches,
      ...built.paths.pocket,
      ...built.paths.hidden.map((d, i) => ({ id: `hidden-${i}`, d })),
    ];
    for (const line of named) {
      for (const p of points(line.d)) {
        const eps = 0.01;
        if (Math.abs(p.x) > outer(p.y) + eps || p.y < -eps || p.y > g.hem.y + eps) {
          bad.push(`${view}/${line.id}: (${p.x}, ${p.y}) вне контура`);
        }
        if (Math.abs(p.x) < inner(p.y) - eps) {
          bad.push(`${view}/${line.id}: (${p.x}, ${p.y}) в вырезе между брючинами`);
        }
      }
    }
    return bad;
  };

  it('юбка: каждая линия лежит внутри силуэта', () => {
    expect(check(SKIRT, 'front')).toEqual([]);
    expect(check(SKIRT, 'back')).toEqual([]);
  });

  it('брюки: каждая линия лежит внутри силуэта', () => {
    expect(check(TROUSERS, 'front')).toEqual([]);
    expect(check(TROUSERS, 'back')).toEqual([]);
  });

  it('на широких и на узких брюках тоже', () => {
    for (const m of [
      { ...TROUSERS, legOpening: 44, kneeFlat: 40 },
      { ...TROUSERS, legOpening: 15, kneeFlat: 16 },
      { ...TROUSERS, inseamLength: 30, outseamLength: 55 },
    ] as TrousersMeasurements[]) {
      expect(check(m, 'front')).toEqual([]);
      expect(check(m, 'back')).toEqual([]);
    }
  });
});

describe('пропорции следуют табелю', () => {
  it('каждый снятый с чертежа размер равен табличному', () => {
    const g = skirt();
    expect((2 * g.waistTop.x) / SKIRT.waistFlat).toBeCloseTo(1, 6);
    expect((2 * g.hip.x) / SKIRT.hipFlat).toBeCloseTo(1, 6);
    expect((2 * g.hem.x) / SKIRT.sweepFlat).toBeCloseTo(1, 6);
    expect(g.hem.y / SKIRT.length).toBeCloseTo(1, 6);

    const t = trousers();
    expect((2 * t.hip.x) / TROUSERS.hipFlat).toBeCloseTo(1, 6);
    expect(t.hem.y / TROUSERS.outseamLength).toBeCloseTo(1, 6);
    expect((t.hem.y - t.crotch!.y) / TROUSERS.inseamLength).toBeCloseTo(1, 6);
  });

  it('габарит чертежа считается по самой широкой линии изделия', () => {
    // Лист режется по этим числам: занизить габарит значит обрезать изделие.
    const g = skirt();
    expect(g.bounds.width).toBeCloseTo(SKIRT.sweepFlat / 2, 6);
    expect(g.bounds.bottom).toBeCloseTo(SKIRT.length, 6);
    expect(trousers().bounds.width).toBeCloseTo(TROUSERS.hipFlat / 2, 6);
  });
});

describe('устойчивость и воспроизводимость', () => {
  it('в SVG низа никогда не попадает NaN', () => {
    const odd: TrousersMeasurements[] = [
      { ...TROUSERS, hipFlat: 0.1 },
      { ...TROUSERS, inseamLength: 0 },
      { ...TROUSERS, thighFlat: 0 },
      { ...TROUSERS, frontRise: 0, backRise: 0 },
      { ...TROUSERS, waistbandHeight: 0 },
    ];
    for (const m of [...odd, { ...SKIRT, length: 1 }, { ...SKIRT, sweepFlat: 0 }]) {
      for (const view of ['front', 'back'] as const) {
        expect(svg(m as TrousersMeasurements, view), JSON.stringify(m)).not.toContain('NaN');
      }
    }
  });

  it('одинаковые замеры дают побайтово одинаковый SVG', () => {
    expect(svg(SKIRT)).toBe(svg({ ...SKIRT }));
    expect(svg(TROUSERS)).toBe(svg({ ...TROUSERS }));
  });

  it('спинка не копия переда', () => {
    expect(svg(SKIRT, 'back')).not.toBe(svg(SKIRT));
    expect(svg(TROUSERS, 'back')).not.toBe(svg(TROUSERS));
  });

  it('низ рисуется целиком, а не половиной с зеркалом', () => {
    // Зеркало у верха бесплатно даёт симметрию, но у брюк нарисовало бы
    // вторую застёжку: гульфик лежит на одной стороне.
    expect(svg(TROUSERS)).not.toContain('scale(-1,1)');
  });

  it('боковой вид низа не строится и говорит почему', () => {
    // Глубина изделия выводится из обхвата груди, а у низа груди нет.
    // Молча нарисовать профиль значило бы показать объём, которого не считали.
    expect(() => renderFlat(SKIRT, { view: 'side', depthCm: 20 })).toThrow(/груди/);
  });
});

describe('конвенции линий на чертеже низа', () => {
  const front = svg(TROUSERS);

  it('чертёж послойный: контур, швы, строчки', () => {
    for (const layer of ['outline', 'seams', 'stitches']) {
      expect(front).toContain(`data-layer="${layer}"`);
    }
  });

  it('у каждого шва есть имя — по нему технолог находит узел', () => {
    for (const id of ['waistband', 'fly', 'crotch', 'belt_loop', 'pocket_opening']) {
      expect(front).toContain(`data-line="${id}"`);
    }
    for (const id of ['zip_invisible', 'vent', 'dart']) {
      expect(svg(SKIRT, 'back')).toContain(`data-line="${id}"`);
    }
  });

  it('мешковина кармана показана точками — она под полотном', () => {
    // Скрытое рисуется точечной линией (knowledge-base/02 §3): сплошная
    // означала бы деталь, видимую с лица.
    expect(buildBottomPaths(TROUSERS, 'front').paths.hidden.length).toBeGreaterThan(0);
    expect(front).toContain('stroke-dasharray="0.35 0.55"');
  });
});
