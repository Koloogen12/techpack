import { describe, expect, it } from 'vitest';
import { isSeamsterlyError } from '@seamsterly/core';
import { buildStyleSpec, type StyleSpecInput } from '@seamsterly/assembly';
import { kb } from '@seamsterly/kb';
import type { StyleSpec } from '@seamsterly/stylespec';
import {
  ACCEPTANCE,
  anchorSuspect,
  calibrate,
  compare,
  effectiveValue,
  parseMeasuredSet,
  passes,
  renderMeasurementForm,
  type MeasuredSet,
} from '../src/index.js';

const AT = new Date('2026-08-25T00:00:00.000Z');

const INPUT: StyleSpecInput = {
  id: 'fit-test',
  name: 'Базовая футболка',
  article: 'FIT-001',
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
  generated_at: AT,
};

const SPEC: StyleSpec = buildStyleSpec(INPUT).spec;

/**
 * Синтетический бланк: берём то, что выдал пайплайн, и вносим известное
 * отклонение. Так проверяется не «совпало ли», а работает ли сам механизм
 * сравнения и находит ли калибровка тот снос, который мы туда положили.
 */
function measuredFrom(
  spec: StyleSpec,
  bias: (code: string, value: number) => number,
  over: Partial<MeasuredSet> = {},
): MeasuredSet {
  return parseMeasuredSet({
    id: 'synthetic',
    photo: 'golden/photos/tshirt-front.png',
    answers: 'golden/answers/tshirt-women-46.json',
    measured_by: 'тест',
    measured_at: '2026-08-26',
    method: 'flat_tape',
    values: spec.measurements.points.map((p) => ({
      code: p.code,
      value_cm: Math.round(bias(p.code, p.base.value) * 10) / 10,
    })),
    ...over,
  });
}

const exact = measuredFrom(SPEC, (_, v) => v);

describe('бланк замеров', () => {
  it('точка, измеренная дважды под одним кодом, отвергается', () => {
    expect(() =>
      parseMeasuredSet({
        ...exact,
        values: [
          { code: 'T01', value_cm: 69 },
          { code: 'T01', value_cm: 70 },
        ],
      }),
    ).toThrow();
  });

  it('два расходящихся замера одной точки отвергаются — мерили по-разному', () => {
    try {
      parseMeasuredSet({
        ...exact,
        values: [{ code: 'T03', value_cm: 51, repeat_cm: 56 }],
      });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e)).toBe(true);
      if (isSeamsterlyError(e)) expect(e.details.issues).toContain('перемерьте');
    }
  });

  it('близкие замеры принимаются и усредняются', () => {
    const set = parseMeasuredSet({
      ...exact,
      values: [{ code: 'T03', value_cm: 51, repeat_cm: 51.6 }],
    });
    expect(effectiveValue(set.values[0]!)).toBeCloseTo(51.3, 5);
  });

  it('замер без снимка и без анкеты не принимается', () => {
    const { photo: _p, ...noPhoto } = exact;
    expect(() => parseMeasuredSet(noPhoto)).toThrow();
  });
});

describe('метрика — попадание в допуск, а не сантиметры', () => {
  it('точное совпадение даёт сто процентов', () => {
    const r = compare(SPEC, exact);
    expect(r.in_tolerance_rate).toBe(1);
    expect(r.misses).toEqual([]);
    expect(passes(r)).toBe(true);
  });

  it('одна и та же ошибка в сантиметрах судится по-разному на разных точках', () => {
    // 0.8 см при допуске ±1.0 — в допуске. Те же 0.8 при ±0.3 — мимо втрое.
    const shifted = measuredFrom(SPEC, (code, v) =>
      code === 'T03' || code === 'T14' ? v - 0.8 : v,
    );
    const r = compare(SPEC, shifted);

    const chest = r.points.find((p) => p.code === 'T03')!;
    const neck = r.points.find((p) => p.code === 'T14')!;

    expect(chest.tolerance_cm).toBeGreaterThan(neck.tolerance_cm);
    expect(chest.verdict).toBe('in_tolerance');
    expect(neck.verdict).toBe('out_of_tolerance');
    expect(Math.abs(chest.delta_cm!)).toBeCloseTo(Math.abs(neck.delta_cm!), 5);
  });

  it('промах чуть за границей помечается «на грани», а не провалом', () => {
    const r = compare(
      SPEC,
      measuredFrom(SPEC, (code, v) => (code === 'T03' ? v - 1.2 : v)),
    );
    expect(r.points.find((p) => p.code === 'T03')!.verdict).toBe('near_miss');
  });

  it('неизмеренные точки не портят метрику, но и не улучшают её', () => {
    const partial = parseMeasuredSet({
      ...exact,
      values: exact.values.slice(0, 3),
    });
    const r = compare(SPEC, partial);
    expect(r.compared).toBe(3);
    expect(r.points.filter((p) => p.verdict === 'not_measured').length).toBeGreaterThan(10);
  });

  it('знаковый снос отличается от средней ошибки', () => {
    const scattered = compare(
      SPEC,
      measuredFrom(SPEC, (_, v) => v + (Math.round(v) % 2 === 0 ? 0.6 : -0.6)),
    );
    const systematic = compare(
      SPEC,
      measuredFrom(SPEC, (_, v) => v - 0.6),
    );

    // Средняя ошибка одинакова, но снос показывает разницу.
    expect(scattered.mean_abs_error_cm).toBeCloseTo(systematic.mean_abs_error_cm, 1);
    expect(Math.abs(scattered.mean_bias_cm)).toBeLessThan(Math.abs(systematic.mean_bias_cm));
  });

  it('положительное отклонение означает, что завысили мы', () => {
    const r = compare(
      SPEC,
      measuredFrom(SPEC, (code, v) => (code === 'T01' ? v - 3 : v)),
    );
    expect(r.points.find((p) => p.code === 'T01')!.delta_cm).toBeGreaterThan(0);
  });
});

