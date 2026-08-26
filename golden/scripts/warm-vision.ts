/**
 * Прогрев vision-кэша на голден-наборе.
 *
 * Нужен после смены промпта или набора ракурсов: ключ кэша меняется, старые
 * отчёты становятся недостижимы, и фикстуры нужно снять заново живым вызовом.
 * Отдельный скрипт, а не побочный эффект тестов: это платные обращения к API,
 * и запускать их должен человек осознанно.
 *
 * Запуск: pnpm golden:warm (нужен ключ API).
 */
import { readFileSync } from 'node:fs';
import { FileVisionCache, analyzePhotos } from '@seamsterly/vision';
import { answersFingerprint, parseAnswers, readPhoto } from '@seamsterly/cli';
import { GOLDEN_SHOTS } from '../shots.js';

const cache = new FileVisionCache('.cache/vision');

for (const shot of GOLDEN_SHOTS) {
  const answers = parseAnswers(JSON.parse(readFileSync(`golden/answers/${shot.answers}`, 'utf8')));
  const { report, fromCache } = await analyzePhotos({
    photos: shot.photos.map((p) => readPhoto(p.file, p.view)),
    category: answers.category,
    answersFingerprint: answersFingerprint(answers),
    cache,
  });
  const low = report.proportions.filter((p) => p.confidence === 'low').length;
  console.log(
    `  ✓ ${shot.id.padEnd(12)} пропорций ${String(report.proportions.length).padStart(2)} ` +
      `· низкой уверенности ${low} · не видно ${report.not_visible.length}` +
      ` · масштаб ${report.scale_object.kind}` +
      (fromCache ? ' (из кэша)' : ''),
  );
}
