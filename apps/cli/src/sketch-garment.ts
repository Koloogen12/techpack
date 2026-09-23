#!/usr/bin/env tsx
/**
 * Дописать габарит изделия на вырезках эскиза старым пакам.
 *
 *   pnpm sketches:garment -- --data apps/web/data
 *
 * Новые листы получают sketch-garment.json при записи; паки, собранные
 * раньше, без него не могут показать раскладку нанесения на рисунке.
 * Скрипт читает вырезки переда и спинки тем же браузером, что печатает
 * документ, и кладёт габарит рядом. Лист не трогается.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { garmentBoxFromLuma } from '@seamster/flats';
import { sheetLuma } from '@seamster/docgen';

const args = process.argv.slice(2);
const dataIdx = args.indexOf('--data');
const DATA = dataIdx >= 0 ? (args[dataIdx + 1] ?? 'apps/web/data') : 'apps/web/data';
const force = args.includes('--force');

const jobs = join(DATA, 'jobs');
if (!existsSync(jobs)) {
  console.error(`нет папки ${jobs}`);
  process.exit(1);
}

const browser = await chromium.launch();
let done = 0;
let skipped = 0;
try {
  for (const id of readdirSync(jobs)) {
    const dir = join(jobs, id);
    const target = join(dir, 'sketch-garment.json');
    if (existsSync(target) && !force) {
      skipped++;
      continue;
    }
    const out: Record<string, unknown> = {};
    for (const view of ['front', 'back'] as const) {
      const file = ['jpg', 'png']
        .map((ext) => join(dir, `sketch-${view}.${ext}`))
        .find((p) => existsSync(p));
      if (!file) continue;
      const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const uri = `data:${type};base64,${readFileSync(file).toString('base64')}`;
      const pixels = await sheetLuma(browser, uri, 400_000);
      if (!pixels) continue;
      const box = garmentBoxFromLuma(pixels.luma, pixels.width, pixels.height);
      if (box) out[view] = { ...box, w: pixels.width, h: pixels.height };
    }
    if (Object.keys(out).length === 0) {
      skipped++;
      continue;
    }
    writeFileSync(target, JSON.stringify(out));
    done++;
    console.log(`${id}: ${Object.keys(out).join(', ')}`);
  }
} finally {
  await browser.close();
}
console.log(`готово: ${done}, пропущено: ${skipped}`);