describe('порог приёмки', () => {
  it('набор с грубым промахом не принимается даже при высокой доле', () => {
    const r = compare(
      SPEC,
      measuredFrom(SPEC, (code, v) => (code === 'T03' ? v - 5 : v)),
    );
    expect(r.in_tolerance_rate).toBeGreaterThan(ACCEPTANCE.min_in_tolerance_rate);
    expect(passes(r)).toBe(false);
  });

  it('пустой набор не принимается — сравнивать было нечего', () => {
    expect(passes({ ...compare(SPEC, exact), compared: 0 })).toBe(false);
  });
});

describe('калибровка справочника', () => {
  const biased = (n: number, factor: number) =>
    Array.from({ length: n }, () =>
      compare(
        SPEC,
        measuredFrom(SPEC, (code, v) => (code === 'T01' ? v / factor : v)),
      ),
    );

  it('находит внесённый снос и предлагает обратный множитель', () => {
    // Кладём известное завышение на 8% и требуем, чтобы калибровка его нашла.
    const report = calibrate(biased(5, 1.08));
    const hint = report.hints.find((h) => h.code === 'T01');

    expect(hint).toBeDefined();
    expect(hint!.relative_bias).toBeCloseTo(0.08, 2);
    expect(hint!.suggested_ratio_factor).toBeCloseTo(1 / 1.08, 2);
    expect(hint!.reason_ru).toContain('завышаем');
  });

  it('молчит на двух изделиях — это совпадение, а не закономерность', () => {
    const report = calibrate(biased(2, 1.08));
    expect(report.hints).toEqual([]);
    expect(report.watch.map((w) => w.code)).toContain('T01');
  });

  it('молчит на мелком сносе — это шум измерения', () => {
    expect(calibrate(biased(5, 1.01)).hints).toEqual([]);
  });

  it('не выдаёт подсказку, если знак сноса скачет', () => {
    const mixed = [1.1, 0.9, 1.1, 0.9, 1.1].map((f) =>
      compare(
        SPEC,
        measuredFrom(SPEC, (code, v) => (code === 'T01' ? v / f : v)),
      ),
    );
    expect(calibrate(mixed).hints.find((h) => h.code === 'T01')).toBeUndefined();
  });

  it('снос по многим точкам сразу указывает на якорь, а не на отношения', () => {
    const all = Array.from({ length: 5 }, () =>
      compare(
        SPEC,
        measuredFrom(SPEC, (_, v) => v / 1.09),
      ),
    );
    const report = calibrate(all);
    expect(report.hints.length).toBeGreaterThan(4);
    expect(anchorSuspect(report)).toContain('якоре масштаба');
  });

  it('на одной точке предупреждения про якорь нет', () => {
    expect(anchorSuspect(calibrate(biased(5, 1.08)))).toBeNull();
  });
});

