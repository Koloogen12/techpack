/**
 * Разбор фотографий изделия из командной строки.
 *
 * Запуск: pnpm vision:analyze <файл> [ещё файлы...]
 *
 * Инструмент concierge-режима и отладки промпта. Печатает отчёт,
 * себестоимость вызова и ключ кэша — по нему прогон воспроизводится.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { CostLedger, createLogger, isSpecFormError } from '@specform/core';
import {
  FileVisionCache,
  analyzePhotos,
  defaultModel,
  type Photo,
  type PhotoFormat,
} from '../src/index.js';

const FORMATS: Record<string, PhotoFormat> = {
  '.jpg': 'jpg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.gif': 'gif',
  '.webp': 'webp',
};

function readPhoto(path: string): Photo {
  const format = FORMATS[extname(path).toLowerCase()];
  if (!format) {
    throw new Error(`неподдерживаемый формат: ${path}. Нужен ${Object.keys(FORMATS).join(', ')}`);
  }
  return { bytes: readFileSync(path), format, label: basename(path) };
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Использование: pnpm vision:analyze <файл> [ещё файлы...]');
    process.exit(1);
  }

  const ledger = new CostLedger();
  const model = defaultModel();
  console.log(`Модель: ${model}. Снимков: ${paths.length}.\n`);

  const { report, cacheKey, fromCache } = await analyzePhotos({
    photos: paths.map(readPhoto),
    answersFingerprint: 'cli',
    model,
    cache: new FileVisionCache(process.env.SPECFORM_CACHE_DIR ?? '.cache/vision'),
    ledger,
    logger: createLogger({ level: 'warn' }),
  });

  const pct = (v: string) => v.padEnd(22);
  console.log(`${pct('Категория')}${report.category.value} (${report.category.confidence})`);
  if (report.category.other_description) {
    console.log(`${pct('  что именно')}${report.category.other_description}`);
  }
  console.log(`${pct('Силуэт')}${report.silhouette.value} (${report.silhouette.confidence})`);
  console.log(
    `${pct('Полотно')}${report.fabric.knit_class} (${report.fabric.confidence}), ` +
      `${report.fabric.is_knit ? 'трикотаж' : 'ткань'}`,
  );

  console.log(`\nПропорции к ширине по груди — ${report.proportions.length}:`);
  for (const p of report.proportions) {
    console.log(
      `  ${p.pom_code}  ×${p.ratio_to_chest.toFixed(2)}  ${p.confidence.padEnd(7)} ${p.reason}`,
    );
  }

  if (report.topstitching.length) {
    console.log('\nОтделочные строчки (задают тип машины):');
    for (const t of report.topstitching) {
      console.log(`  ${t.location.padEnd(12)} ${t.rows} парал. (${t.confidence})`);
    }
  }

  if (report.visible_elements.length) {
    console.log('\nВидимые элементы:');
    for (const e of report.visible_elements) {
      console.log(`  ${e.key.padEnd(18)} ${e.value} (${e.confidence})`);
    }
  }

  console.log(`\nНе видно на снимках — ${report.not_visible.length} (уйдут предположениями):`);
  for (const n of report.not_visible) console.log(`  ${n.key.padEnd(24)} ${n.reason}`);

  if (report.photo_quality_notes.length) {
    console.log('\nЗамечания к съёмке:');
    for (const n of report.photo_quality_notes) console.log(`  ${n}`);
  }

  const { usd, ms } = ledger.summary();
  console.log(
    `\nКлюч кэша: ${cacheKey}` +
      `\nИсточник:  ${fromCache ? 'кэш, обращения к API не было' : 'вызов API'}` +
      `\nСтоимость: $${usd.toFixed(4)} · ${(ms / 1000).toFixed(1)} c`,
  );
}

main().catch((e: unknown) => {
  if (isSpecFormError(e)) {
    console.error(`\n✗ ${e.userMessage}\n  ${e.userAction}\n  (${e.code}: ${e.message})`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
