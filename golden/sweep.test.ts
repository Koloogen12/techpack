import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamsterly/assembly';
import { measurementsFrom, measuredBicep, buildGeometry, renderFlat } from '@seamsterly/flats';
import { renderHtml } from '@seamsterly/docgen';
import { checkSpec } from './invariants.js';

/**
 * Систематический перебор пространства входов.
 *
 * Голден-сет проверяет отобранные сценарии. Здесь — сетка: все сочетания
 * пола, посадки, размера, роста и материала. Задача не «поймать конкретный
 * баг», а убедиться, что пригодность документа не зависит от того, какой
 * угол пространства выбрал пользователь.
 *
 * Перебор детерминированный, а не случайный: падение обязано воспроизводиться
 * с первого раза, иначе его нельзя чинить.
 */

const AT = new Date('2026-08-25T00:00:00.000Z');

const CATEGORIES = ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'] as const;
const GENDERS = ['women', 'men'] as const;
const FITS = ['fitted', 'semi_fitted', 'loose', 'oversize'] as const;
const HEIGHTS = [152, 164, 170, 176, 188] as const;
const SIZES = {
  women: [42, 44, 46, 48, 50, 52],
  men: [44, 46, 48, 50, 52, 54, 56],
} as const;

interface Case {
  label: string;
  input: StyleSpecInput;
}

const CASES: Case[] = [];
for (const category of CATEGORIES) {
  for (const gender of GENDERS) {
    for (const fit of FITS) {
      for (const height of HEIGHTS) {
        for (const size of SIZES[gender]) {
          CASES.push({
            label: `${category} ${gender} RU${size} ${fit} рост${height}`,
            input: {
              id: `sweep-${category}-${gender}-${size}-${fit}-${height}`,
              name: 'Перебор',
              article: `SW-${size}`,
              category,
              gender,
              base_size_ru: size,
              base_height_cm: height,
              fit_intent: fit,
              fabric_kind: 'knit',
              size_range: [...SIZES[gender]],
              generated_at: AT,
            },
          });
        }
      }
    }
  }
}

describe('перебор пространства входов', () => {
  it(`покрывает ${CASES.length} сочетаний категории, пола, посадки, размера и роста`, () => {
    expect(CASES.length).toBeGreaterThan(800);
  });

  it('ни одно сочетание не нарушает инвариантов продукта', () => {
    const broken: string[] = [];
    for (const c of CASES) {
      try {
        const { spec } = buildStyleSpec(c.input);
        for (const v of checkSpec(spec)) broken.push(`${c.label} → ${v.rule}: ${v.detail}`);
      } catch (e) {
        broken.push(`${c.label} → упало: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Показываем первые нарушения целиком: отчёт читает человек.
    expect(broken.slice(0, 12)).toEqual([]);
  });

  it('чертёж строится на каждом сочетании и не вырождается', () => {
    const broken: string[] = [];
    for (const c of CASES) {
      const { spec } = buildStyleSpec(c.input);
      const m = measurementsFrom(spec);

      for (const view of ['front', 'back'] as const) {
        const g = buildGeometry(m, view);

        if (!Number.isFinite(g.sleeveAngle))
          broken.push(`${c.label}/${view}: угол рукава не число`);
        if (g.bounds.width <= 0 || g.bounds.bottom <= g.bounds.top) {
          broken.push(`${c.label}/${view}: нулевой габарит`);
        }
        // Плечевая точка обязана быть внутри изделия, иначе плечо шире корпуса.
        if (g.shoulderPoint.x > g.underarm.x) {
          broken.push(
            `${c.label}/${view}: плечо (${g.shoulderPoint.x.toFixed(1)}) шире бока (${g.underarm.x.toFixed(1)})`,
          );
        }
        // Горловина обязана быть уже плеча.
        if (g.hps.x >= g.shoulderPoint.x) {
          broken.push(`${c.label}/${view}: горловина шире плеча`);
        }
        // Пройма обязана быть выше низа.
        if (g.underarm.y >= g.hem.y) {
          broken.push(`${c.label}/${view}: пройма ниже низа изделия`);
        }
        // Рукав обязан выходить наружу от корпуса.
        if (g.sleeveTopEnd.x <= g.shoulderPoint.x) {
          broken.push(`${c.label}/${view}: рукав не выходит за плечо`);
        }
        if (renderFlat(m, { view }).svg.includes('NaN')) {
          broken.push(`${c.label}/${view}: NaN в чертеже`);
        }
      }
    }
    expect(broken.slice(0, 12)).toEqual([]);
  });

  it('ширина рукава на чертеже совпадает с таблицей или честно уходит в дефолт', () => {
    const mismatched: string[] = [];
    for (const c of CASES) {
      const { spec } = buildStyleSpec(c.input);
      const m = measurementsFrom(spec);
      const g = buildGeometry(m, 'front');
      const drawn = measuredBicep(g);
      // Расхождение допустимо только там, где решатель не сошёлся и взял
      // безопасный угол: это видно по тому, что угол равен ровно дефолтному.
      const isFallback = Math.abs(g.sleeveAngle - (20 * Math.PI) / 180) < 1e-9;
      if (!isFallback && Math.abs(drawn - m.bicep) > 0.05) {
        mismatched.push(`${c.label}: на чертеже ${drawn.toFixed(2)}, в таблице ${m.bicep}`);
      }
    }
    expect(mismatched.slice(0, 12)).toEqual([]);
  });

  it('документ собирается на каждом сочетании без мусора', () => {
    const broken: string[] = [];
    for (const c of CASES) {
      const { spec } = buildStyleSpec(c.input);
      const html = renderHtml(spec, { pro: true });
      for (const bad of ['NaN', 'undefined', '[object Object]']) {
        if (html.includes(bad)) broken.push(`${c.label}: «${bad}» в документе`);
      }
      if (!html.includes('data-section="measurements"')) {
        broken.push(`${c.label}: нет табеля мер`);
      }
    }
    expect(broken.slice(0, 12)).toEqual([]);
  });
});

describe('края размерного ряда', () => {
  const at = (size: number, range: number[]): StyleSpecInput => ({
    id: `edge-${size}`,
    name: 'Край',
    article: 'EDGE',
    category: 'tshirt',
    gender: 'women',
    base_size_ru: size,
    base_height_cm: 170,
    fit_intent: 'semi_fitted',
    fabric_kind: 'knit',
    size_range: range,
    generated_at: AT,
  });

  it('градация от нижнего края ряда не даёт отрицательных размеров', () => {
    const { spec } = buildStyleSpec(at(42, [42, 44, 46, 48, 50, 52]));
    for (const p of spec.measurements.points) {
      for (const g of p.graded) expect(g.value.value, `${p.code}/${g.ru}`).toBeGreaterThan(0);
    }
  });

  it('градация от верхнего края ряда идёт вниз и остаётся правдоподобной', () => {
    const { spec } = buildStyleSpec(at(52, [42, 44, 46, 48, 50, 52]));
    expect(checkSpec(spec).map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  });

  it('длинный ряд из десяти размеров не накапливает ошибку до бессмыслицы', () => {
    const long = [40, 42, 44, 46, 48, 50, 52, 54, 56, 58];
    const { spec } = buildStyleSpec(at(48, long));
    expect(checkSpec(spec).map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  });
});