describe('печатный бланк', () => {
  const base = kb();

  it('точки идут в порядке измерения, а не в порядке кодов', () => {
    const html = renderMeasurementForm({ category: 'tshirt' }, base);
    // Длина меряется первой, ширина по груди — после верха изделия.
    expect(html.indexOf('>T01<')).toBeLessThan(html.indexOf('>T03<'));
    expect(html.indexOf('>T14<')).toBeLessThan(html.indexOf('>T03<'));
    expect(html.indexOf('>T03<')).toBeLessThan(html.indexOf('>T10<'));
  });

  it('несёт правила измерения — без них бланк бесполезен', () => {
    const html = renderMeasurementForm({ category: 'tshirt' }, base);
    expect(html).toContain('Не растягивайте');
    expect(html).toContain('половина обхвата');
    expect(html).toContain('Сфотографируйте');
  });

  it('у каждой точки написано, как её мерить', () => {
    const html = renderMeasurementForm({ category: 'hoodie' }, base);
    for (const p of base.pomTemplate('hoodie').points) {
      expect(html, p.code).toContain(p.how_to_measure_ru);
    }
  });

  it('быстрый бланк короче полного', () => {
    const full = renderMeasurementForm({ category: 'hoodie' }, base);
    const quick = renderMeasurementForm({ category: 'hoodie', requiredOnly: true }, base);
    expect(quick.length).toBeLessThan(full.length);
  });

  it('у худи есть точки капюшона и кармана', () => {
    const html = renderMeasurementForm({ category: 'hoodie' }, base);
    expect(html).toContain('Высота капюшона');
    expect(html).toContain('кармана кенгуру');
  });

  it('пользовательский текст экранируется', () => {
    expect(
      renderMeasurementForm({ category: 'tshirt', title: '<script>x</script>' }, base),
    ).not.toContain('<script>x</script>');
  });
});

describe('предел разрешения рулетки', () => {
  // Найдено на демонстрационном прогоне: на мелких точках относительный снос
  // доминирует погрешность чтения. 0.3 см на бейке высотой 2 см выглядят
  // как 15% и просятся в подсказку, хотя это ровно та точность,
  // с которой человек читает ленту.
  const tinyShift = (n: number, shiftCm: number) =>
    Array.from({ length: n }, () =>
      compare(
        SPEC,
        measuredFrom(SPEC, (code, v) => (code === 'T17' ? v - shiftCm : v)),
      ),
    );

  it('снос меньше половины сантиметра не даёт подсказки, как бы велик ни был процент', () => {
    const report = calibrate(tinyShift(5, 0.3));
    expect(report.hints.find((h) => h.code === 'T17')).toBeUndefined();
  });

  it('заметный снос на той же мелкой точке подсказку даёт', () => {
    const report = calibrate(tinyShift(5, 0.8));
    expect(report.hints.find((h) => h.code === 'T17')).toBeDefined();
  });

  it('на крупных точках правило не мешает — там снос и в процентах, и в сантиметрах', () => {
    const report = calibrate(
      Array.from({ length: 5 }, () =>
        compare(
          SPEC,
          measuredFrom(SPEC, (code, v) => (code === 'T01' ? v / 1.08 : v)),
        ),
      ),
    );
    expect(report.hints.find((h) => h.code === 'T01')).toBeDefined();
  });
});

describe('бланк замеров на трёх языках', () => {
  /**
   * Самый ответственный текст продукта. Мерит тот, у кого изделие в руках,
   * и это бывает иностранная фабрика: правила измерения на незнакомом языке
   * означают, что мерить будут как привыкли, а не как здесь написано.
   */
  it.each(['ru', 'en', 'zh'] as const)('%s собирается', (locale) => {
    expect(renderMeasurementForm({ category: 'hoodie', locale }).length).toBeGreaterThan(1000);
  });

  it.each(['en', 'zh'] as const)('в %s не осталось кириллицы', (locale) => {
    const html = renderMeasurementForm({ category: 'hoodie', locale })
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ');
    expect(html.match(/[а-яА-ЯёЁ]{3,}/g) ?? []).toEqual([]);
  });

  it('правила измерения переведены целиком, а не наполовину', () => {
    // Шесть правил, и каждое отвечает за свой источник систематической
    // ошибки: натяжение, манекен, провисание ленты, удвоение половины
    // обхвата, разное понимание точки, отсутствие снимка.
    for (const locale of ['ru', 'en', 'zh'] as const) {
      const html = renderMeasurementForm({ category: 'hoodie', locale });
      expect((html.match(/<li>/g) ?? []).length).toBe(6);
    }
  });

  it('китайский бланк называет точки иероглифами', () => {
    const html = renderMeasurementForm({ category: 'hoodie', locale: 'zh' });
    expect(html).toContain('肩宽');
    expect(html).toContain('平铺');
  });
});
