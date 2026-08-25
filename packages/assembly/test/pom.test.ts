import { describe, expect, it } from 'vitest';
import { isSpecFormError, roundCm } from '@specform/core';
import { kb } from '@specform/kb';
import { buildMeasurements, type PomInput } from '../src/index.js';

const base = kb();

/** Женская футболка RU 46, обычная посадка, ряд 42–52. Опорный случай продукта. */
const INPUT: PomInput = {
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
};

const point = (input: PomInput, code: string) => {
  const found = buildMeasurements(input, base).measurements.points.find((p) => p.code === code);
  if (!found) throw new Error(`нет точки ${code}`);
  return found;
};

describe('якорь масштаба', () => {
  it('считается из обхвата тела и прибавки, а не из «дефолтного M системы»', () => {
    // RU 46 → обхват груди тела 92 см. Обычная посадка футболки → прибавка 10 см.
    // Обхват изделия 102 см, половинный замер — 51 см.
    expect(point(INPUT, 'T03').base.value).toBe(51);
  });

  it('свободнее посадка — шире изделие', () => {
    const widths = (['fitted', 'semi_fitted', 'loose', 'oversize'] as const).map(
      (fit) => point({ ...INPUT, fit_intent: fit }, 'T03').base.value,
    );
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it('больше размер — шире изделие ровно на половину шага сетки', () => {
    const m = point(INPUT, 'T03').base.value;
    const l = point({ ...INPUT, base_size_ru: 48 }, 'T03').base.value;
    expect(l - m).toBe(base.chestStep() / 2);
  });

  it('честно говорит, что посчитан из типовых значений', () => {
    const anchor = point(INPUT, 'T03');
    expect(anchor.base.confidence).toBe('default_from_base');
    expect(anchor.base.note).toContain('подтвердить по образцу');
  });
});

describe('пропорции изделия', () => {
  it('дают правдоподобную футболку в абсолютных сантиметрах', () => {
    // Проверка не на формулы, а на здравый смысл: если движок выдаёт
    // рукав в метр или горловину в 40 см, формулы сошлись, а вещь — нет.
    const sane: Record<string, [number, number]> = {
      T01: [60, 80], // длина изделия
      T03: [45, 60], // ширина по груди
      T06: [38, 52], // ширина плеч
      T10: [15, 28], // длина рукава
      T12: [15, 26], // ширина рукава
      T13: [13, 23], // низ рукава
      T14: [14, 23], // ширина горловины
      T15: [4, 14], // глубина горловины переда
    };
    for (const [code, [min, max]] of Object.entries(sane)) {
      const value = point(INPUT, code).base.value;
      expect(value, `${code} = ${value} см`).toBeGreaterThanOrEqual(min);
      expect(value, `${code} = ${value} см`).toBeLessThanOrEqual(max);
    }
  });

  it('без пропорций с фото берёт типовые и помечает их типовыми', () => {
    expect(point(INPUT, 'T01').base.confidence).toBe('default_from_base');
  });

  it('с пропорцией с фото помечает значение оценкой по фото', () => {
    const withPhoto = { ...INPUT, photo_ratios: { T01: 1.5 } };
    const p = point(withPhoto, 'T01');
    expect(p.base.value).toBe(51 * 1.5);
    expect(p.base.confidence).toBe('estimated_from_photo');
    expect(p.base.source).toContain('vision');
  });
});

describe('неправдоподобная пропорция с фото', () => {
  const wild = { ...INPUT, photo_ratios: { T01: 4.0 } };

  it('ограничивается диапазоном, а не уезжает в документ', () => {
    expect(point(wild, 'T01').base.value).toBe(roundCm(51 * 1.65));
  });

  it('перестаёт называться оценкой по фото — значение уже не с фото', () => {
    expect(point(wild, 'T01').base.confidence).toBe('default_from_base');
  });

  it('объясняет пользователю, что произошло', () => {
    const note = point(wild, 'T01').base.note ?? '';
    expect(note).toContain('4.00');
    expect(note).toContain('образцу');
  });
});

describe('допуски', () => {
  it('крупные ширины получают допуск своего класса', () => {
    expect(point(INPUT, 'T03').tolerance.value).toBe(base.toleranceFor('major_width', 'knit'));
  });

  it('явное значение категории перекрывает класс', () => {
    // Высота бейки в базе знаний имеет свой допуск ±0.2, класс дал бы ±0.3.
    expect(point(INPUT, 'T17').tolerance.value).toBe(0.2);
    expect(point(INPUT, 'T17').tolerance.source).toContain('pom_templates');
  });

  it('стоят у каждой точки — таблица без допусков бесполезна для ОТК', () => {
    for (const p of buildMeasurements(INPUT, base).measurements.points) {
      expect(p.tolerance.value).toBeGreaterThan(0);
    }
  });
});

describe('градация', () => {
  it('покрывает весь ряд, кроме базового размера', () => {
    const graded = point(INPUT, 'T03').graded;
    expect(graded.map((g) => g.ru)).toEqual([42, 44, 48, 50, 52]);
  });

  it('ширины растут на 2 см на размер — половина шага сетки по обхвату', () => {
    const g = Object.fromEntries(point(INPUT, 'T03').graded.map((x) => [x.ru, x.value.value]));
    expect(g[44]).toBe(49);
    expect(g[48]).toBe(53);
    expect(g[52]).toBe(57);
  });

  it('длины растут медленнее ширин — иначе изделие вытягивается с размером', () => {
    const width = point(INPUT, 'T03');
    const length = point(INPUT, 'T01');
    const step = (p: typeof width) => p.graded.find((g) => g.ru === 48)!.value.value - p.base.value;
    expect(step(length)).toBeLessThan(step(width));
  });

  it('точки без правила градации не градуируются', () => {
    expect(point(INPUT, 'T17').graded).toEqual([]);
    expect(point(INPUT, 'T18').graded).toEqual([]);
  });
});

describe('ростовка', () => {
  it('высокий рост удлиняет изделие, но не расширяет', () => {
    const tall = { ...INPUT, base_height_cm: 176 };
    expect(point(tall, 'T01').base.value).toBeGreaterThan(point(INPUT, 'T01').base.value);
    expect(point(tall, 'T03').base.value).toBe(point(INPUT, 'T03').base.value);
  });

  it('поясняет пересчёт, а не молчит', () => {
    const { notes } = buildMeasurements({ ...INPUT, base_height_cm: 176 }, base);
    expect(notes.join(' ')).toContain('ростовки');
  });
});

describe('калибровка по ручному замеру', () => {
  const manual = { ...INPUT, manual: { code: 'T01', value_cm: 75 } };

  it('замеренная точка становится ровно тем, что назвал пользователь', () => {
    const p = point(manual, 'T01');
    expect(p.base.value).toBe(75);
    expect(p.base.confidence).toBe('user_input');
  });

  it('подтягивает масштаб остальных точек, сохраняя пропорции', () => {
    // Калибровка домножает всё на один коэффициент, поэтому отношения
    // между точками обязаны остаться прежними. Сравниваем именно их:
    // абсолютные значения расходятся на округление, отношения — нет.
    const before = point(INPUT, 'T03').base.value / point(INPUT, 'T01').base.value;
    const after = point(manual, 'T03').base.value / point(manual, 'T01').base.value;
    // Точность 2 знака, а не больше: оба значения округлены до 0.1 см,
    // что на величинах ~50–75 см даёт около 0.001 погрешности отношения.
    expect(after).toBeCloseTo(before, 2);
    expect(point(manual, 'T03').base.value).toBeGreaterThan(point(INPUT, 'T03').base.value);
  });

  it('сообщает о калибровке и помечает затронутые значения', () => {
    const { notes } = buildMeasurements(manual, base);
    expect(notes.join(' ')).toContain('откалиброван');
    expect(point(manual, 'T03').base.note).toContain('откалиброван');
  });

  it('замер несуществующей точки — понятная ошибка, а не молчаливый пропуск', () => {
    expect(() =>
      buildMeasurements({ ...INPUT, manual: { code: 'ZZ9', value_cm: 50 } }, base),
    ).toThrow();
  });
});

describe('категорийный гейт', () => {
  // Худи, свитшот и лонгслив ждут своих шаблонов точек (неделя 2).
  // До тех пор движок обязан отказывать честно, а не выдавать результат хуже.
  it('категория без шаблона получает понятный отказ, а не плохой техпак', () => {
    try {
      buildMeasurements({ ...INPUT, category: 'hoodie' }, base);
      expect.unreachable('должно было отказать');
    } catch (e) {
      expect(isSpecFormError(e)).toBe(true);
      if (isSpecFormError(e)) {
        expect(e.code).toBe('CATEGORY_UNSUPPORTED');
        expect(e.userAction).toContain('лист ожидания');
      }
    }
  });

  // Откат прибавки движком проверяется на уровне справочника (packages/kb):
  // сам путь в POM-движке станет достижим, когда появится шаблон худи.
  it('прибавка для прилегающего худи существует через откат', () => {
    expect(base.easeFor('hoodie', 'fitted', 'knit').fallbackFrom).toBe('fitted');
  });
});

describe('честность и воспроизводимость', () => {
  it('ни одного значения без источника — ни базового, ни допуска, ни градации', () => {
    for (const p of buildMeasurements(INPUT, base).measurements.points) {
      expect(p.base.source).not.toBe('');
      expect(p.tolerance.source).not.toBe('');
      for (const g of p.graded) expect(g.value.source).not.toBe('');
    }
  });

  it('одинаковый вход даёт побайтово одинаковый результат', () => {
    const a = buildMeasurements(INPUT, base);
    const b = buildMeasurements(INPUT, base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('базовый размер вне ряда — ошибка с понятным действием', () => {
    try {
      buildMeasurements({ ...INPUT, base_size_ru: 60 }, base);
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSpecFormError(e)).toBe(true);
      if (isSpecFormError(e)) expect(e.userAction.length).toBeGreaterThan(10);
    }
  });
});
