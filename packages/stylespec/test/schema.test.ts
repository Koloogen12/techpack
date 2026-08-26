import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSeamsterlyError } from '@seamsterly/core';
import {
  SPEC_VERSION,
  migrateToCurrent,
  parseStyleSpec,
  specFingerprint,
  type StyleSpec,
} from '../src/index.js';

const DIR = new URL('../examples/', import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as unknown;

describe('эталонные примеры', () => {
  it('их несколько — схема без примеров недокументирована', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s проходит валидацию схемы', (file) => {
    expect(() => parseStyleSpec(load(file))).not.toThrow();
  });

  it.each(files)('%s открывается через цепочку миграций', (file) => {
    // minimal.json намеренно оставлен снапшотом версии 0.1.0: он гоняет
    // миграции на каждом прогоне тестов, а не только когда о них вспомнят.
    expect(migrateToCurrent(load(file)).spec.spec_version).toBe(SPEC_VERSION);
  });
});

describe('отпечаток содержимого', () => {
  const spec = parseStyleSpec(load('tshirt-women-46.json'));

  it('устойчив к повторному вычислению', () => {
    expect(specFingerprint(spec)).toBe(specFingerprint(spec));
  });

  it('не зависит от порядка ключей в объекте', () => {
    const shuffled = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(spec).reverse())),
    ) as StyleSpec;
    expect(specFingerprint(shuffled)).toBe(specFingerprint(spec));
  });

  it('не зависит от времени генерации — иначе воспроизводимость непроверяема', () => {
    const later: StyleSpec = {
      ...spec,
      meta: { ...spec.meta, generated_at: '2030-01-01T00:00:00.000Z' },
    };
    expect(specFingerprint(later)).toBe(specFingerprint(spec));
  });

  it('меняется от любой правки замера', () => {
    const points = [...spec.measurements.points];
    const first = points[0]!;
    points[0] = { ...first, base: { ...first.base, value: first.base.value + 0.1 } };
    const edited: StyleSpec = { ...spec, measurements: { ...spec.measurements, points } };
    expect(specFingerprint(edited)).not.toBe(specFingerprint(spec));
  });
});

describe('схема ловит рассогласования, которые движок мог допустить сам', () => {
  const valid = parseStyleSpec(load('tshirt-women-46.json'));

  it('счётчик предположений обязан сходиться с данными', () => {
    const lying = { ...valid, meta: { ...valid.meta, assumptions_count: 99 } };
    expect(() => parseStyleSpec(lying)).toThrow();
  });

  it('базовый размер обязан входить в размерный ряд', () => {
    const broken = { ...valid, base: { ...valid.base, base_size_ru: 99 } };
    expect(() => parseStyleSpec(broken)).toThrow();
  });

  it('размерный ряд обязан идти по возрастанию', () => {
    const broken = { ...valid, base: { ...valid.base, size_range: [52, 42, 46] } };
    expect(() => parseStyleSpec(broken)).toThrow();
  });

  it('градация обязана покрывать весь ряд — пустые колонки в экспорте недопустимы', () => {
    const points = [...valid.measurements.points];
    const graded = points.find((p) => p.graded.length > 0)!;
    points[points.indexOf(graded)] = { ...graded, graded: graded.graded.slice(1) };
    const broken = { ...valid, measurements: { ...valid.measurements, points } };
    expect(() => parseStyleSpec(broken)).toThrow();
  });

  it('значение без источника не проходит', () => {
    const points = [...valid.measurements.points];
    const first = points[0]!;
    points[0] = { ...first, base: { ...first.base, source: '' } };
    const broken = { ...valid, measurements: { ...valid.measurements, points } };
    expect(() => parseStyleSpec(broken)).toThrow();
  });
});

