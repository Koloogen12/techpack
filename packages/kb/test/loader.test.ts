import { describe, expect, it } from 'vitest';
import { isSpecFormError } from '@specform/core';
import { KnowledgeBase, kb } from '../src/index.js';

const base = kb();

describe('загрузка справочников', () => {
  it('все файлы проходят валидацию схем', () => {
    expect(() => KnowledgeBase.load()).not.toThrow();
  });

  it('шаблон есть для футболки', () => {
    expect(base.supportedCategories()).toContain('tshirt');
  });
});

describe('размерные сетки', () => {
  it('RU = обхват груди / 2 — правило выдержано во всей женской сетке', () => {
    for (const row of base.sizeChart('women').rows) {
      expect(row.ru).toBe(row.chest / 2);
    }
  });

  it('RU = обхват груди / 2 — и в мужской', () => {
    for (const row of base.sizeChart('men').rows) {
      expect(row.ru).toBe(row.chest / 2);
    }
  });

  it('женская EU = RU − 6, мужская EU = RU', () => {
    for (const row of base.sizeChart('women').rows) expect(row.eu).toBe(row.ru - 6);
    for (const row of base.sizeChart('men').rows) expect(row.eu).toBe(row.ru);
  });

  it('шаг по груди выдержан и совпадает с заявленным', () => {
    for (const gender of ['women', 'men'] as const) {
      const chart = base.sizeChart(gender);
      const chests = chart.rows.map((r) => r.chest);
      for (let i = 1; i < chests.length; i++) {
        expect(chests[i]! - chests[i - 1]!).toBe(chart.chest_step);
      }
    }
  });

  it('48 — это M у мужчин, 46 — M у женщин', () => {
    expect(base.bodyMeasurements('men', 48).int).toBe('M');
    expect(base.bodyMeasurements('women', 46).int).toBe('M');
  });

  it('несуществующий размер даёт ошибку со списком доступных', () => {
    try {
      base.bodyMeasurements('women', 60);
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSpecFormError(e)).toBe(true);
      if (isSpecFormError(e)) {
        expect(e.userAction).toContain('42');
        expect(e.userAction).toContain('52');
      }
    }
  });
});

describe('прибавки на свободу облегания', () => {
  it('растут от прилегающей к oversize', () => {
    const fits = ['fitted', 'semi_fitted', 'loose', 'oversize'] as const;
    const values = fits.map((f) => base.easeFor('tshirt', f, 'knit').entry.default);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(fits.length);
  });

  it('прилегающее худи откатывается к обычной посадке и сообщает об этом', () => {
    const lookup = base.easeFor('hoodie', 'fitted', 'knit');
    expect(lookup.fallbackFrom).toBe('fitted');
    expect(lookup.entry.fit).toBe('semi_fitted');
  });

  it('точное совпадение не помечается откатом', () => {
    expect(base.easeFor('tshirt', 'fitted', 'knit').fallbackFrom).toBeUndefined();
  });

  it('худи свободнее футболки при той же посадке — иначе перепутаны категории', () => {
    const tee = base.easeFor('tshirt', 'loose', 'knit').entry.default;
    const hoodie = base.easeFor('hoodie', 'loose', 'knit').entry.default;
    expect(hoodie).toBeGreaterThan(tee);
  });
});

describe('допуски', () => {
  it('у трикотажа не жёстче, чем у ткани', () => {
    for (const cls of ['major_width', 'length', 'medium', 'minor'] as const) {
      expect(base.toleranceFor(cls, 'knit')).toBeGreaterThanOrEqual(
        base.toleranceFor(cls, 'woven'),
      );
    }
  });

  it('крупные точки допускают больший разброс, чем мелкие', () => {
    expect(base.toleranceFor('major_width', 'knit')).toBeGreaterThan(
      base.toleranceFor('minor', 'knit'),
    );
  });
});

describe('градация', () => {
  it('ширины корпуса растут на половину шага сетки', () => {
    // Обхват груди шагает на 4 см, значит half-замер — на 2 см.
    expect(base.gradingRule('body_width').per_size).toBe(base.chestStep() / 2);
  });

  it('правило «не градуируется» действительно нулевое', () => {
    const none = base.gradingRule('none');
    expect(none.per_size).toBe(0);
    expect(none.per_height).toBe(0);
  });

  it('каждая точка шаблона ссылается на существующее правило', () => {
    for (const point of base.pomTemplate('tshirt').points) {
      expect(() => base.gradingRule(point.grading_key)).not.toThrow();
    }
  });
});

