import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { CATEGORIES, kb, type Category, type FitIntent, type ProportionScope } from '@seamster/kb';
import { buildGeometry, flatDefaults, measurementsFrom } from '../src/index.js';
import type { FlatGeometry, FlatMeasurements } from '../src/geometry.js';

/**
 * БЕНЧМАРК ФОРМЫ: чертёж против отраслевой конвенции технических флэтов.
 *
 * Зачем он существует. Остальные тесты чертежа проверяют СВЯЗНОСТЬ: что боковой
 * шов стоит на половине ширины, что правка замера двигает разметку, что деталь
 * без замера не рисуется. Ни один из них не заметит, что изделие В ЦЕЛОМ
 * нарисовано не так, как рисует отрасль: чертёж остаётся внутренне согласованным
 * и при рукавах-крыльях, и при листе вдвое шире своей высоты. Ровно так этот
 * дефект и прожил в продукте до первого взгляда со стороны.
 *
 * Здесь проверяются ПРОПОРЦИИ готового чертежа против диапазонов, снятых
 * с профессиональных флэтов и размерных таблиц производителей. Диапазоны лежат
 * данными (packages/kb/data/flat_conventions.json) вместе с источником и меткой
 * достоверности: число, вбитое в тест, нечем оспорить — через полгода никто
 * не вспомнит, мерил ли его кто-нибудь.
 *
 * Прогон идёт по всем категориям ядра и по всем посадкам: узкое место пропорций —
 * крайние посадки, а не базовая.
 */

const AT = new Date('2026-08-25T00:00:00.000Z');
const FITS = ['fitted', 'semi_fitted', 'loose', 'oversize'] as const;

const base = kb();

const spec = (category: Category, fit: (typeof FITS)[number]) =>
  buildStyleSpec({
    id: `prop-${category}-${fit}`,
    name: category,
    article: 'PROP-1',
    category,
    gender: 'women',
    base_size_ru: 46,
    base_height_cm: 170,
    fit_intent: fit,
    fabric_kind: 'knit',
    size_range: [46],
    generated_at: AT,
  } as unknown as StyleSpecInput).spec;

/** Одно снятое с чертежа число: что мерили, к чему это относится и сколько вышло. */
interface Sample {
  id: string;
  scope: ProportionScope;
  /** Что именно за величина, когда под одним id их несколько. */
  detail: string;
  value: number;
}

/**
 * Снятие пропорций с ПОСТРОЕННОЙ ГЕОМЕТРИИ, а не с замеров.
 *
 * Разница принципиальная: замеры — это то, что мы собирались нарисовать,
 * а геометрия — то, что нарисовано. Ширина рукава под проймой на чертеже
 * меньше замера, и увидеть это можно только здесь.
 */
