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
import { FileVisionCache, analyzePhotos } from '@specform/vision';
import { answersFingerprint, parseAnswers, readPhoto } from '@specform/cli';

const cache = new FileVisionCache('.cache/vision');

for (const cat of ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'] as const) {
  const answers = parseAnswers(
    JSON.parse(readFileSync(`golden/answers/${cat}-women-46.json`, 'utf8')),
  );
  const { report, fromCache } = await analyzePhotos({
    photos: [
      readPhoto(`golden/photos/${cat}-front.png`, 'front_flat'),
      readPhoto(`golden/photos/${cat}-back.png`, 'back_flat'),
    ],
    category: answers.category,
    answersFingerprint: answersFingerprint(answers),
    cache,
  });
  const low = report.proportions.filter((p) => p.confidence === 'low').length;
  console.log(
    `  ✓ ${cat.padEnd(12)} пропорций ${String(report.proportions.length).padStart(2)} ` +
      `· низкой уверенности ${low} · не видно ${report.not_visible.length}` +
      (fromCache ? ' (из кэша)' : ''),
  );
}
