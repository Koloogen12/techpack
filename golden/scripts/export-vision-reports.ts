/**
 * Выгрузка живых отчётов разбора из кэша в фикстуры голден-набора.
 *
 * Отчёты получены настоящим вызовом модели на эталонных фотографиях. Они
 * коммитятся в репозиторий, чтобы голден-набор воспроизводился в CI без ключа
 * API и без сети — но проверял при этом настоящий выход модели, а не выдумку.
 *
 * Запуск: pnpm golden:export (нужен прогретый кэш, см. README).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { FileVisionCache, cacheKey, defaultModel, hashPhoto } from '@seamsterly/vision';
import { parseAnswers as parse, answersFingerprint } from '@seamsterly/cli';
import { GOLDEN_SHOTS } from '../shots.js';

const parseAnswers = (raw: string) => parse(JSON.parse(raw));

const cache = new FileVisionCache('.cache/vision');
for (const shot of GOLDEN_SHOTS) {
  const answers = parseAnswers(readFileSync(`golden/answers/${shot.answers}`, 'utf8'));
  const key = cacheKey({
    photoHashes: shot.photos.map((p) => hashPhoto(readFileSync(p.file))),
    views: shot.photos.map((p) => p.view),
    category: answers.category,
    answersFingerprint: answersFingerprint(answers),
    model: defaultModel(),
  });
  const report = cache.get(key);
  if (!report) {
    console.log(`  \u2717 ${shot.id}: отчёта нет в кэше — прогрейте pnpm golden:warm`);
    continue;
  }
  writeFileSync(`golden/vision-reports/${shot.id}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `  \u2713 ${shot.id.padEnd(12)} пропорций ${String(report.proportions.length).padStart(2)} ` +
      `\u00b7 не видно ${String(report.not_visible.length).padStart(2)} ` +
      `\u00b7 масштаб ${report.scale_object.kind}`,
  );
}
