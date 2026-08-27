import { describe, expect, it } from 'vitest';
import { buildStyleSpec } from '@seamsterly/assembly';
import { pomCsv } from '@seamsterly/docgen';

/**
 * Табель таблицей — файл, по которому фабрика считает расход и сверяет ОТК.
 * Из PDF цифры перебивают руками, и там появляются опечатки, выглядящие
 * как брак пошива.
 */
const { spec } = buildStyleSpec({
  id: 'csv',
  name: 'CSV',
  article: 'CSV-001',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  machine_park: 'base_shop',
  generated_at: new Date('2026-08-27T00:00:00.000Z'),
});

describe('табель мер таблицей', () => {
  it('несёт строку на каждую точку и колонку на каждый размер', () => {
    const lines = pomCsv(spec).trimEnd().split('\r\n');
    expect(lines.length).toBe(spec.measurements.points.length + 1);
    for (const ru of spec.base.size_range) expect(lines[0]).toContain(`RU ${ru}`);
  });

  it('открывается в Excel без кракозябр', () => {
    // Без метки порядка байтов Excel читает кириллицу и иероглифы как мусор,
    // и таблица, ради которой всё затевалось, оказывается нечитаемой.
    expect(pomCsv(spec).startsWith('﻿')).toBe(true);
  });

  it('колонка базового размера заполнена', () => {
    // Базовый размер в градации не лежит — он её основание. Пустая клетка
    // посередине сетки читается как «этот размер не шьём».
    const base = spec.base.base_size_ru;
    const header = pomCsv(spec).split('\r\n')[0]!.split(',');
    const col = header.indexOf(`RU ${base}`);
    expect(col).toBeGreaterThan(0);
    const row = pomCsv(spec).split('\r\n')[1]!.split(',');
    expect(row[col]).not.toBe('');
    expect(Number(row[col])).toBeGreaterThan(0);
  });

  it('точка без градации оставляет пустую клетку, а не ноль', () => {
    // Ноль в табеле читается как «шить в ноль сантиметров».
    const ungraded = spec.measurements.points.find((p) => p.graded.length === 0);
    if (!ungraded) return;
    const row = pomCsv(spec)
      .split('\r\n')
      .find((l) => l.startsWith(ungraded.code))!;
    expect(row.endsWith(',,,') || row.includes(',,')).toBe(true);
  });

  it('в китайской таблице грудь помечена как половина', () => {
    // 胸围 — полный обхват; наш замер половинный, и расхождение здесь
    // стоит партии не того размера.
    expect(pomCsv(spec, 'zh')).toContain('1/2');
  });

  it('в чужой таблице нет наших слов', () => {
    for (const locale of ['en', 'zh'] as const) {
      const body = pomCsv(spec, locale).replace(/CSV-001|CSV/g, '');
      expect(body, locale).not.toMatch(/[А-Яа-яЁё]{4,}/);
    }
  });

  it('поле с запятой берётся в кавычки, а не рвёт строку', () => {
    const csv = pomCsv(spec);
    for (const line of csv.trimEnd().split('\r\n')) {
      // Число полей одинаково во всех строках — иначе таблица разъедется.
      const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
      expect(fields.length).toBe((csv.split('\r\n')[0]!.match(/,/g) ?? []).length + 2);
    }
  });
});
