import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSpecFormError } from '@specform/core';
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
    const { spec, applied } = migrateToCurrent(load(file));
    expect(spec.spec_version).toBe(SPEC_VERSION);
    // Примеры записаны в текущей версии, миграций быть не должно.
    expect(applied).toEqual([]);
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
      expect(isSpecFormError(e)).toBe(true);
      if (isSpecFormError(e)) expect(e.code).toBe('SPEC_VERSION_UNSUPPORTED');
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
