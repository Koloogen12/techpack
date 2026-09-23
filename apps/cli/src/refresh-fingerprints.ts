#!/usr/bin/env tsx
/**
 * Переписать спутники sketch.json и render.json на отпечаток формы.
 *
 *   pnpm fingerprints:refresh -- --data apps/web/data
 *
 * Спутники говорят, для какой спецификации нарисованы лист и «Внешний вид».
 * Раньше отпечаток считался по тексту промпта, и любая правка формулировки
 * для художника объявляла все листы устаревшими. Теперь он считается по форме
 * (узлы, признаки, посадка); у паков, нарисованных до смены, спутники
 * пересчитываются от текущей спеки: их листы рисовались именно для неё.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStyleSpec } from '@seamster/stylespec';
import { sketchFingerprint } from '@seamster/render';
import { renderFingerprint } from './generate.js';

const args = process.argv.slice(2);
const dataIdx = args.indexOf('--data');
const DATA = dataIdx >= 0 ? (args[dataIdx + 1] ?? 'apps/web/data') : 'apps/web/data';
const jobs = join(DATA, 'jobs');
let done = 0;
for (const id of existsSync(jobs) ? readdirSync(jobs) : []) {
  const dir = join(jobs, id);
  if (!existsSync(join(dir, 'spec.json'))) continue;
  let spec;
  try {
    spec = parseStyleSpec(JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8')));
  } catch {
    continue;
  }
  for (const [file, fingerprint] of [
    ['sketch.json', sketchFingerprint(spec)],
    ['render.json', renderFingerprint(spec)],
  ] as const) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { fingerprint?: string; at?: string };
    if (raw.fingerprint === fingerprint) continue;
    writeFileSync(path, JSON.stringify({ ...raw, fingerprint }));
    done++;
    console.log(`${id}: ${file}`);
  }
}
console.log(`переписано: ${done}`);
