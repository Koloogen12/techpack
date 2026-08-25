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
import { FileVisionCache, cacheKey, defaultModel, hashPhoto } from '@specform/vision';
import { parseAnswers, answersFingerprint } from '@specform/cli';

const cache = new FileVisionCache('.cache/vision');
for (const cat of ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'] as const) {
  const answers = parseAnswers(
    JSON.parse(readFileSync(`golden/answers/${cat}-women-46.json`, 'utf8')),
  );
  // Голден-набор снимается двумя ракурсами: без спинки половина точек
  // корпуса и капюшона остаётся предположениями, и набор перестаёт проверять
  // то, ради чего существует.
  const shots = [
    { file: `golden/photos/${cat}-front.png`, view: 'front_flat' as const },
    { file: `golden/photos/${cat}-back.png`, view: 'back_flat' as const },
  ];
  const key = cacheKey({
    photoHashes: shots.map((s) => hashPhoto(readFileSync(s.file))),
    views: shots.map((s) => s.view),
    category: answers.category,
    answersFingerprint: answersFingerprint(answers),
    model: defaultModel(),
  });
  const report = cache.get(key);
  if (!report) {
    console.log(`  ✗ ${cat}: отчёта нет в кэше`);
    continue;
  }
  writeFileSync(`golden/vision-reports/${cat}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `  ✓ ${cat.padEnd(12)} пропорций ${String(report.proportions.length).padStart(2)} · ` +
      `видимых элементов ${String(report.visible_elements.length).padStart(2)} · ` +
      `не видно ${String(report.not_visible.length).padStart(2)}`,
  );
}
