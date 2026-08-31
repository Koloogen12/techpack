import { CONFIDENCE_LABEL_RU, type Confidence } from '@seamster/core';
import { messages, type Locale } from '@seamster/i18n';
import type { StyleSpec } from '@seamster/stylespec';

/**
 * Табель мер таблицей — тот же документ, что и в паке, но в файле, который
 * открывается в Excel.
 *
 * Фабрика считает по табелю расход и трудоёмкость, сверяет ОТК готовые
 * изделия, а закройщик держит его на столе. Всё это делают в таблице, а не
 * в PDF: из PDF цифры перебивают руками, и именно там появляются опечатки,
 * которые потом выглядят как брак пошива.
 *
 * CSV, а не XLSX: формат открывается всем, читается глазами и не требует
 * библиотеки, которая однажды сломает сборку ради ячейки с цветом.
 */

/** Экранирование по RFC 4180: кавычки удваиваются, поле берётся в кавычки. */
const cell = (value: string | number): string => {
  const s = String(value);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const num = (n: number): string => (Math.round(n * 10) / 10).toString();

export function pomCsv(spec: StyleSpec, locale: Locale = 'ru'): string {
  const t = messages(locale);
  const sizes = spec.base.size_range;

  const header = [
    t.pom_code,
    t.pom_point,
    t.pom_how,
    `${t.pom_base} RU ${spec.base.base_size_ru}`,
    t.pom_tolerance,
    ...sizes.map((ru) => `RU ${ru}`),
  ];
  if (locale === 'ru') header.push('источник значения');

  const rows = spec.measurements.points.map((p) => {
    const name =
      locale === 'zh' ? (p.name_zh ?? p.name_en) : locale === 'en' ? p.name_en : p.name_ru;
    // 胸围 по-китайски — полный обхват; наш замер половинный. Та же
    // поправка, что в паке: расхождение здесь стоит партии не того размера.
    const shown =
      locale === 'zh' && p.measure_kind === 'half' && !name.startsWith('1/2') ? `1/2${name}` : name;
    const how =
      locale === 'zh'
        ? (p.how_to_measure_zh ?? p.how_to_measure_en ?? p.how_to_measure_ru)
        : locale === 'en'
          ? (p.how_to_measure_en ?? p.how_to_measure_ru)
          : p.how_to_measure_ru;

    // Базовый размер в градации не лежит: он и есть основание, от которого
    // она считается. В таблице колонка под него всё равно должна быть
    // заполнена — фабрике нужна ПОЛНАЯ сетка, а не сетка с дырой посередине.
    const byRu = new Map<number, number>(p.graded.map((g) => [g.ru, g.value.value]));
    if (!byRu.has(spec.base.base_size_ru)) byRu.set(spec.base.base_size_ru, p.base.value);
    const out: (string | number)[] = [
      p.code,
      shown,
      how,
      num(p.base.value),
      `±${num(p.tolerance.value)}`,
      ...sizes.map((ru) => {
        const v = byRu.get(ru);
        // Точка без градации оставляет ПУСТУЮ клетку, а не ноль: ноль в
        // таблице замеров читается как «шить в ноль сантиметров».
        return v === undefined ? '' : num(v);
      }),
    ];
    if (locale === 'ru') out.push(CONFIDENCE_LABEL_RU[p.base.confidence as Confidence]);
    return out;
  });

  // BOM-метка: без неё Excel открывает кириллицу и иероглифы кракозябрами,
  // и таблица, ради которой всё затевалось, оказывается нечитаемой.
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