describe('шаблон точек измерения футболки', () => {
  const tpl = base.pomTemplate('tshirt');

  it('содержит 18 точек и ровно один якорь масштаба', () => {
    expect(tpl.points).toHaveLength(18);
    expect(tpl.points.filter((p) => p.derivation === 'anchor')).toHaveLength(1);
  });

  it('якорь — ширина по груди, и это half-замер', () => {
    const anchor = tpl.points.find((p) => p.derivation === 'anchor')!;
    expect(anchor.code).toBe('T03');
    expect(anchor.measure_kind).toBe('half');
  });

  it('каждая точка объясняет, как её мерить — новичок не знает терминов', () => {
    for (const p of tpl.points) {
      expect(p.how_to_measure_ru.length).toBeGreaterThan(10);
      expect(p.name_ru).not.toMatch(/^[A-Za-z ]+$/);
    }
  });

  it('у каждой точки-пропорции есть отношение внутри своего диапазона', () => {
    for (const p of tpl.points.filter(
      (x) => x.derivation === 'ratio_to_anchor' || x.derivation === 'independent',
    )) {
      expect(p.baseline_ratio, p.code).toBeDefined();
      expect(p.ratio_range, p.code).toBeDefined();
      expect(p.baseline_ratio!).toBeGreaterThanOrEqual(p.ratio_range!.min);
      expect(p.baseline_ratio!).toBeLessThanOrEqual(p.ratio_range!.max);
    }
  });

  it('составная точка ссылается только на существующие точки шаблона', () => {
    const codes = new Set(tpl.points.map((p) => p.code));
    for (const p of tpl.points.filter((x) => x.derivation === 'composed')) {
      expect(p.composed_of, p.code).toBeDefined();
      for (const part of p.composed_of!) {
        expect(codes, `${p.code} → ${part.code}`).toContain(part.code);
        // Ссылка на другую составную точку создала бы порядок вычисления,
        // который движок не гарантирует.
        const target = tpl.points.find((x) => x.code === part.code)!;
        expect(target.derivation, `${p.code} → ${part.code}`).not.toBe('composed');
      }
    }
  });

  it('каждая точка объявляет, за чем следует её величина', () => {
    for (const p of tpl.points.filter((x) => x.derivation === 'ratio_to_anchor')) {
      expect(['garment', 'body', 'height'], p.code).toContain(p.anchor_basis);
    }
    const byCode = new Map(tpl.points.map((p) => [p.code, p]));
    // Длины изделия и рукава следуют за РОСТОМ: человек на четыре размера
    // больше не имеет рук на четверть длиннее — он шире.
    for (const code of ['T01', 'T02', 'T10']) {
      expect(byCode.get(code)!.anchor_basis, code).toBe('height');
    }
    // Горловина и наклон плеча следуют за обхватом тела.
    for (const code of ['T14', 'T15', 'T16', 'T18']) {
      expect(byCode.get(code)!.anchor_basis, code).toBe('body');
    }
    // Ширины следуют за изделием.
    for (const code of ['T04', 'T05', 'T06', 'T07', 'T08', 'T12', 'T13']) {
      expect(byCode.get(code)!.anchor_basis, code).toBe('garment');
    }
  });

  it('обязательных точек хватает на табель мер для ОТК', () => {
    const required = tpl.points.filter((p) => p.required).map((p) => p.code);
    // Минимум, без которого документ неполон: длина, грудь, низ, плечи,
    // длина рукава, ширина рукава, низ рукава, горловина.
    for (const code of ['T01', 'T03', 'T05', 'T06', 'T10', 'T12', 'T13', 'T14']) {
      expect(required).toContain(code);
    }
  });

  it('Pro-режим только раскрывает плотность и не прячет обязательное', () => {
    for (const p of tpl.points) {
      if (p.pro_only) expect(p.required).toBe(false);
    }
  });
});

describe('честность справочников', () => {
  it('каждая непроверенная запись объясняет, чего ей не хватает', () => {
    const gaps = base.unverified();
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) expect(g.gap.length).toBeGreaterThan(20);
  });

  it('мужская сетка честно помечена как блокирующий пробел', () => {
    const menGaps = base.unverified().filter((g) => g.key.startsWith('men/'));
    expect(menGaps.length).toBeGreaterThan(0);
    expect(menGaps.some((g) => g.gap.includes('БЛОКИРУЮЩИЙ'))).toBe(true);
  });

  it('обхваты талии и бёдер у мужчин не выдуманы', () => {
    for (const row of base.sizeChart('men').rows) {
      expect(row.waist).toBeNull();
      expect(row.hip).toBeNull();
    }
  });
});