function samples(m: FlatMeasurements, g: FlatGeometry, fit: FitIntent): Sample[] {
  const sleeveLength = Math.hypot(
    g.sleeveTopEnd.x - g.shoulderPoint.x,
    g.sleeveTopEnd.y - g.shoulderPoint.y,
  );
  const sleeveOpening = Math.hypot(
    g.sleeveBottomEnd.x - g.sleeveTopEnd.x,
    g.sleeveBottomEnd.y - g.sleeveTopEnd.y,
  );
  const chestDrawn = 2 * g.underarm.x;

  // Короткий рукав или длинный — по замеру T10 и по той же границе, что
  // у самого чертежа. Спрашивать справочник, а не сравнивать с числом здесь:
  // граница обязана быть одна на генератор и на его проверку.
  const sleeveScope: ProportionScope =
    base.sleeveAngle(m.sleeveLength, fit).kind === 'long' ? 'long_sleeve' : 'short_sleeve';
  // Низ рукава с манжетой и подшитый — разные величины: манжета стягивает
  // рукав вдвое, и мерить их одной меркой значит гарантированно ошибиться.
  const openingScope: ProportionScope = m.cuffRibHeight === undefined ? sleeveScope : 'cuff_rib';

  const at = (id: string, scope: ProportionScope, detail: string, value: number): Sample => ({
    id,
    scope,
    detail,
    value,
  });

  // У безрукавки нет ни рукава, ни его замеров: пропорции рукава к ней
  // неприменимы, а «ширина плеч» у неё означает расстояние между бретелями
  // и живёт в своём диапазоне.
  const sleeved = !m.sleeveless;

  return [
    // Чертёж в масштабе: каждый снятый размер равен табличному.
    at('drawn_to_spec', 'all', 'T03 ширина по груди', chestDrawn / m.chestFlat),
    at('drawn_to_spec', 'all', 'T05 ширина по низу', (2 * g.hem.x) / m.hemFlat),
    at('drawn_to_spec', 'all', 'T14 ширина горловины', (2 * g.hps.x) / m.neckWidth),
    at('drawn_to_spec', 'all', 'T01 длина изделия', g.hem.y / m.bodyLength),
    ...(sleeved
      ? [
          at('drawn_to_spec', 'all', 'T06 ширина плеч', (2 * g.shoulderPoint.x) / m.shoulderWidth),
          at('drawn_to_spec', 'all', 'T10 длина рукава', sleeveLength / m.sleeveLength),
          at('drawn_to_spec', 'all', 'T13 низ рукава', sleeveOpening / m.sleeveOpening),
        ]
      : []),

    // Пропорции формы. Ширина листа берётся по габариту построенной геометрии —
    // по тем самым крайним точкам, между которыми лист и растягивается.
    at('body_length_over_chest', 'all', 'T01 к T03', g.hem.y / chestDrawn),
    // Низ трикотажного изделия собран рибаной и шире груди не бывает.
    at('hem_over_chest', 'all', 'T05 к T03', (2 * g.hem.x) / chestDrawn),
    // --- конвенции формы из набора реальных техпаков --------------------
    ...(m.hoodHeight !== undefined && g.hoodSide
      ? [
          at(
            'hood_height_over_view',
            'hood',
            'высота капюшона к высоте вида',
            // Высота НАРИСОВАННОГО капюшона, а не замера H01: на чертеже он
            // показан лежащим за спиной и виден не целиком.
            -g.hoodTop!.y / (-g.hoodTop!.y + g.hem.y),
          ),
          // Основание капюшона — там, где он втачан: ширина горловины.
          // Ширина самого капюшона берётся в его широкой части, поэтому
          // сравнивать надо именно основание, а не габарит детали.
          at(
            'hood_base_over_neck',
            'hood',
            'основание капюшона к ширине горловины',
            (2 * g.hps.x) / m.neckWidth,
          ),
        ]
      : []),
    ...(m.waistRibHeight !== undefined
      ? [
          at(
            'rib_over_body_length',
            'waist_rib',
            'высота пояса к длине изделия',
            m.waistRibHeight / m.bodyLength,
          ),
        ]
      : []),
    ...(m.cuffRibHeight !== undefined
      ? [at('cuff_over_bicep', 'cuff_rib', 'T13 к T12', m.sleeveOpening / m.bicep)]
      : []),
    ...(sleeved
      ? [
          at('drawing_aspect', sleeveScope, 'размах к длине', (2 * g.bounds.width) / g.hem.y),
          at(
            'sleeve_angle_deg',
            sleeveScope,
            'верхний сгиб к горизонтали',
            (g.sleeveAngle * 180) / Math.PI,
          ),
          at('shoulder_over_chest', 'all', 'T06 к T03', (2 * g.shoulderPoint.x) / chestDrawn),
          at('sleeve_length_over_body_length', sleeveScope, 'T10 к T01', sleeveLength / g.hem.y),
          at('sleeve_opening_over_chest', openingScope, 'T13 к T03', sleeveOpening / chestDrawn),
        ]
      : []),
  ];
}

const CASES = CATEGORIES.flatMap((category) =>
  FITS.map((fit) => {
    const s = spec(category, fit);
    const d = flatDefaults(s, base);
    // Условности рисунка подмешиваются так же, как это делает renderFlat:
    // бенчмарк обязан мерить ТО ЖЕ, что уходит в документ, а не голые замеры.
    const m: FlatMeasurements = {
      ...measurementsFrom(s),
      ...(d.hoodDrawFactor === undefined ? {} : { hoodDrawFactor: d.hoodDrawFactor }),
    };
    const g = buildGeometry(m, 'front', d.minSleeveAngleDeg);
    return { category, fit, m, g, name: `${category} · ${fit}` };
  }),
);

const round = (n: number): string => (Math.round(n * 1000) / 1000).toString();

