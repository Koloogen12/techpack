#!/usr/bin/env tsx
/**
 * Сравнение документа с реальным изделием.
 *
 *   pnpm fit:score [каталог]     по умолчанию golden/measured
 *
 * Читает бланки замеров, собирает по тем же ответам мастера документ,
 * сравнивает и печатает отчёт. В API не ходит: разбор фотографий берётся
 * из закоммиченных отчётов `golden/vision-reports`, поэтому прогон
 * бесплатный, быстрый и одинаковый у всех.
 *
 * Это и есть ответ на вопрос, на который тесты не отвечают: врёт ли
 * документ в сантиметрах.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { reportCliError } from './report-error.js';
import { dirname, join, resolve } from 'node:path';
import { buildStyleSpec } from '@seamster/assembly';
import { specInputFrom } from './generate.js';
import { VisionReportSchema, type VisionReport } from '@seamster/vision';
import {
  ACCEPTANCE,
  anchorSuspect,
  calibrate,
  compare,
  parseMeasuredSet,
  passes,
  METHOD_LABEL_RU,
  METHOD_TRUST,
  type ComparisonResult,
  type MeasuredSet,
} from '@seamster/fit';
import { parseAnswers } from './answers.js';

const AT = new Date('2026-08-25T00:00:00.000Z');

function visionReportFor(category: string, root: string): VisionReport | null {
  const path = join(root, 'vision-reports', `${category}.json`);
  if (!existsSync(path)) return null;
  return VisionReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function scoreOne(set: MeasuredSet, goldenRoot: string): ComparisonResult {
  const answers = parseAnswers(JSON.parse(readFileSync(set.answers, 'utf8')));
  const report = visionReportFor(answers.category, goldenRoot);

  // Спека собирается ТЕМ ЖЕ сборщиком, что и в пайплайне. Пока она
  // строилась здесь своим кодом, сравнение с рулеткой шло против документа,
  // которого пользователь никогда не видел: без класса полотна, без
  // колорвеев, без масштабного объекта.
  const { spec } = buildStyleSpec(specInputFrom(answers, report, { now: AT }));

  return compare(spec, set);
}

const bar = (rate: number, width = 20): string => {
  const filled = Math.round(rate * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

function main(): void {
  const dir = resolve(process.argv[2] ?? 'golden/measured');
  const goldenRoot = dirname(dir);

  if (!existsSync(dir)) {
    console.error(`✗ Каталог с бланками замеров не найден: ${dir}`);
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log(
      `\nВ ${dir} пока нет ни одного бланка замеров.\n\n` +
        `Это единственное, чего не хватает продукту, чтобы знать, врёт ли он\n` +
        `в сантиметрах. Порядок работы — docs/RULER-PROTOCOL.md:\n\n` +
        `  1. pnpm fit:form --category tshirt --out out/бланк.pdf\n` +
        `  2. распечатать, померить вещь, сфотографировать её же\n` +
        `  3. перенести в golden/measured/<имя>.json\n` +
        `  4. pnpm fit:score\n`,
    );
    return;
  }

  const results: ComparisonResult[] = [];
  const sets: MeasuredSet[] = [];

  for (const file of files) {
    const set = parseMeasuredSet(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    sets.push(set);
    results.push(scoreOne(set, goldenRoot));
  }

  // --- Отчёт по каждому изделию ------------------------------------------------
  for (const [i, r] of results.entries()) {
    const set = sets[i]!;
    const trust = METHOD_TRUST[set.method];
    console.log(`\n═══ ${r.id} · ${r.category} ═══`);
    console.log(
      `  мерил ${set.measured_by}, ${set.measured_at}, ${METHOD_LABEL_RU[set.method]}` +
        (trust === 'weak' ? '  ⚠ способ ненадёжен для калибровки' : ''),
    );
    console.log(
      `  ${bar(r.in_tolerance_rate)}  ${(r.in_tolerance_rate * 100).toFixed(1)}% в допуске ` +
        `(${r.compared} точек)  ${passes(r) ? '✓ принято' : '✗ не принято'}`,
    );
    console.log(
      `  средняя ошибка ${r.mean_abs_error_cm} см · наибольшая ${r.max_abs_error_cm} см · ` +
        `снос ${r.mean_bias_cm > 0 ? '+' : ''}${r.mean_bias_cm} см`,
    );

    if (r.misses.length) {
      console.log(`\n  мимо допуска:`);
      console.log(
        `    ${'код'.padEnd(5)}${'точка'.padEnd(34)}${'спека'.padStart(7)}${'факт'.padStart(7)}${'Δ'.padStart(7)}${'допусков'.padStart(10)}`,
      );
      for (const m of r.misses.slice(0, 12)) {
        console.log(
          `    ${m.code.padEnd(5)}${m.name_ru.slice(0, 33).padEnd(34)}` +
            `${String(m.spec_cm).padStart(7)}${String(m.measured_cm).padStart(7)}` +
            `${(m.delta_cm! > 0 ? '+' : '') + m.delta_cm}`.padStart(7) +
            `${m.delta_in_tolerances!.toFixed(1)}×`.padStart(10) +
            (m.verdict === 'near_miss' ? '  на грани' : ''),
        );
      }
    }
  }

  // --- Сводка ------------------------------------------------------------------
  const compared = results.reduce((n, r) => n + r.compared, 0);
  const rate =
    compared === 0
      ? 0
      : results.reduce((n, r) => n + r.in_tolerance_rate * r.compared, 0) / compared;

  console.log(`\n═══ СВОДКА ═══`);
  console.log(`  изделий ${results.length} · точек сравнено ${compared}`);
  // Десятая доля процента здесь не педантизм: округление до целых давало
  // «80% в допуске» рядом с отказом при пороге 80% — читалось как ошибка.
  console.log(
    `  ${bar(rate)}  ${(rate * 100).toFixed(1)}% в допуске ` +
      `(порог приёмки ${(ACCEPTANCE.min_in_tolerance_rate * 100).toFixed(0)}%) ` +
      `${rate >= ACCEPTANCE.min_in_tolerance_rate ? '✓ принято' : '✗ не принято'}`,
  );

  // --- Калибровка ---------------------------------------------------------------
  const report = calibrate(results);
  const suspect = anchorSuspect(report);
  if (suspect) console.log(`\n⚠ ${suspect}`);

  if (report.hints.length) {
    console.log(`\nПодсказки по справочнику (${report.hints.length}):`);
    for (const h of report.hints) {
      console.log(`  ${h.code} ${h.name_ru}`);
      console.log(`     ${h.reason_ru}`);
      console.log(`     отношение × ${h.suggested_ratio_factor}`);
    }
  } else if (report.samples < 3) {
    console.log(
      `\nПодсказок по справочнику нет: на ${report.samples} изделиях снос неотличим ` +
        `от совпадения. Нужно минимум три.`,
    );
  } else {
    console.log(`\nСистематического сноса не видно — справочник править не за что.`);
  }

  if (report.watch.length) {
    console.log(`\nСмотреть, но не править (${report.watch.length}):`);
    for (const w of report.watch.slice(0, 8)) {
      console.log(
        `  ${w.code} ${w.name_ru} — ${w.relative_bias > 0 ? '+' : ''}` +
          `${Math.round(w.relative_bias * 100)}% на ${w.samples} изд.`,
      );
    }
  }

  process.exit(rate >= ACCEPTANCE.min_in_tolerance_rate ? 0 : 1);
}

try {
  main();
} catch (e) {
  reportCliError(e);
  process.exit(1);
}
