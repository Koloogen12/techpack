import { describe, expect, it } from 'vitest';
import { isSeamsterError } from '@seamster/core';
import { kb } from '@seamster/kb';
import { buildMeasurements, photoRatiosFrom, type PomInput } from '../src/index.js';

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
    // RU 46 → обхват груди тела 92 см (ГОСТ 31396, 2-я полнотная группа).
    // Обычная посадка футболки → прибавка 9 см (калибровка эталоном v1.0
    // по семнадцати замерам готовых изделий; было 10 по эвристике).
    // Обхват изделия 101 см, половинный замер — 50.5 см.
    expect(point(INPUT, 'T03').base.value).toBe(50.5);
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
    // Проверяем не магическое число, а линейность: удвоенное отношение
    // обязано дать вдвое больший замер, каким бы ни был якорь.
    const one = point({ ...INPUT, photo_ratios: { T01: 1.3 } }, 'T01');
    const two = point({ ...INPUT, photo_ratios: { T01: 1.6 } }, 'T01');

    expect(one.base.confidence).toBe('estimated_from_photo');
    expect(one.base.source).toContain('vision');
    expect(two.base.value / one.base.value).toBeCloseTo(1.6 / 1.3, 2);
  });
});

describe('неправдоподобная пропорция с фото', () => {
  const wild = { ...INPUT, photo_ratios: { T01: 4.0 } };

  it('ограничивается верхней границей, а не уезжает в документ', () => {
    // Границы задаются относительно типового значения, поэтому ожидаемое
    // считаем из него и из отношения диапазона к базовому — тест не ломается
    // от калибровки, только от поломки самого ограничения.
    const t01 = base.pomTemplate('tshirt').points.find((p) => p.code === 'T01')!;
    const typical = point(INPUT, 'T01').base.value;
    const ceiling = typical * (t01.ratio_range!.max / t01.baseline_ratio!);

    // Допуск в один шаг округления: движок считает потолок от неокруглённого
    // типового значения, а тест — от того, что записано в спеку.
    expect(Math.abs(point(wild, 'T01').base.value - ceiling)).toBeLessThanOrEqual(0.1);
    expect(point(wild, 'T01').base.value).toBeLessThan(4 * 51);
  });

  it('перестаёт называться оценкой по фото — значение уже не с фото', () => {
    expect(point(wild, 'T01').base.confidence).toBe('default_from_base');
  });

  it('объясняет пользователю, что произошло, в сантиметрах', () => {
    // Пользователь не мыслит отношениями к якорю — ему нужны сантиметры.
    const note = point(wild, 'T01').base.note ?? '';
    expect(note).toContain('см');
    expect(note).toContain('диапазон');
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
    // База 50.5; шаг +2.0 на размер — половина шага сетки по обхвату (Ог +4).
    expect(g[44]).toBe(48.5);
    expect(g[48]).toBe(52.5);
    expect(g[52]).toBe(56.5);
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

describe('категорийный гейт и трикотажное ядро', () => {
  it('все четыре категории ядра собираются', () => {
    for (const category of ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'] as const) {
      expect(() => buildMeasurements({ ...INPUT, category }, base), category).not.toThrow();
    }
  });

  it('категория вне ядра получает понятный отказ, а не плохой техпак', () => {
    try {
      // Платье — вне трикотажного ядра: скрытых деталей больше,
      // документ вышел бы хуже, чем нужно фабрике.
      buildMeasurements({ ...INPUT, category: 'dress' as never }, base);
      expect.unreachable('должно было отказать');
    } catch (e) {
      expect(isSeamsterError(e)).toBe(true);
      if (isSeamsterError(e)) {
        expect(e.code).toBe('CATEGORY_UNSUPPORTED');
        expect(e.userAction).toContain('лист ожидания');
      }
    }
  });

  it('прилегающее худи откатывается к обычной посадке и говорит об этом', () => {
    const { notes } = buildMeasurements(
      { ...INPUT, category: 'hoodie', fit_intent: 'fitted' },
      base,
    );
    expect(notes.join(' ')).toContain('не типовая');
  });

  it('у худи горловина закрыта капюшоном — точек глубины горловины нет', () => {
    const codes = buildMeasurements({ ...INPUT, category: 'hoodie' }, base).measurements.points.map(
      (p) => p.code,
    );
    expect(codes).not.toContain('T15');
    expect(codes).toContain('H01');
    expect(codes).toContain('H04');
  });

  it('рукав лонгслива длиннее рукава футболки', () => {
    const sleeve = (category: 'tshirt' | 'longsleeve') =>
      buildMeasurements({ ...INPUT, category }, base).measurements.points.find(
        (p) => p.code === 'T10',
      )!.base.value;
    expect(sleeve('longsleeve')).toBeGreaterThan(sleeve('tshirt') * 2);
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
      expect(isSeamsterError(e)).toBe(true);
      if (isSeamsterError(e)) expect(e.userAction.length).toBeGreaterThan(10);
    }
  });
});

describe('мост из vision-отчёта', () => {
  const proportions = [
    {
      pom_code: 'T01',
      ratio_to_chest: 1.4,
      confidence: 'high' as const,
      reason: 'контур виден целиком',
    },
    {
      pom_code: 'T06',
      ratio_to_chest: 0.8,
      confidence: 'low' as const,
      reason: 'плечи размыты на чёрном',
    },
    { pom_code: 'T10', ratio_to_chest: 0.45, confidence: 'medium' as const },
    // Мусор: отношение не может быть нулём или отрицательным.
    { pom_code: 'T12', ratio_to_chest: 0, confidence: 'high' as const },
  ];

  const withVision = { ...INPUT, photo_ratios: photoRatiosFrom(proportions) };

  it('отбрасывает мусорные отношения, но не низкую уверенность', () => {
    const ratios = photoRatiosFrom(proportions);
    expect(Object.keys(ratios).sort()).toEqual(['T01', 'T06', 'T10']);
  });

  it('уверенное отношение идёт в документ без оговорок', () => {
    const p = point(withVision, 'T01');
    expect(p.base.confidence).toBe('estimated_from_photo');
    expect(p.base.note).toBeUndefined();
  });

  it('низкая уверенность модели превращается в примечание с причиной', () => {
    const p = point(withVision, 'T06');
    expect(p.base.confidence).toBe('estimated_from_photo');
    expect(p.base.note).toContain('низкая');
    expect(p.base.note).toContain('плечи размыты');
  });

  it('средняя уверенность тоже видна пользователю', () => {
    // Оговорка модели про рукав живёт на длине РУКИ: рукав от плечевой точки
    // выводится из неё, и наблюдение с фото записывается в ту точку, из
    // которой считается остальное. Статус при этом наследуется рукавом —
    // пользователь видит на его строке ту же метку «оценка по фото».
    expect(point(withVision, 'T11').base.note).toContain('средняя');
    expect(point(withVision, 'T10').base.confidence).toBe('estimated_from_photo');
  });

  it('точки, которых модель не увидела, берут типовое значение', () => {
    expect(point(withVision, 'T12').base.confidence).toBe('default_from_base');
  });
});

describe('защита от мусорного входа', () => {
  // Каждая проверка ниже закрывает дыру, найденную состязательным прогоном:
  // движок молча выдавал документ, которым нельзя пользоваться.

  it('дубли в размерном ряду отвергаются — иначе будут дубли артикулов SKU', () => {
    try {
      buildMeasurements({ ...INPUT, size_range: [42, 46, 46, 48] }, base);
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterError(e)).toBe(true);
      if (isSeamsterError(e)) expect(e.userMessage).toContain('46');
    }
  });

  it('невозможный рост отвергается вместо изделия невозможной длины', () => {
    // До правки рост 300 см давал футболку длиной 123 см и никого не смущал.
    for (const height of [100, 300]) {
      expect(() => buildMeasurements({ ...INPUT, base_height_cm: height }, base)).toThrow();
    }
  });

  it('нетиповой, но реальный рост принимается', () => {
    for (const height of [150, 195]) {
      expect(() => buildMeasurements({ ...INPUT, base_height_cm: height }, base)).not.toThrow();
    }
  });

  it('нулевая и отрицательная пропорция игнорируются, а не ограничиваются границей', () => {
    // Ограничить мусор границей диапазона значит подменить типовое значение
    // выдуманным: минус единица превращалась в самое короткое правдоподобное изделие.
    const baseline = point(INPUT, 'T01').base.value;
    for (const ratio of [0, -1, -0.5]) {
      const p = point({ ...INPUT, photo_ratios: { T01: ratio } }, 'T01');
      expect(p.base.value, `ratio=${ratio}`).toBe(baseline);
      expect(p.base.confidence).toBe('default_from_base');
    }
  });

  it('пропорция для якоря игнорируется — якорь считается из сетки, а не с фото', () => {
    expect(point({ ...INPUT, photo_ratios: { T03: 5 } }, 'T03').base.value).toBe(
      point(INPUT, 'T03').base.value,
    );
  });

  it('пропорция неизвестной точки не ломает сборку', () => {
    expect(() => buildMeasurements({ ...INPUT, photo_ratios: { T99: 1.2 } }, base)).not.toThrow();
  });
});