describe('бенчмарк пропорций технического чертежа', () => {
  describe.each(CASES)('$name', ({ m, g, fit }) => {
    const taken = samples(m, g, fit);
    // Посадка изделия в терминах конвенций: свободная идёт по регулярной —
    // расширенная прибавка ещё не делает силуэт boxy.
    const fitClass = fit === 'oversize' ? 'oversize' : 'regular';

    for (const p of base.flatProportions()) {
      // Диапазон, объявленный для другой посадки, к этому изделию не относится.
      if (p.fit_class !== undefined && p.fit_class !== fitClass) continue;
      const mine = taken.filter((s) => s.id === p.id && s.scope === p.scope);
      // Пропорция не про это изделие: рукав другой длины, манжеты нет.
      if (mine.length === 0) continue;

      it(`${p.label_ru} (${p.scope})`, () => {
        for (const s of mine) {
          // Сообщение обязано читаться без чтения кода: величина, её значение,
          // диапазон конвенции и откуда он взят. Падение этого теста — разговор
          // с человеком, который держит в руках профессиональный флэт.
          const message =
            `${p.label_ru} — ${s.detail}: ${round(s.value)}, ` +
            `конвенция ${p.min}–${p.max} (${p.source})`;
          // Допуск на округление: движок ставит угол РОВНО по конвенции,
          // и 29.999999999999996 — это те же 30°, а не нарушение диапазона.
          const eps = 1e-6;
          expect(s.value, message).toBeGreaterThanOrEqual(p.min - eps);
          expect(s.value, message).toBeLessThanOrEqual(p.max + eps);
        }
      });
    }
  });

  it('каждый диапазон из справочника кем-то проверяется', () => {
    // Диапазон, под который не подошло ни одно изделие ядра, — мёртвые данные:
    // он выглядит проверкой и ничего не проверяет.
    const covered = new Set(
      CASES.flatMap(({ m, g, fit }) =>
        samples(m, g, fit).map(
          (s) => `${s.id}|${s.scope}|${fit === 'oversize' ? 'oversize' : 'regular'}`,
        ),
      ),
    );
    const dead = base
      .flatProportions()
      .filter((p) =>
        p.fit_class === undefined
          ? !['oversize', 'regular'].some((f) => covered.has(`${p.id}|${p.scope}|${f}`))
          : !covered.has(`${p.id}|${p.scope}|${p.fit_class}`),
      )
      .map((p) => `${p.id}|${p.scope}${p.fit_class ? `|${p.fit_class}` : ''}`);
    expect(dead).toEqual([]);
  });

  it('подтверждённый диапазон говорит, чем подтверждён', () => {
    // Схема требует gap у непроверенного. Здесь ловится обратное: флаг verified,
    // поднятый заодно с правкой числа, без единого источника за ним.
    for (const p of base.flatProportions()) {
      if (p.verified) expect(p.note_ru?.length ?? 0, `${p.id}|${p.scope}`).toBeGreaterThan(20);
      else expect(p.gap?.length ?? 0, `${p.id}|${p.scope}`).toBeGreaterThan(20);
    }
  });
});

describe('условность отведения рукава остаётся минимумом', () => {
  it('длинный рукав опускается вдоль корпуса круче короткого', () => {
    // Граница проходит по замеру T10, а не по названию категории.
    expect(base.sleeveAngle(58, 'oversize').min_angle_deg).toBeGreaterThan(
      base.sleeveAngle(20, 'oversize').min_angle_deg,
    );
  });

  it('угол — функция посадки: у oversize рукав ближе к корпусу', () => {
    // Пять реальных техпаков худи: oversize и boxy дают 58–66°, регулярная
    // посадка — 30–45°. Усреднить их одним числом нельзя: средний угол
    // неверен для обеих, и именно это делал прежний справочник.
    const over = base.sleeveAngle(58, 'oversize');
    const regular = base.sleeveAngle(58, 'semi_fitted');
    expect(over.min_angle_deg).toBeGreaterThan(regular.max_angle_deg);
    expect(over.verified && regular.verified).toBe(true);
  });

  it('точный угол укладки сохраняется рядом с нарисованным', () => {
    // Документ обязан сказать, что чертёж отличается от точной укладки: иначе
    // технолог получит право снять ширину рукава с картинки.
    const { g } = CASES.find((c) => c.category === 'hoodie')!;
    expect(g.solvedSleeveAngle).toBeLessThan(g.sleeveAngle);
  });

  it('узкий рукав при глубокой пройме сам даёт крутой угол, и условность отступает', () => {
    // Условность — МИНИМУМ, а не замена расчёту. Подменять ею точную укладку
    // значило бы потерять точность там, где она достижима.
    const { m } = CASES.find((c) => c.category === 'hoodie')!;
    const narrow = buildGeometry({ ...m, bicep: 6 }, 'front', 65);
    expect(narrow.sleeveAngle).toBe(narrow.solvedSleeveAngle);
    expect((narrow.sleeveAngle * 180) / Math.PI).toBeGreaterThan(65);
  });
});
