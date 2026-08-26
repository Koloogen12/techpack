#!/usr/bin/env tsx
/**
 * Примерка → новая версия техпака.
 *
 *   pnpm fit:apply <бланк-замеров.json> [--versions каталог]
 *
 * Замыкает цикл, который до сих пор обрывался: техпак → отшив → замеры →
 * СЛЕДУЮЩАЯ ВЕРСИЯ ТЕХПАКА, в которой спорных значений на десяток меньше.
 * Раньше замеры умели только сказать, где мы промахнулись; верхняя ступень
 * иерархии уверенности стояла в легенде документа, но её не получало
 * ни одно значение в жизни.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSeamsterlyError, CONFIDENCE_LABEL_RU } from '@seamsterly/core';
import { buildStyleSpec } from '@seamsterly/assembly';
import { applyFitting, parseMeasuredSet } from '@seamsterly/fit';
import { VisionReportSchema, type VisionReport } from '@seamsterly/vision';
import { diffSpecs, summarise, VersionStore } from '@seamsterly/versions';
import { parseAnswers } from './answers.js';
import { specInputFrom } from './generate.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const setPath = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--versions');

if (!setPath) {
  console.error('Укажите бланк замеров: pnpm fit:apply golden/measured/hoodie.json');
  process.exit(1);
}

function visionReportFor(category: string): VisionReport | null {
  const path = join('golden', 'vision-reports', `${category}.json`);
  if (!existsSync(path)) return null;
  return VisionReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

try {
  const measured = parseMeasuredSet(JSON.parse(readFileSync(setPath, 'utf8')));
  const answers = parseAnswers(JSON.parse(readFileSync(measured.answers, 'utf8')));
  const store = new VersionStore(flag('versions') ?? 'versions');

  // База для примерки — последняя сохранённая версия, а если её нет,
  // свежая сборка из анкеты. Порядок именно такой: примерка применяется
  // к тому документу, который держали в руках, а не к пересобранному.
  const previous = store.latest(answers.article);
  const baseSpec =
    previous?.spec ??
    buildStyleSpec(
      specInputFrom(answers, visionReportFor(answers.category), {
        now: new Date('2026-08-25T00:00:00.000Z'),
      }),
    ).spec;

  if (!previous) {
    store.save(answers.article, baseSpec, 'первая сборка из анкеты');
  }

  const result = applyFitting(baseSpec, measured);
  const diff = diffSpecs(baseSpec, result.spec);

  console.log(`\n${answers.name} · ${answers.article}`);
  console.log(`Примерка ${measured.id} · ${measured.measured_at} · ${measured.measured_by}\n`);

  if (result.applied.length) {
    const width = Math.max(...result.applied.map((a) => a.name_ru.length));
    for (const a of result.applied.sort((x, y) => Math.abs(y.delta_cm) - Math.abs(x.delta_cm))) {
      const sign = a.delta_cm > 0 ? '+' : '';
      console.log(
        `  ${a.code}  ${a.name_ru.padEnd(width)}  ${a.from_cm.toFixed(1).padStart(6)} → ` +
          `${a.to_cm.toFixed(1).padStart(6)}  ${(sign + a.delta_cm.toFixed(1)).padStart(6)} см` +
          `   было: ${CONFIDENCE_LABEL_RU[a.from_confidence]}`,
      );
    }
  }

  for (const r of result.rejected) {
    console.log(`  ✗ ${r.code} ${r.measured_cm.toFixed(1)} см — ${r.reason}`);
  }

  console.log(`\n${summarise(diff)}`);
  for (const note of result.notes) console.log(`  · ${note}`);

  const entry = store.save(
    answers.article,
    result.spec,
    `примерка ${measured.id} (${measured.measured_at})`,
  );
  console.log(
    entry
      ? `\nВерсия ${entry.n} · отпечаток ${entry.fingerprint.slice(0, 12)}`
      : '\nВерсия НЕ создана: содержание не изменилось.',
  );
} catch (error) {
  if (isSeamsterlyError(error)) {
    console.error(`\n${error.userMessage}\n${error.userAction}\n`);
    process.exit(1);
  }
  throw error;
}
