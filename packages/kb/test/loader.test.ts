import { describe, expect, it } from 'vitest';
import { isSeamsterlyError } from '@seamsterly/core';
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
      expect(isSeamsterlyError(e)).toBe(true);
      if (isSeamsterlyError(e)) {
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
    for (const code of ['T01', 'T10']) {
      expect(byCode.get(code)!.anchor_basis, code).toBe('height');
    }
    // Длина по центру спинки собственной привязки не имеет: она равна длине
    // от плеча минус глубина горловины спинки — тождество, а не пропорция.
    const cbLength = byCode.get('T02')!;
    expect(cbLength.derivation).toBe('composed');
    expect(cbLength.anchor_basis).toBeUndefined();
    expect(cbLength.composed_of).toEqual([
      { code: 'T01', factor: 1 },
      { code: 'T16', factor: -1 },
    ]);
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

  it('мужская сетка взята из первоисточника, а не выведена', () => {
    // Блокирующий пробел закрыт калибровкой эталоном v1.0: таблица 3
    // ГОСТ 31399-2009, 3-я полнотная группа. Раньше здесь стояла оценка
    // по правилу RU = Ог/2, а талия не заполнялась вовсе.
    expect(base.unverified().filter((g) => g.key.startsWith('men/'))).toEqual([]);
    for (const row of base.sizeChart('men').rows) {
      expect(row.waist, `RU ${row.ru}`).not.toBeNull();
    }
  });

  it('обхват бёдер у мужчин не выдуман — его нет в стандарте', () => {
    // ГОСТ 31399 классифицирует мужчин по росту, груди и талии. Бёдер там нет,
    // и подставить их нечем: пустое поле честнее правдоподобного числа.
    for (const row of base.sizeChart('men').rows) expect(row.hip).toBeNull();
  });

  it('обхват талии у женщин помечен как выведенный, а не как ГОСТ', () => {
    // В женскую классификацию ГОСТ 31396 талия НЕ ВХОДИТ. Значение сведено
    // из вторичных источников, и таблица обязана это объявлять.
    const chart = base.sizeChart('women');
    expect(chart.waist_provenance).toBe('derived');
    expect(chart.waist_note_ru).toBeTruthy();
    expect(base.sizeChart('men').waist_provenance).toBe('gost');
  });

  it('полнотная группа названа явно — «просто размер 46» талию не определяет', () => {
    // На каждый обхват груди в ГОСТ приходится пять-шесть полнот. Не назвать
    // группу значит выдать одну из шести таблиц за единственную.
    expect(base.sizeChart('women').fullness_group).toBe(2);
    expect(base.sizeChart('men').fullness_group).toBe(3);
    for (const g of ['women', 'men'] as const) {
      expect(base.sizeChart(g).fullness_note_ru.length).toBeGreaterThan(20);
    }
  });
});

describe('калибровка эталоном v1.0 — числа, которые нельзя поменять молча', () => {
  /**
   * Эти значения переписаны по первоисточникам (ГОСТ 23193-78, формулы ЕМКО
   * через методичку ИВГПУ, немецкая школа градации) и закрыли конкретные
   * дефекты документов. Тест фиксирует их не ради самих чисел, а чтобы правка
   * прошла осознанно: справочники — это код, и меняются через PR с причиной.
   */
  const rule = (key: string) => base.gradingRule(key);

  it('бицепс растёт вместе с проймой, а не втрое быстрее', () => {
    // ЕМКО: ΔШОР = ΔШПр. Было 1.6 — разброс рукава 8 см по ряду 42–52
    // при 10 см по груди.
    expect(rule('bicep').per_size).toBe(0.5);
  });

  it('низ рукава не обгоняет сам рукав', () => {
    expect(rule('sleeve_opening').per_size).toBe(0.25);
    expect(rule('sleeve_opening').per_size).toBeLessThan(rule('bicep').per_size);
  });

  it('карман градуируется от горловины, а не пропорционально груди', () => {
    // Было 0.8 — вчетверо выше нормы. Крупный карман на маленьком размере
    // это классический визуальный брак градации.
    expect(rule('pocket_width').per_size).toBe(0.2);
    expect(rule('pocket_height').per_size).toBeLessThan(rule('pocket_width').per_size);
    expect(rule('hood_body').per_size).toBe(0.2);
    expect(rule('hood_opening').per_size).toBeGreaterThan(rule('hood_body').per_size);
  });

  it('ни одно приращение не превышает ведущую ширину по груди', () => {
    const width = rule('body_width').per_size;
    for (const r of base.gradingRules()) {
      expect(r.per_size, r.key).toBeLessThanOrEqual(width);
    }
  });

  it('длина разделена на размерное и ростовое приращение', () => {
    // Отраслевые «+2–2.5 см на размер» — склейка обоих. При совмещённой
    // градации она удваивает приращение длины.
    const len = rule('body_length');
    expect(len.per_size).toBeGreaterThan(0);
    expect(len.per_height).toBeGreaterThan(len.per_size);
  });

  it('наклон плеча и высоты рибан не градуируются', () => {
    expect(rule('none').per_size).toBe(0);
  });

  it('допуски — ГОСТ 23193-78, а не то, что казалось строгим', () => {
    // Прежний дефолт по мелким точкам был ±0.3: строже норматива без основания.
    // Слишком жёсткий допуск не улучшает пошив, а даёт брак там, где фабрика
    // работает нормально.
    expect(base.toleranceFor('minor', 'knit')).toBe(0.5);
    expect(base.toleranceFor('medium', 'knit')).toBe(0.5);
    expect(base.toleranceFor('major_width', 'knit')).toBe(1.0);
    expect(base.toleranceFor('length', 'knit')).toBe(1.0);
  });

  it('премиальный профиль жёстче ГОСТ, и это выбор бренда', () => {
    expect(base.toleranceFor('minor', 'knit', 'premium')).toBeLessThan(
      base.toleranceFor('minor', 'knit', 'gost'),
    );
  });

  it('наши допуски строже мировой практики по каждому классу', () => {
    const intl = base.toleranceComparisons().find((c) => c.id === 'intl_practice')!;
    for (const [cls, value] of Object.entries(intl.values)) {
      if (value === null) continue;
      expect(base.toleranceFor(cls as never, 'knit'), cls).toBeLessThanOrEqual(value);
    }
  });

  it('правила приёмки, которые поточечный допуск не выражает, названы', () => {
    const ids = base.qcRules().map((r) => r.id);
    expect(ids).toContain('paired_parts');
    expect(ids).toContain('measurement_error');
  });

  it('прибавка прилегающей посадки допускает минус — это трикотаж', () => {
    const fitted = base.easeFor('tshirt', 'fitted', 'knit').entry;
    expect(fitted.min).toBeLessThan(0);
    // Но выбрать минус пока нечем: движок берёт default, и справочник об этом
    // говорит прямо, а не делает вид, что проверка есть.
    expect(fitted.default).toBeGreaterThan(0);
    expect(fitted.note).toContain('недостижима');
  });

  it('мужская сетка несёт китайскую 号型 и полнотную группу', () => {
    const row = base.bodyMeasurements('men', 48);
    expect(row.cn).toBe('175/96A');
    // 型 = обхват груди = RU × 2.
    expect(row.cn!.split('/')[1]!.replace(/\D/g, '')).toBe(String(row.chest));
  });
});