describe('миграции', () => {
  it('неизвестная версия — понятная ошибка, а не тихая порча данных', () => {
    try {
      migrateToCurrent({ ...(load('minimal.json') as object), spec_version: '99.0.0' });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e)).toBe(true);
      if (isSeamsterlyError(e)) expect(e.code).toBe('SPEC_VERSION_UNSUPPORTED');
    }
  });

  it('0.6.0 → 0.7.0: у колорвея появляются образец и номер цвета', () => {
    // Реальный снапшот, а не выдуманный: берём текущий пример и снимаем
    // с него всё, чего в 0.6.0 быть не могло.
    const current = load('hoodie-allover-pattern.json') as {
      bom: { colorways: Record<string, unknown>[] };
    };
    const old = {
      ...current,
      spec_version: '0.6.0',
      bom: {
        ...current.bom,
        colorways: current.bom.colorways.map((c) => ({
          id: c.id,
          name_ru: c.name_ru,
          ...(c.hex_approx ? { hex_approx: c.hex_approx } : {}),
        })),
      },
    };

    const { spec } = migrateToCurrent(old);
    expect(spec.spec_version).toBe(SPEC_VERSION);
    // Восстановить их неоткуда: образец — файл, которого в старом паке нет,
    // а номер знает только бренд. Пусто честнее выдуманного.
    for (const c of spec.bom!.colorways) {
      expect(c.swatch).toBeNull();
      expect(c.book_code).toBeNull();
    }
  });

  it('снапшот без версии не открывается', () => {
    expect(() => migrateToCurrent({ style: {} })).toThrow();
  });
});

describe('смешанные статусы уверенности', () => {
  const spec = parseStyleSpec(load('tshirt-oversize-mixed-confidence.json'));

  it('в одном документе живут значения разного происхождения', () => {
    const kinds = new Set(spec.measurements.points.map((p) => p.base.confidence));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('ручной замер даёт статус «указано вами»', () => {
    const measured = spec.measurements.points.find((p) => p.code === 'T01')!;
    expect(measured.base.confidence).toBe('user_input');
  });

  it('ограниченная пропорция объясняет себя', () => {
    const clamped = spec.measurements.points.find((p) => p.base.source.includes('clamped'));
    expect(clamped).toBeDefined();
    expect(clamped!.base.note).toContain('диапазон');
  });
});

describe('миграция 0.1.0 → 0.2.0', () => {
  const legacy = { ...(load('minimal.json') as Record<string, unknown>), spec_version: '0.1.0' };

  it('старый снапшот проходит всю цепочку миграций по шагам', () => {
    const { spec, applied } = migrateToCurrent(legacy);
    expect(spec.spec_version).toBe(SPEC_VERSION);
    // По шагу на каждую версию — цепочка растёт вместе со схемой.
    expect(applied.length).toBeGreaterThanOrEqual(2);
    expect(applied[0]).toContain('0.1.0 → 0.2.0');
    expect(applied.join(' ')).toContain('конструкц');
    expect(applied.join(' ')).toContain('материал');
  });

  it('новые разделы у старого снапшота остаются пустыми, а не выдуманными', () => {
    const { spec } = migrateToCurrent(legacy);
    expect(spec.construction).toBeUndefined();
    expect(spec.bom).toBeUndefined();
    expect(spec.labels).toBeUndefined();
  });

  it('данные старого снапшота переживают миграцию без потерь', () => {
    const { spec } = migrateToCurrent(legacy);
    expect(spec.measurements.points).toHaveLength(1);
    expect(spec.measurements.points[0]!.code).toBe('T03');
  });
});

describe('раздел конструкции', () => {
  const spec = parseStyleSpec(load('tshirt-women-46.json'));

  it('присутствует в свежесобранной спеке', () => {
    expect(spec.construction).toBeDefined();
    expect(spec.construction!.nodes.length).toBeGreaterThan(5);
  });

  it('счётчик предположений учитывает и замеры, и конструкцию', () => {
    const fromNodes = spec.construction!.nodes.filter(
      (n) => n.presence.confidence === 'assumption',
    ).length;
    expect(fromNodes).toBeGreaterThan(0);
    expect(spec.meta.assumptions_count).toBeGreaterThanOrEqual(fromNodes);
  });

  it('узел со спецоборудованием без замены не проходит валидацию', () => {
    const nodes = [...spec.construction!.nodes];
    nodes[0] = { ...nodes[0]!, requires_special_equipment: true, alternative: null };
    const broken = { ...spec, construction: { ...spec.construction!, nodes } };
    expect(() => parseStyleSpec(broken)).toThrow();
  });

  it('операция, ссылающаяся на отсутствующий узел, не проходит валидацию', () => {
    const sequence = [...spec.construction!.sequence];
    sequence[0] = { ...sequence[0]!, node_id: 'no_such_node' };
    const broken = { ...spec, construction: { ...spec.construction!, sequence } };
    expect(() => parseStyleSpec(broken)).toThrow();
  });
});
