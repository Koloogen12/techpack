/**
 * Перерисовать эскизы старых паков — тем, у кого нет вырезок видов.
 *
 * До вечера 8 сентября эскиз рисовался по тексту узлов и не резался на виды:
 * обложка и лист на просчёт таких паков стоят на библиотечном силуэте, а
 * колорвеи — на параметрической схеме. Скрипт проходит по работам с фото и
 * спекой без `sketch-views.json` и зовёт тот же путь, что кнопка
 * «Перерисовать по фото»: снимки первыми, узлы чек-листом, сторож, разрезка,
 * заливки. Прошлый лист уходит в историю. Отказ сторожа оставляет пак как был.
 *
 *   pnpm sketches:refresh -- --data apps/web/data --dry
 *   pnpm sketches:refresh -- --data /data --limit 40
 *
 * Каждый пак — платный вызов модели; между паками пауза, чтобы не упереться
 * в лимиты сервиса. `--force` перерисовывает и те, у кого вырезки уже есть.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseStyleSpec } from '@seamster/stylespec';
import { redrawSketch } from './generate.js';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const value = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const data = value('--data', 'apps/web/data');
const limit = Number(value('--limit', '1000'));
const pause = Number(value('--pause', '2000'));
const dry = flag('--dry');
const force = flag('--force');

const jobsRoot = join(data, 'jobs');
if (!existsSync(jobsRoot)) {
  console.error(`нет каталога работ: ${jobsRoot}`);
  process.exit(1);
}

const candidates = readdirSync(jobsRoot)
  .map((id) => ({ id, dir: join(jobsRoot, id) }))
  .filter(({ dir }) => existsSync(join(dir, 'spec.json')) && existsSync(join(dir, 'photos.json')))
  .filter(({ dir }) => force || !existsSync(join(dir, 'sketch-views.json')))
  .filter(({ dir }) => {
    try {
      return (JSON.parse(readFileSync(join(dir, 'photos.json'), 'utf8')) as string[]).length > 0;
    } catch {
      return false;
    }
  })
  .sort((a, b) => statSync(b.dir).mtimeMs - statSync(a.dir).mtimeMs)
  .slice(0, limit);

console.log(`паков к перерисовке: ${candidates.length}${dry ? ' (сухой прогон)' : ''}`);
let ok = 0;
let rejected = 0;
let failed = 0;
for (const { id, dir } of candidates) {
  if (dry) {
    console.log(`  ${id}`);
    continue;
  }
  try {
    const spec = parseStyleSpec(JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8')));
    const photos = (JSON.parse(readFileSync(join(dir, 'photos.json'), 'utf8')) as string[]).map(
      (name) => join(dir, name),
    );
    const started = Date.now();
    const result = await redrawSketch({
      dir,
      spec,
      photoPaths: photos,
      cacheDir: join(data, 'cache', 'vision'),
      renderCacheDir: join(data, 'cache', 'render'),
    });
    const secs = Math.round((Date.now() - started) / 1000);
    if (result.ok) {
      ok++;
      console.log(`  ✓ ${id} · виды: ${result.views.join(' ') || 'нет'} · ${secs} с`);
    } else {
      rejected++;
      console.log(`  ✗ ${id} · ${result.userMessage} · ${secs} с`);
    }
  } catch (error) {
    failed++;
    console.log(`  ! ${id} · ${error instanceof Error ? error.message : String(error)}`);
  }
  await new Promise((r) => setTimeout(r, pause));
}
if (!dry)
  console.log(`готово: перерисовано ${ok} · сторож отклонил ${rejected} · ошибок ${failed}`);
